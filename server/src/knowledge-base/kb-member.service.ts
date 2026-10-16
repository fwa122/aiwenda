import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { genId } from '../common/id.util';
import { SessionUser } from '../common/kb-access';
import { hasAllScope } from '../common/rbac';
import { PrismaService } from '../prisma/prisma.service';
import { AddMemberDto, UpdateMemberDto } from './dto/kb-member.dto';

/** 成员列表/邀请返回的用户最小字段 */
const USER_FIELDS = { id: true, username: true, nickname: true, department: true } as const;

@Injectable()
export class KbMemberService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 成员管理仅 owner / 超管（editor 可写内容，但无权增删成员） */
  private async assertManageable(kbId: string, user: SessionUser) {
    const kb = await this.prisma.knowledgeBase.findUnique({ where: { id: kbId } });
    if (!kb) throw new NotFoundException('知识库不存在');
    if (!hasAllScope(user) && kb.userId !== user.id) {
      throw new ForbiddenException('仅知识库所有者或管理员可管理成员');
    }
    return kb;
  }

  async list(kbId: string, user: SessionUser) {
    await this.assertManageable(kbId, user);
    const list = await this.prisma.kbMember.findMany({
      where: { kbId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, role: true, createdAt: true, user: { select: USER_FIELDS } },
    });
    return { list, total: list.length };
  }

  async add(kbId: string, dto: AddMemberDto, user: SessionUser) {
    const kb = await this.assertManageable(kbId, user);
    const target = await this.prisma.user.findUnique({ where: { username: dto.username.trim() } });
    if (!target) throw new NotFoundException('用户不存在');
    if (target.id === kb.userId) throw new BadRequestException('该用户是知识库所有者，无需添加');
    const existed = await this.prisma.kbMember.findUnique({
      where: { kbId_userId: { kbId, userId: target.id } },
    });
    if (existed) throw new BadRequestException('该用户已是知识库成员');
    let member;
    try {
      [member] = await this.prisma.$transaction([
        this.prisma.kbMember.create({
          data: { id: genId('kbm'), kbId, userId: target.id, role: dto.role },
        }),
        // memberCount = owner(1) + 成员数，增删成员时同步维护（create 失败则整体回滚，不会误增）
        this.prisma.knowledgeBase.update({
          where: { id: kbId },
          data: { memberCount: { increment: 1 } },
        }),
      ]);
    } catch (e) {
      // 并发窗口兜底：查重通过后另一请求抢先插入会触发唯一约束，映射为 400 而非 500
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('该用户已是知识库成员');
      }
      throw e;
    }
    return {
      id: member.id,
      kbId: member.kbId,
      role: member.role,
      createdAt: member.createdAt,
      user: {
        id: target.id,
        username: target.username,
        nickname: target.nickname,
        department: target.department,
      },
    };
  }

  async update(kbId: string, memberId: string, dto: UpdateMemberDto, user: SessionUser) {
    await this.assertManageable(kbId, user);
    const member = await this.prisma.kbMember.findFirst({ where: { id: memberId, kbId } });
    if (!member) throw new NotFoundException('成员不存在');
    const updated = await this.prisma.kbMember.update({
      where: { id: memberId },
      data: { role: dto.role },
      select: { id: true, role: true, user: { select: USER_FIELDS } },
    });
    return updated;
  }

  async remove(kbId: string, memberId: string, user: SessionUser) {
    await this.assertManageable(kbId, user);
    const member = await this.prisma.kbMember.findFirst({ where: { id: memberId, kbId } });
    if (!member) throw new NotFoundException('成员不存在');
    await this.prisma.$transaction([
      this.prisma.kbMember.delete({ where: { id: memberId } }),
      this.prisma.knowledgeBase.update({
        where: { id: kbId },
        data: { memberCount: { decrement: 1 } },
      }),
    ]);
    return { id: memberId };
  }

  /**
   * 邀请下拉候选用户：排除 owner 与已有成员，仅暴露最小字段。
   * 独立于 admin 的用户管理接口（/users），owner 无 admin 角色也能检索协作对象。
   */
  async candidates(kbId: string, keyword: string | undefined, user: SessionUser) {
    await this.assertManageable(kbId, user);
    const [kb, members] = await Promise.all([
      this.prisma.knowledgeBase.findUnique({
        where: { id: kbId },
        select: { userId: true },
      }),
      this.prisma.kbMember.findMany({ where: { kbId }, select: { userId: true } }),
    ]);
    const excludeIds = members.map((m) => m.userId);
    if (kb?.userId) excludeIds.push(kb.userId);
    const kw = (keyword || '').trim();
    return this.prisma.user.findMany({
      where: {
        id: { notIn: excludeIds },
        status: 'active',
        ...(kw ? { OR: [{ username: { contains: kw } }, { nickname: { contains: kw } }] } : {}),
      },
      select: USER_FIELDS,
      orderBy: { username: 'asc' },
      take: 20,
    });
  }
}
