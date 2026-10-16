import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { genId } from '../common/id.util';
import { isKbDeptVisible, visibleDeptIds } from '../common/dept-scope';
import { canReadKb, canWriteKb, SessionUser } from '../common/kb-access';
import { hasAllScope } from '../common/rbac';
import { PrismaService } from '../prisma/prisma.service';
import { AiServiceClient } from '../integrations/ai-service.client';
import { CreateKbDto, UpdateKbDto } from './dto/knowledge-base.dto';

const DEFAULT_RETRIEVER = {
  topK: 5,
  threshold: 0.28,
  rerank: true,
  rerankModel: 'bge-reranker-large',
  hybrid: true,
};

const DEFAULT_LLM = {
  provider: 'qianwen',
  model: 'qwen3.8-max',
  temperature: 0.3,
};

@Injectable()
export class KnowledgeBaseService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly ai: AiServiceClient
  ) {}

  /** 由 DTO 构造 retrieverConfig / llmConfig 两张 Json */
  private buildConfig(dto: CreateKbDto | UpdateKbDto, existing?: {
    retrieverConfig?: any;
    llmConfig?: any;
  }) {
    const retriever = { ...(existing?.retrieverConfig ?? DEFAULT_RETRIEVER) };
    let llm = { ...(existing?.llmConfig ?? DEFAULT_LLM) };

    if (dto.topK !== undefined) retriever.topK = dto.topK;
    if (dto.threshold !== undefined) retriever.threshold = dto.threshold;
    if (dto.rerank !== undefined) retriever.rerank = dto.rerank;
    if (dto.rerankModel !== undefined) retriever.rerankModel = dto.rerankModel;
    if (dto.hybrid !== undefined) retriever.hybrid = dto.hybrid;
    if ((dto as any).llm) llm = { ...llm, ...(dto as any).llm };

    return {
      retrieverConfig: retriever as Prisma.InputJsonValue,
      llmConfig: llm as Prisma.InputJsonValue,
    };
  }

  /** 列表/下拉可见性过滤：超管全可见；普通用户可见 PUBLIC + DEPT(可见部门) + 自己的 + 所在成员库 */
  private visibilityFilter(
    user: SessionUser,
    deptIds: string[]
  ): Prisma.KnowledgeBaseWhereInput {
    if (hasAllScope(user)) return {};
    const or: Prisma.KnowledgeBaseWhereInput[] = [
      { userId: user.id },
      { visibility: 'PUBLIC' },
      { members: { some: { userId: user.id } } },
    ];
    if (deptIds.length) or.push({ visibility: 'DEPT', orgId: { in: deptIds } });
    return { OR: or };
  }

  /** 普通用户的可见部门 id 集（超管免查） */
  private deptScope(user: SessionUser): Promise<string[]> {
    return hasAllScope(user) ? Promise.resolve([]) : visibleDeptIds(this.prisma, user.id);
  }

  /** 当前用户在某库的成员角色（非成员为 null），实时查库——移除后权限立即失效 */
  private memberRoleOf(kbId: string, userId: string) {
    return this.prisma.kbMember
      .findUnique({ where: { kbId_userId: { kbId, userId } }, select: { role: true } })
      .then((m) => m?.role ?? null);
  }

  /** 计算协作角色标注（供前端写入口门控）：admin / owner / editor / viewer / null */
  private resolveMyRole(
    kb: { userId: string | null },
    user: SessionUser,
    memberRole: string | null
  ): string | null {
    if (hasAllScope(user)) return 'admin';
    if (kb.userId === user.id) return 'owner';
    return memberRole;
  }

  async list(query: { keyword?: string; status?: string; page?: number; pageSize?: number }, user: SessionUser) {
    const and: Prisma.KnowledgeBaseWhereInput[] = [
      this.visibilityFilter(user, await this.deptScope(user)),
    ];
    if (query.keyword) {
      and.push({
        OR: [
          { name: { contains: query.keyword } },
          { description: { contains: query.keyword } },
        ],
      });
    }
    if (query.status) and.push({ status: query.status });
    const where: Prisma.KnowledgeBaseWhereInput = { AND: and };

    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 20;

    const [list, total] = await this.prisma.$transaction([
      this.prisma.knowledgeBase.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.knowledgeBase.count({ where }),
    ]);

    // 批量取当前用户在页内各库的成员角色（防 N+1），标注 myRole 供前端写入口判断
    let roleMap = new Map<string, string>();
    if (!hasAllScope(user) && list.length) {
      const memberships = await this.prisma.kbMember.findMany({
        where: { kbId: { in: list.map((k) => k.id) }, userId: user.id },
        select: { kbId: true, role: true },
      });
      roleMap = new Map(memberships.map((m) => [m.kbId, m.role]));
    }

    return {
      list: list.map((kb) => ({
        ...kb,
        myRole: this.resolveMyRole(kb, user, roleMap.get(kb.id) ?? null),
      })),
      total,
      page,
      pageSize,
    };
  }

  /** 已就绪知识库（供问答页下拉选择） */
  async options(user: SessionUser) {
    const list = await this.prisma.knowledgeBase.findMany({
      where: { status: 'ready', AND: [this.visibilityFilter(user, await this.deptScope(user))]},
      select: {
        id: true,
        name: true,
        status: true,
        docCount: true,
        chunkCount: true,
      },
      orderBy: { updatedAt: 'desc' },
    });
    return list;
  }

  async detail(id: string, user: SessionUser) {
    const [kb, memberRole] = await Promise.all([
      this.prisma.knowledgeBase.findUnique({ where: { id } }),
      this.memberRoleOf(id, user.id),
    ]);
    if (!kb) throw new NotFoundException('知识库不存在');
    const deptVisible = await isKbDeptVisible(this.prisma, user.id, kb.orgId);
    if (!canReadKb(kb, user, memberRole, deptVisible)) throw new ForbiddenException('无权访问该知识库');
    return { ...kb, myRole: this.resolveMyRole(kb, user, memberRole) };
  }

  async create(dto: CreateKbDto, user: SessionUser) {
    const config = this.buildConfig(dto);
    // 归属部门（DEPT 可见性的范围依据）：显式指定优先（校验存在），
    // 缺省取创建人主部门，无部门则置空
    let orgId: string | null;
    if (dto.orgId) {
      const dept = await this.prisma.department.findUnique({
        where: { id: dto.orgId },
        select: { id: true },
      });
      if (!dept) throw new BadRequestException('归属部门不存在');
      orgId = dto.orgId;
    } else {
      const primary = await this.prisma.userDepartment.findFirst({
        where: { userId: user.id, isPrimary: true },
        select: { deptId: true },
      });
      orgId = primary?.deptId ?? null;
    }
    const kb = await this.prisma.knowledgeBase.create({
      data: {
        id: genId('kb'),
        name: dto.name,
        description: dto.description,
        icon: dto.icon ?? 'Collection',
        color: dto.color ?? '#3f6ae1',
        status: 'draft',
        embeddingModel: dto.embeddingModel ?? 'bge-large-zh-v1.5',
        vectorStore: dto.vectorStore ?? 'pgvector',
        chunkSize: dto.chunkSize ?? 512,
        chunkOverlap: dto.chunkOverlap ?? 64,
        parser: dto.parser ?? 'smart',
        visibility: dto.visibility ?? 'PRIVATE',
        orgId,
        owner: user.username,
        userId: user.id,
        memberCount: 1,
        ...config,
      } as Prisma.KnowledgeBaseUncheckedCreateInput,
    });
    return { ...kb, myRole: this.resolveMyRole(kb, user, null) };
  }

  /** 写操作归属校验：不存在 → 404；无写权限 → 403。返回库与当前用户成员角色供后续复用 */
  private async assertWritable(id: string, user: SessionUser) {
    const [kb, memberRole] = await Promise.all([
      this.prisma.knowledgeBase.findUnique({ where: { id } }),
      this.memberRoleOf(id, user.id),
    ]);
    if (!kb) throw new NotFoundException('知识库不存在');
    if (!canWriteKb(kb, user, memberRole)) throw new ForbiddenException('无权操作该知识库');
    return { kb, memberRole };
  }

  async update(id: string, dto: UpdateKbDto, user: SessionUser) {
    const { kb: existing, memberRole } = await this.assertWritable(id, user);

    // 可见范围（visibility/orgId）仅 owner / 超管可调：editor 可编辑内容，但不能扩大人群
    if (
      (dto.visibility !== undefined || dto.orgId !== undefined) &&
      existing.userId !== user.id &&
      !hasAllScope(user)
    ) {
      throw new ForbiddenException('仅所有者或管理员可修改可见范围');
    }
    if (dto.orgId) {
      const dept = await this.prisma.department.findUnique({
        where: { id: dto.orgId },
        select: { id: true },
      });
      if (!dept) throw new BadRequestException('归属部门不存在');
    }

    const config = this.buildConfig(dto, {
      retrieverConfig: existing.retrieverConfig,
      llmConfig: existing.llmConfig,
    });

    const data: Prisma.KnowledgeBaseUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.icon !== undefined) data.icon = dto.icon;
    if (dto.color !== undefined) data.color = dto.color;
    if (dto.status !== undefined) data.status = dto.status;
    if (dto.embeddingModel !== undefined) data.embeddingModel = dto.embeddingModel;
    if (dto.vectorStore !== undefined) data.vectorStore = dto.vectorStore;
    if (dto.chunkSize !== undefined) data.chunkSize = dto.chunkSize;
    if (dto.chunkOverlap !== undefined) data.chunkOverlap = dto.chunkOverlap;
    if (dto.parser !== undefined) data.parser = dto.parser;
    if (dto.visibility !== undefined) data.visibility = dto.visibility;
    // 传空串/null 视为清除归属部门
    if (dto.orgId !== undefined) data.orgId = dto.orgId || null;
    data.retrieverConfig = config.retrieverConfig;
    data.llmConfig = config.llmConfig;

    return this.prisma.knowledgeBase
      .update({ where: { id }, data })
      .then((kb) => ({ ...kb, myRole: this.resolveMyRole(kb, user, memberRole) }));
  }

  async remove(id: string, user: SessionUser) {
    const { kb: existing } = await this.assertWritable(id, user);
    await this.prisma.knowledgeBase.delete({ where: { id } });
    // 库已删除：清掉含该库的答案缓存条目（kb_hash 永不再命中，顺带清理存储）
    this.ai.invalidateAnswerCache([id]);
    return { id, name: existing.name };
  }

  /**
   * 重建向量索引：
   * 真实环境由 Python 服务按知识库配置重新解析 + 重新向量化。
   * 这里仅把状态置为 indexing 并记录触发动作（实际操作交给 AI 服务）。
   */
  async reindex(id: string, user: SessionUser) {
    await this.assertWritable(id, user);
    await this.prisma.knowledgeBase.update({
      where: { id },
      data: { status: 'indexing' },
    });
    // 向量将整体重建：失效该库答案语义缓存
    this.ai.invalidateAnswerCache([id]);
    return { id, status: 'indexing' };
  }
}
