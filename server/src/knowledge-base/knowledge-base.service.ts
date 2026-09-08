import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { genId } from '../common/id.util';
import { canReadKb, canWriteKb, SessionUser } from '../common/kb-access';
import { PrismaService } from '../prisma/prisma.service';
import { CreateKbDto, UpdateKbDto } from './dto/knowledge-base.dto';

const DEFAULT_RETRIEVER = {
  topK: 5,
  threshold: 0.28,
  rerank: true,
  rerankModel: 'bge-reranker-large',
  hybrid: true,
};

const DEFAULT_LLM = {
  provider: 'zhipu',
  model: 'glm-4-flash',
  temperature: 0.3,
};

@Injectable()
export class KnowledgeBaseService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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

  /** 列表/下拉可见性过滤：admin 全可见；普通用户可见 internal/public + 自己的 private */
  private visibilityFilter(user: SessionUser): Prisma.KnowledgeBaseWhereInput {
    if (user.role === 'admin') return {};
    return { OR: [{ userId: user.id }, { visibility: { not: 'private' } }] };
  }

  async list(query: { keyword?: string; status?: string; page?: number; pageSize?: number }, user: SessionUser) {
    const and: Prisma.KnowledgeBaseWhereInput[] = [this.visibilityFilter(user)];
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

    return { list, total, page, pageSize };
  }

  /** 已就绪知识库（供问答页下拉选择） */
  async options(user: SessionUser) {
    const list = await this.prisma.knowledgeBase.findMany({
      where: { status: 'ready', AND: [this.visibilityFilter(user)] },
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
    const kb = await this.prisma.knowledgeBase.findUnique({ where: { id } });
    if (!kb) throw new NotFoundException('知识库不存在');
    if (!canReadKb(kb, user)) throw new ForbiddenException('无权访问该知识库');
    return kb;
  }

  async create(dto: CreateKbDto, user: SessionUser) {
    const config = this.buildConfig(dto);
    return this.prisma.knowledgeBase.create({
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
        visibility: dto.visibility ?? 'internal',
        owner: user.username,
        userId: user.id,
        memberCount: 1,
        ...config,
      } as Prisma.KnowledgeBaseUncheckedCreateInput,
    });
  }

  /** 写操作归属校验：不存在 → 404；无写权限 → 403 */
  private async assertWritable(id: string, user: SessionUser) {
    const kb = await this.prisma.knowledgeBase.findUnique({ where: { id } });
    if (!kb) throw new NotFoundException('知识库不存在');
    if (!canWriteKb(kb, user)) throw new ForbiddenException('无权操作该知识库');
    return kb;
  }

  async update(id: string, dto: UpdateKbDto, user: SessionUser) {
    const existing = await this.assertWritable(id, user);

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
    data.retrieverConfig = config.retrieverConfig;
    data.llmConfig = config.llmConfig;

    return this.prisma.knowledgeBase.update({ where: { id }, data });
  }

  async remove(id: string, user: SessionUser) {
    const existing = await this.assertWritable(id, user);
    await this.prisma.knowledgeBase.delete({ where: { id } });
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
    return { id, status: 'indexing' };
  }
}
