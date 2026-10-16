import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { genId } from '../common/id.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  AddDeptMemberDto,
  CreateDepartmentDto,
  UpdateDepartmentDto,
} from './dto/department.dto';

@Injectable()
export class DepartmentService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 全量部门组建成嵌套树（部门量级千级以内，一次查询内存组装即可） */
  async tree() {
    const rows = await this.prisma.department.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { members: true } } },
    });
    const nodeMap = new Map<string, Record<string, any>>();
    const roots: Record<string, any>[] = [];
    for (const r of rows) {
      nodeMap.set(r.id, {
        id: r.id,
        parentId: r.parentId,
        name: r.name,
        path: r.path,
        leaderId: r.leaderId,
        memberCount: r._count.members,
        children: [],
      });
    }
    for (const r of rows) {
      const node = nodeMap.get(r.id)!;
      const parent = r.parentId ? nodeMap.get(r.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  async create(dto: CreateDepartmentDto) {
    let parentPath = '';
    if (dto.parentId) {
      const parent = await this.prisma.department.findUnique({
        where: { id: dto.parentId },
      });
      if (!parent) throw new NotFoundException('上级部门不存在');
      parentPath = parent.path;
    }
    if (dto.leaderId) {
      const leader = await this.prisma.user.findUnique({
        where: { id: dto.leaderId },
      });
      if (!leader) throw new NotFoundException('负责人用户不存在');
    }
    const id = genId('dept');
    return this.prisma.department.create({
      data: {
        id,
        name: dto.name.trim(),
        parentId: dto.parentId ?? null,
        // path 以自身 id 收尾：根为 /dept_xxx，子级追加一级
        path: `${parentPath}/${id}`,
        leaderId: dto.leaderId ?? null,
      },
    });
  }

  async update(id: string, dto: UpdateDepartmentDto) {
    const dept = await this.mustFind(id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.leaderId !== undefined) {
      if (!dto.leaderId) {
        data.leader = { disconnect: true };
      } else {
        // 负责人必须是本部门成员，避免指派无关人员
        const member = await this.prisma.userDepartment.findUnique({
          where: { userId_deptId: { userId: dto.leaderId, deptId: id } },
        });
        if (!member) throw new BadRequestException('部门负责人必须是该部门成员');
        data.leader = { connect: { id: dto.leaderId } };
      }
    }
    return this.prisma.department.update({
      where: { id: dept.id },
      data,
      include: { leader: { select: { id: true, username: true, nickname: true } } },
    });
  }

  /**
   * 移动部门（调整 parentId）：校验不成环后，用一条 SQL 重写整棵子树的
   * 物化路径前缀——path 以部门 id 拼接，移动只换前缀，内部相对结构不变
   */
  async move(id: string, dto: { parentId?: string | null }) {
    if (!('parentId' in dto) || dto.parentId === undefined) {
      throw new BadRequestException('parentId 必填（null 表示移到根级）');
    }
    const self = await this.mustFind(id);
    const parentId = dto.parentId;
    if (parentId === id) throw new BadRequestException('不能将部门移动到自己之下');

    let parentPath = '';
    if (parentId !== null) {
      const parent = await this.prisma.department.findUnique({
        where: { id: parentId },
      });
      if (!parent) throw new NotFoundException('目标上级部门不存在');
      // 目标部门的路径位于自身子树内 = 会形成环
      if (parent.path.startsWith(`${self.path}/`)) {
        throw new BadRequestException('不能将部门移动到自己的子部门之下');
      }
      parentPath = parent.path;
    }

    const oldPrefix = self.path;
    const newPrefix = `${parentPath}/${id}`;
    if (newPrefix === oldPrefix) return self; // 根级原地不动

    await this.prisma.$transaction(async (tx) => {
      // LEFT 精确前缀比对：部门 id 含下划线，LIKE 会把 _ 当通配符误匹配
      await tx.$executeRaw`
        UPDATE "departments"
        SET "path" = ${newPrefix} || SUBSTRING("path", LENGTH(${oldPrefix}) + 1)
        WHERE LEFT("path", LENGTH(${oldPrefix})) = ${oldPrefix}
      `;
      await tx.department.update({
        where: { id },
        data: { parentId: parentId },
      });
    });
    return this.prisma.department.findUnique({ where: { id } });
  }

  async remove(id: string) {
    await this.mustFind(id);
    const [childCount, memberCount, kbCount] = await Promise.all([
      this.prisma.department.count({ where: { parentId: id } }),
      this.prisma.userDepartment.count({ where: { deptId: id } }),
      // DEPT 库的部门通道依赖 orgId（无外键）：删除后归属悬空，库对部门用户静默隐身。
      // 删除前强制先迁移知识库归属（或改为 PRIVATE/PUBLIC），避免悬空数据静默产生
      this.prisma.knowledgeBase.count({ where: { orgId: id } }),
    ]);
    if (childCount > 0) throw new BadRequestException('请先删除或移出其子部门');
    if (memberCount > 0) throw new BadRequestException('请先移出部门成员');
    if (kbCount > 0) {
      throw new BadRequestException(
        `该部门名下有 ${kbCount} 个知识库（部门可见性依赖此部门），请先在知识库设置中调整归属后再删除`
      );
    }
    await this.prisma.department.delete({ where: { id } });
    return null;
  }

  /** 部门成员分页列表（含用户摘要，供管理端选人/移除） */
  async listMembers(id: string, query: { page?: number; pageSize?: number }) {
    await this.mustFind(id);
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 20;
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.userDepartment.findMany({
        where: { deptId: id },
        include: {
          user: {
            select: { id: true, username: true, nickname: true, role: true, status: true },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.userDepartment.count({ where: { deptId: id } }),
    ]);
    return {
      list: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        isPrimary: r.isPrimary,
        joinedAt: r.createdAt,
        user: r.user,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * 指派用户进部门：一人可兼多部门；显式指定主部门时在事务内
   * 先清旧主部门标记再落新行，保证"至多一个主部门"约束
   */
  async addMember(deptId: string, dto: AddDeptMemberDto) {
    const dept = await this.mustFind(deptId);
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!user) throw new NotFoundException('用户不存在');
    if (user.status !== 'active') throw new BadRequestException('用户已停用，无法加入部门');
    const dup = await this.prisma.userDepartment.findUnique({
      where: { userId_deptId: { userId: dto.userId, deptId } },
    });
    if (dup) throw new BadRequestException('该用户已是部门成员');

    // 首次归属自动成为主部门，避免用户悬空无主部门
    const existCount = await this.prisma.userDepartment.count({
      where: { userId: dto.userId },
    });
    const isPrimary = dto.isPrimary ?? existCount === 0;

    return this.prisma.$transaction(async (tx) => {
      // 仅当已有归属时才需要清旧主部门；首次归属无旧标记可清，省一次写
      if (isPrimary && existCount > 0) {
        await tx.userDepartment.updateMany({
          where: { userId: dto.userId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      return tx.userDepartment.create({
        data: { id: genId('udm'), userId: dto.userId, deptId, isPrimary },
      });
    });
  }

  async removeMember(deptId: string, userId: string) {
    const dept = await this.mustFind(deptId);
    const row = await this.prisma.userDepartment.findUnique({
      where: { userId_deptId: { userId, deptId } },
    });
    if (!row) throw new NotFoundException('该用户不是部门成员');
    await this.prisma.$transaction(async (tx) => {
      await tx.userDepartment.delete({ where: { id: row.id } });
      // 负责人被移出部门则卸任，避免 leaderId 指向非成员
      if (dept.leaderId === userId) {
        await tx.department.update({
          where: { id: deptId },
          data: { leader: { disconnect: true } },
        });
      }
    });
    return null;
  }

  private async mustFind(id: string) {
    const dept = await this.prisma.department.findUnique({ where: { id } });
    if (!dept) throw new NotFoundException('部门不存在');
    return dept;
  }
}
