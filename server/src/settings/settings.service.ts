import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AiServiceClient } from '../integrations/ai-service.client';
import { UpdateSettingsDto } from './dto/settings.dto';

/** 与前端 SettingsView 默认值一致（接口文档第八章） */
export const DEFAULT_SETTINGS = {
  model: {
    provider: 'qianwen',
    model: 'qwen3.8-max',
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
  // 语义缓存（v0.9.40）：同库组合下语义相近问题直接复用答案，命中毫秒级响应
  cache: {
    enableSemanticCache: true,
    cacheThreshold: 0.12, // cosine 距离上限（≈相似度 0.88），偏严格防答非所问
    cacheTtlDays: 7,
  },
};

const SETTINGS_ID = 1;

/** LLM API Key 支持的渠道（与 ai-service keystore.PROVIDERS 保持一致） */
const API_KEY_PROVIDERS = ['zhipu', 'qianwen', 'moonshot'] as const;
type ApiKeyProvider = (typeof API_KEY_PROVIDERS)[number];

/** apiKeys 脱敏形态：configured 仅代表设置页（DB）已配置；.env 默认值由 /internal/health 的 keyPresence 补充 */
export interface MaskedApiKey {
  configured: boolean;
  /** 尾 4 位（仅 DB 已配置时非空） */
  tail: string;
  source: 'db' | 'none';
}

/** 明文 key → 脱敏形态（接口出口统一走这里，任何路径不得返回明文） */
function maskApiKeys(apiKeys: Prisma.JsonValue | null): Record<ApiKeyProvider, MaskedApiKey> {
  const raw = (apiKeys && typeof apiKeys === 'object' ? apiKeys : {}) as Record<string, unknown>;
  const out = {} as Record<ApiKeyProvider, MaskedApiKey>;
  for (const p of API_KEY_PROVIDERS) {
    const v = typeof raw[p] === 'string' ? (raw[p] as string) : '';
    out[p] = { configured: !!v, tail: v ? v.slice(-4) : '', source: v ? 'db' : 'none' };
  }
  return out;
}

@Injectable()
export class SettingsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AiServiceClient) private readonly ai: AiServiceClient
  ) {}

  /** 读取设置（apiKeys 已脱敏）；首次访问自动播种默认值（单行表 id=1） */
  async get() {
    const row = await this.getRaw();
    return { ...row, apiKeys: maskApiKeys(row.apiKeys) };
  }

  /** 内部读取原始行（合并基线需要明文 apiKeys） */
  private async getRaw() {
    const row = await this.prisma.systemSetting.findUnique({ where: { id: SETTINGS_ID } });
    if (row) return row;
    return this.prisma.systemSetting.create({
      data: {
        id: SETTINGS_ID,
        model: DEFAULT_SETTINGS.model as Prisma.InputJsonValue,
        retrieval: DEFAULT_SETTINGS.retrieval as Prisma.InputJsonValue,
        security: DEFAULT_SETTINGS.security as Prisma.InputJsonValue,
        storage: DEFAULT_SETTINGS.storage as Prisma.InputJsonValue,
        cache: DEFAULT_SETTINGS.cache as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * 按分区合并更新；apiKeys 三态语义：undefined=不变更、空串=清除（回落 .env）、非空=写入覆盖。
   * 返回值同样脱敏（update 直接返回 prisma 行，明文易漏）。
   */
  async update(dto: UpdateSettingsDto) {
    const current = await this.getRaw();
    const merge = (section: Record<string, any> | undefined, existing: any) =>
      section ? { ...(existing || {}), ...section } : existing;

    const data: Prisma.SystemSettingUpdateInput = {
      model: merge(dto.model, current.model) as Prisma.InputJsonValue,
      retrieval: merge(dto.retrieval, current.retrieval) as Prisma.InputJsonValue,
      security: merge(dto.security, current.security) as Prisma.InputJsonValue,
      storage: merge(dto.storage, current.storage) as Prisma.InputJsonValue,
      cache: merge(dto.cache, current.cache) as Prisma.InputJsonValue,
    };
    if (dto.apiKeys) {
      data.apiKeys = this.mergeApiKeys(current.apiKeys, dto.apiKeys);
    }

    const row = await this.prisma.systemSetting.update({ where: { id: SETTINGS_ID }, data });
    if (dto.apiKeys) {
      // key 变更才推送 Python 失效缓存（fire-and-forget，失败不影响保存；worker 靠 TTL 兜底）
      this.ai.reloadKeys();
    }
    return { ...row, apiKeys: maskApiKeys(row.apiKeys) };
  }

  /** 未提及的既有 key 保留；空串删除；非空 trim 后覆盖。全空时整列置 null */
  private mergeApiKeys(
    current: Prisma.JsonValue | null,
    input: { zhipu?: string; qianwen?: string; moonshot?: string }
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    const raw = (current && typeof current === 'object' ? current : {}) as Record<string, unknown>;
    const next: Record<string, string> = {};
    for (const p of API_KEY_PROVIDERS) {
      const v = raw[p];
      if (typeof v === 'string' && v) next[p] = v;
    }
    for (const p of API_KEY_PROVIDERS) {
      const v = input[p];
      if (v === undefined) continue; // 不变更
      const trimmed = v.trim().slice(0, 300);
      if (!trimmed) delete next[p]; // 空串=清除
      else next[p] = trimmed; // 覆盖写入
    }
    return Object.keys(next).length ? next : Prisma.JsonNull;
  }
}
