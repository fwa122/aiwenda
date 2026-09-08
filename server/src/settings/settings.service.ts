import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/settings.dto';

/** 与前端 SettingsView 默认值一致（接口文档第八章） */
export const DEFAULT_SETTINGS = {
  model: {
    provider: 'zhipu',
    model: 'glm-4-flash',
    temperature: 0.3,
    topP: 0.85,
    maxTokens: 2048,
    contextRounds: 5,
    systemPrompt: '你是企业知识库助手。请严格依据给定的知识库片段回答问题，使用简洁专业的中文。若片段中没有答案，请明确说明，不要编造。回答中需标注引用编号，如 [1]。',
    enableStream: true,
    enableCitation: true,
    fallbackReply: '抱歉，我未在知识库中检索到相关内容，建议您换个问法或补充更多背景信息。',
  },
  retrieval: {
    topK: 5,
    threshold: 0.28,
    rerank: true,
    rerankModel: 'bge-reranker-large',
    hybrid: true,
    vectorWeight: 0.7,
  },
  security: {
    enableAuditLog: true,
    auditRetentionDays: 180,
    enableRegister: true,
    enableSensitiveFilter: true,
    ipWhitelist: '',
    sessionTimeout: 120,
  },
  storage: {
    vectorStore: 'pgvector',
    vectorDim: 1024,
    embeddingModel: 'bge-large-zh-v1.5',
    maxFileSize: 100,
    ocrEnabled: true,
  },
};

const SETTINGS_ID = 1;

@Injectable()
export class SettingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 读取设置；首次访问自动播种默认值（单行表 id=1） */
  async get() {
    const row = await this.prisma.systemSetting.findUnique({ where: { id: SETTINGS_ID } });
    if (row) return row;
    return this.prisma.systemSetting.create({
      data: {
        id: SETTINGS_ID,
        model: DEFAULT_SETTINGS.model as Prisma.InputJsonValue,
        retrieval: DEFAULT_SETTINGS.retrieval as Prisma.InputJsonValue,
        security: DEFAULT_SETTINGS.security as Prisma.InputJsonValue,
        storage: DEFAULT_SETTINGS.storage as Prisma.InputJsonValue,
      },
    });
  }

  /** 按分区合并更新 */
  async update(dto: UpdateSettingsDto) {
    const current = await this.get();
    const merge = (section: Record<string, any> | undefined, existing: any) =>
      section ? { ...(existing || {}), ...section } : existing;

    return this.prisma.systemSetting.update({
      where: { id: SETTINGS_ID },
      data: {
        model: merge(dto.model, current.model) as Prisma.InputJsonValue,
        retrieval: merge(dto.retrieval, current.retrieval) as Prisma.InputJsonValue,
        security: merge(dto.security, current.security) as Prisma.InputJsonValue,
        storage: merge(dto.storage, current.storage) as Prisma.InputJsonValue,
      },
    });
  }
}
