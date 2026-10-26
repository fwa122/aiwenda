import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { genId } from '../common/id.util';
import { assertUsernameAllowed, hashPassword } from '../common/password.security';
import { ROLE_NAME } from '../common/role.util';
import { canGrantRole, canManageUser, getRoleMap } from '../common/rbac';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateUserDto,
  UpdateProfileDto,
  UpdateUserDto,
} from './dto/user.dto';

@Injectable()
export class UserService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 角色存在性校验（逻辑外键）：users.role 必须是 roles 表中已配置的 code */
  private async assertRoleExists(code: string) {
    const exists = await this.prisma.role.findUnique({
      where: { code },
      select: { code: true },
    });
    if (!exists) throw new BadRequestException(`角色不存在：${code}`);
  }

  /** 批量标注 roleName：roles 表配置优先（可运营改名），角色缺失降级硬编码映射 */
  private async annotateRoleName<T extends { role: string }>(
    users: T[]
  ): Promise<(T & { roleName: string })[]> {
    const roleMap = await getRoleMap(this.prisma);
    return users.map((u) => ({
      ...u,
      roleName: roleMap.get(u.role)?.name ?? ROLE_NAME[u.role] ?? u.role ?? '未知',
    }));
  }

  async getProfile(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('用户不存在');
    const { passwordHash, ...rest } = u;
    const [withName] = await this.annotateRoleName([rest]);
    return withName;
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    const u = await this.prisma.user.update({ where: { id }, data: { ...dto } });
    const { passwordHash, ...rest } = u;
    const [withName] = await this.annotateRoleName([rest]);
    return withName;
  }

  async changePassword(id: string, oldPassword: string, newPassword: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('用户不存在');
    const ok = await bcrypt.compare(oldPassword, u.passwordHash);
    if (!ok) throw new BadRequestException('原密码错误');
    await this.prisma.user.update({
      where: { id },
      // tokenVersion 自增：该用户全部已签发令牌（access + refresh）立即失效，
      // 凭据泄露后改密即可止损，无需等待 access 自然过期
      data: { passwordHash: await hashPassword(newPassword), tokenVersion: { increment: 1 } },
    });
    return null;
  }

  async list(query: {
    keyword?: string;
    role?: string;
    page?: number;
    pageSize?: number;
  }) {
    const where: Prisma.UserWhereInput = {};
    if (query.keyword) {
      where.OR = [
        { username: { contains: query.keyword } },
        { nickname: { contains: query.keyword } },
      ];
    }
    if (query.role) where.role = query.role;

    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 20;

    const [list, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      list: await this.annotateRoleName(
        list.map(({ passwordHash: _hash, ...r }) => r)
      ),
      total,
      page,
      pageSize,
    };
  }

  async create(dto: CreateUserDto, actor: { role: string }) {
    // 四级授权链（v0.9.61）：建号即授予初始角色——admin 只能建普通用户，
    // owner/super_admin 按各自矩阵（super_admin 不可建 super_admin）
    const targetRole = dto.role ?? 'viewer';
    if (!canGrantRole(actor.role, targetRole)) {
      throw new ForbiddenException('您的角色无权授予该角色');
    }
    const exist = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (exist) throw new BadRequestException('用户名已存在');
    if (dto.role) await this.assertRoleExists(dto.role);
    // 管理员创建用户同样走保留名校验（与自助注册同标准）
    assertUsernameAllowed(dto.username);
    const u = await this.prisma.user.create({
      data: {
        id: genId('user'),
        username: dto.username,
        passwordHash: await hashPassword(dto.password),
        nickname: dto.nickname ?? dto.username,
        email: dto.email,
        role: targetRole,
        department: dto.department,
        status: dto.status ?? 'active',
        conversationLimit: dto.conversationLimit ?? 30,
        docLimit: dto.docLimit ?? 200,
        storageLimit: dto.storageLimit ?? 1073741824,
        monthlyTokenLimit: dto.monthlyTokenLimit ?? 200000,
      },
    });
    const { passwordHash: _hash, ...rest } = u;
    const [withName] = await this.annotateRoleName([rest]);
    return withName;
  }

  async update(id: string, dto: UpdateUserDto, actor: { role: string }) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { role: true, username: true },
    });
    if (!target) throw new NotFoundException('用户不存在');
    // 四级管理范围（v0.9.61）：目标 rank 严格低于操作者（owner 互不可管理，
    // 超管不可动站长/同级，管理员仅可管理普通用户）
    if (!canManageUser(actor.role, target.role)) {
      throw new ForbiddenException('无权管理该用户');
    }
    // 角色变更走授予矩阵（admin 无授级权；不可越级授予）
    if (dto.role && dto.role !== target.role && !canGrantRole(actor.role, dto.role)) {
      throw new ForbiddenException('您的角色无权授予该角色');
    }
    if (dto.role) await this.assertRoleExists(dto.role);
    // 封禁（active→disabled）时自增 tokenVersion：被禁用户旧令牌立即 401，
    // 而非存活至 access 自然过期（≤2h 窗口）
    const data = { ...dto };
    if (dto.status === 'disabled') {
      (data as Record<string, unknown>).tokenVersion = { increment: 1 };
    }
    const u = await this.prisma.user.update({ where: { id }, data });
    const { passwordHash: _hash, ...rest } = u;
    const [withName] = await this.annotateRoleName([rest]);
    return withName;
  }

  async remove(id: string, actor: { role: string }) {
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { role: true },
    });
    if (!target) throw new NotFoundException('用户不存在');
    if (!canManageUser(actor.role, target.role)) {
      throw new ForbiddenException('无权删除该用户');
    }
    await this.prisma.user.delete({ where: { id } });
    return null;
  }
}
