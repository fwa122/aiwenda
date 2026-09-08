import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { genId } from '../common/id.util';
import { canReadKb } from '../common/kb-access';
import { PrismaService } from '../prisma/prisma.service';
import { AiServiceClient, AiSseEvent } from '../integrations/ai-service.client';
import { ConversationService, SourceView } from '../conversation/conversation.service';
import { ChatCompletionDto } from './dto/chat.dto';
import { SseWriter } from './sse.writer';

/** 首页推荐问题 / 快捷引导词（静态配置，结构与前端 Mock 一致） */
export const SUGGESTIONS = [
  { title: '如何快速接入平台', desc: '三步完成知识库搭建与助手发布', icon: 'Rocket' },
  { title: '支持哪些文档格式', desc: 'PDF、Word、Excel、PPT 等 12 种格式', icon: 'Document' },
  { title: '检索原理是什么', desc: '向量召回 + BM25 + Rerank 三段式', icon: 'Search' },
];

export const QUICK_PROMPTS = [
  '总结这份文档的核心要点',
  '这份文档提到了哪些截止时间？',
  '用要点形式列出操作步骤',
  '文档中提到的参数默认值是多少？',
];

const DEFAULT_CONTEXT_ROUNDS = 5; // 未配置时的默认携带轮数
const MAX_CONTEXT_ROUNDS = 10; // 上下文轮数上限（防止上下文过长撑爆 token）
const DEFAULT_RETRIEVER = { topK: 5, threshold: 0.28, rerank: true, hybrid: true };

interface DoneMeta {
  model: string;
  elapsedMs: number;
  tokens: { prompt: number; completion: number; total: number };
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly ai: AiServiceClient,
    private readonly conversationService: ConversationService
  ) {}

  /** ===== 附件（临时问答上下文）：文件不落盘不入库，文本缓存 10 分钟一次性消费 ===== */
  private readonly attCache = new Map<string, { name: string; text: string; expiresAt: number }>();
  private static readonly ATTACH_EXTS = ['pdf', 'docx', 'txt', 'md', 'csv'];
  private static readonly ATTACH_TTL_MS = 10 * 60 * 1000;

  /** 上传附件：同步提取文本入缓存，返回附件元信息 */
  async createAttachments(_userId: string, files: { name: string; base64Content: string }[]) {
    if (!files?.length) throw new BadRequestException('未选择附件');
    if (files.length > 2) throw new BadRequestException('每次最多上传 2 个附件');
    const out: { id: string; name: string; chars: number; truncated: boolean }[] = [];
    for (const f of files) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      if (!ChatService.ATTACH_EXTS.includes(ext)) {
        throw new BadRequestException(
          `不支持的附件格式 .${ext || '(无扩展名)'}，仅允许: ${ChatService.ATTACH_EXTS.join(', ')}`
        );
      }
      // base64 长度粗校验（5MB 文件 base64 后约 6.7M 字符，留少量余量）
      if (f.base64Content.length > 7_000_000) {
        throw new PayloadTooLargeException('附件超过 5MB 上限');
      }
      const res = await this.ai.extractAttachment(f.name, f.base64Content);
      const id = genId('att');
      this.attCache.set(id, {
        name: f.name,
        text: res.text,
        expiresAt: Date.now() + ChatService.ATTACH_TTL_MS,
      });
      out.push({ id, name: f.name, chars: res.chars, truncated: res.truncated });
    }
    return out;
  }

  /** 取回并删除附件文本（一次性使用）；顺带惰性清理过期项 */
  private takeAttachments(ids?: string[]): { name: string; text: string }[] {
    if (!ids?.length) return [];
    const now = Date.now();
    for (const [k, v] of this.attCache) if (v.expiresAt < now) this.attCache.delete(k);
    const out: { name: string; text: string }[] = [];
    for (const id of ids.slice(0, 2)) {
      const item = this.attCache.get(id);
      if (!item) continue;
      this.attCache.delete(id);
      out.push({ name: item.name, text: item.text });
    }
    return out;
  }

  /** 当前真实生效的模型（来自 Python AI 服务） */
  async modelInfo() {
    const info = await this.ai.modelInfo();
    return {
      model: info.model,
      embedding: info.embedding,
      available: info.available,
      note: info.available
        ? '当前模型由服务端（ai-service/.env）配置，暂不支持前端切换'
        : 'AI 服务不可用，无法获取模型信息',
    };
  }

  /** SSE 问答主流程 */
  async streamAnswer(userId: string, dto: ChatCompletionDto, req: Request, res: Response, sse: SseWriter) {
    const startedAt = Date.now();
    const model = dto.model || 'unknown';

    // 1.5 配额校验：月度 token 限额（跨月自动归零）
    const quotaUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { monthlyTokenLimit: true, monthlyTokenUsed: true, tokenMonth: true },
    });
    if (quotaUser) {
      const month = new Date().toISOString().slice(0, 7);
      const used = quotaUser.tokenMonth === month ? quotaUser.monthlyTokenUsed : 0;
      if (quotaUser.monthlyTokenLimit > 0 && used >= quotaUser.monthlyTokenLimit) {
        throw new ConflictException(
          `本月 token 额度已用尽（${quotaUser.monthlyTokenLimit}），请联系管理员调整`,
        );
      }
    }

    // 1. 会话：有则校验归属，无则代建（★方案已确认的兜底行为）
    let conversation;
    if (dto.conversationId) {
      conversation = await this.prisma.conversation.findFirst({
        where: { id: dto.conversationId, userId },
      });
      if (!conversation) throw new NotFoundException('会话不存在');
    } else {
      // 走 service 以复用会话数配额校验
      conversation = await this.conversationService.create(userId, {
        title: dto.question.slice(0, 20),
        kbIds: dto.kbIds || [],
        model: dto.model,
      });
    }
    const kbIds = await this.filterVisibleKbs(dto.kbIds || ((conversation.kbIds as string[]) || []), userId);
    const usedModel = dto.model || conversation.model || model;
    // 附件：取回已提取文本（用后即删），随请求传给 AI 服务作为本次上下文
    const attachments = this.takeAttachments(dto.attachmentIds);

    // 2. 先持久化两条消息（断线也不丢用户输入）
    const userMsg = await this.prisma.message.create({
      data: {
        id: genId('msg'),
        conversationId: conversation.id,
        role: 'user',
        content: dto.question,
        status: 'done',
      },
    });
    const assistantMsg = await this.prisma.message.create({
      data: {
        id: genId('msg'),
        conversationId: conversation.id,
        role: 'assistant',
        content: '',
        status: 'streaming',
        meta: { model: usedModel } as Prisma.InputJsonValue,
      },
    });

    // 3. 系统设置（模型采样参数 / 上下文轮数 / 提示词 / 兜底话术）
    const settings = await this.prisma.systemSetting.findUnique({ where: { id: 1 } });
    const modelSettings: any = settings?.model || {};
    const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
    const systemPrompt: string = modelSettings.systemPrompt || undefined;
    const fallbackReply: string = modelSettings.fallbackReply || undefined;
    /** 上下文轮数：上限 10 轮，防止上下文过长撑爆 token */
    const contextRounds = clamp(
      Number(modelSettings.contextRounds) || DEFAULT_CONTEXT_ROUNDS,
      1,
      MAX_CONTEXT_ROUNDS,
    );
    const temperature =
      typeof modelSettings.temperature === 'number' ? clamp(modelSettings.temperature, 0, 1) : undefined;
    const topP =
      typeof modelSettings.topP === 'number' ? clamp(modelSettings.topP, 0, 1) : undefined;
    const maxTokens =
      typeof modelSettings.maxTokens === 'number'
        ? clamp(modelSettings.maxTokens, 256, 8192)
        : undefined;
    /** 强制引用：无 [n] 编号时由 Python 自动追加来源列表 */
    const forceCitation = modelSettings.enableCitation !== false;

    // 4. 历史 N 轮上下文（当前 user 消息之前）
    const historyRows = await this.prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        createdAt: { lt: userMsg.createdAt },
        status: { in: ['done', 'stopped'] },
      },
      orderBy: { createdAt: 'desc' },
      take: contextRounds * 2,
    });
    const history = historyRows.reverse().map((m) => ({ role: m.role, content: m.content }));

    // 5. 检索参数：优先取第一个知识库配置；允许会话级覆盖
    const baseRetriever = await this.resolveRetriever(kbIds);
    const override = (dto as any).retriever || {};
    const retriever = {
      topK: override.topK ?? baseRetriever.topK,
      threshold: override.threshold ?? baseRetriever.threshold,
      rerank: override.rerank ?? baseRetriever.rerank,
      hybrid: override.hybrid ?? baseRetriever.hybrid,
    };

    // 6. 中断控制：前端断开 → abort 上游
    // 注意：Node 18+ 中 IncomingMessage 的 'close' 在请求体读完即可能触发语义变化，
    // 客户端「提前断开」必须监听 ServerResponse 的 'close'/'error'（以 writableEnded 判定）
    const abort = new AbortController();
    let clientGone = false;
    let finalized = false;
    let accumulated = '';
    let refsCount = 0; // 本次问答命中片段数（用于命中率统计）
    const onClientGone = () => {
      if (clientGone || res.writableEnded) return;
      clientGone = true;
      abort.abort();
    };
    res.on('close', onClientGone);
    res.on('error', onClientGone);
    req.on('error', onClientGone);

    sse.open();

    /** 收尾：回写 assistant 消息 + 会话计数（幂等） */
    const finalize = async (status: 'done' | 'stopped' | 'error', meta?: DoneMeta & { error?: string }) => {
      if (finalized) return;
      finalized = true;
      res.off('close', onClientGone);
      res.off('error', onClientGone);
      req.off('error', onClientGone);

      const metaJson: Prisma.InputJsonValue = {
        model: usedModel,
        elapsedMs: Date.now() - startedAt,
        ...(meta || {}),
      } as Prisma.InputJsonValue;

      await this.prisma.message.update({
        where: { id: assistantMsg.id },
        data: { content: accumulated, status, meta: metaJson },
      });
      const messageCount = await this.prisma.message.count({
        where: { conversationId: conversation.id },
      });
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          messageCount,
          ...(status === 'done' && meta?.tokens
            ? { tokenUsed: { increment: meta.tokens.total } }
            : {}),
        },
      });

      // 平台日粒度统计 + 用户月度用量（仅成功完成时计入）
      if (status === 'done' && meta?.tokens) {
        const today = new Date().toISOString().slice(0, 10);
        const elapsed = meta.elapsedMs || 0;
        const hit = refsCount > 0 ? 1 : 0;
        const total = meta.tokens.total;
        await this.prisma.$executeRaw`
          INSERT INTO daily_stats (date, questions, hit_count, avg_latency, tokens, active_users, created_at, updated_at)
          VALUES (${today}::date, 1, ${hit}, ${elapsed}, ${total}, 1, NOW(), NOW())
          ON CONFLICT (date) DO UPDATE SET
            questions = daily_stats.questions + 1,
            hit_count = daily_stats.hit_count + ${hit},
            avg_latency = (daily_stats.avg_latency * daily_stats.questions + ${elapsed}) / (daily_stats.questions + 1),
            tokens = daily_stats.tokens + ${total},
            active_users = (
              SELECT COUNT(DISTINCT c.user_id) FROM messages m
              JOIN conversations c ON c.id = m.conversation_id
              WHERE m.created_at::date = ${today}::date
            ),
            updated_at = NOW()`;

        const month = today.slice(0, 7);
        await this.prisma.$executeRaw`
          UPDATE users SET
            monthly_token_used = CASE WHEN token_month = ${month} THEN monthly_token_used + ${total} ELSE ${total} END,
            token_month = ${month}
          WHERE id = ${userId}`;
      }
    };

    try {
      const stream = this.ai.streamChat(
        {
          question: dto.question,
          kbIds,
          model: usedModel,
          history,
          ...retriever,
          systemPrompt,
          fallbackReply,
          temperature,
          topP,
          maxTokens,
          forceCitation,
          ...(attachments.length ? { attachments } : {}),
        },
        abort.signal
      );

      for await (const evt of stream) {
        if (clientGone) break;

        if (evt.type === 'references') {
          refsCount = Array.isArray(evt.data) ? evt.data.length : 0;
          await this.handleReferences(evt, assistantMsg.id, sse);
        } else if (evt.type === 'delta') {
          const text = evt.data?.content || '';
          accumulated += text;
          sse.event('delta', { content: text });
        } else if (evt.type === 'done') {
          const meta: DoneMeta = {
            model: evt.data?.meta?.model || usedModel,
            elapsedMs: evt.data?.meta?.elapsedMs || Date.now() - startedAt,
            tokens: {
              prompt: evt.data?.meta?.tokens?.prompt || 0,
              completion: evt.data?.meta?.tokens?.completion || 0,
              total:
                (evt.data?.meta?.tokens?.prompt || 0) +
                (evt.data?.meta?.tokens?.completion || 0),
            },
          };
          await finalize('done', meta);
          sse.event('done', {
            messageId: assistantMsg.id,
            conversationId: conversation.id,
            meta,
          });
        } else if (evt.type === 'error') {
          // 上游显式报错：视为失败收尾
          throw new Error(evt.data?.message || '生成失败');
        }
      }

      // 前端断开：保留已收正文，标记 stopped
      if (clientGone && !finalized) {
        await finalize('stopped');
      }
      // 上游结束但未发 done（容错）
      if (!clientGone && !finalized) {
        const meta: DoneMeta = {
          model: usedModel,
          elapsedMs: Date.now() - startedAt,
          tokens: { prompt: 0, completion: 0, total: 0 },
        };
        await finalize('done', meta);
        sse.event('done', {
          messageId: assistantMsg.id,
          conversationId: conversation.id,
          meta,
        });
      }
    } catch (e: any) {
      const message = e?.name === 'AbortError' ? '生成已停止' : e?.message || 'AI 服务暂不可用';
      if (clientGone || e?.name === 'AbortError') {
        this.logger.log(`客户端断开，已保留 ${accumulated.length} 字`);
        await finalize('stopped');
      } else {
        this.logger.warn(`SSE 异常: ${message}`);
        await finalize('error', { error: message } as any);
        sse.event('error', { message });
      }
    } finally {
      sse.close();
    }
  }

  /** references 事件：坐标落库 → 批量补全展示信息 → 透传 */
  private async handleReferences(evt: AiSseEvent, assistantMsgId: string, sse: SseWriter) {
    const refs: any[] = Array.isArray(evt.data) ? evt.data : [];
    if (!refs.length) {
      sse.event('references', [] as SourceView[]);
      return;
    }
    await this.prisma.messageSource.createMany({
      data: refs.map((r, i) => ({
        messageId: assistantMsgId,
        kbId: r.kbId,
        docId: r.docId,
        chunkId: r.chunkId,
        chunkIndex: Number(r.chunkIndex) || 0,
        page: Number(r.page) || 1,
        score: Number(r.score) || 0,
        sortOrder: i,
      })),
    });
    const sourceMap = await this.conversationService.resolveSources([assistantMsgId]);
    sse.event('references', sourceMap.get(assistantMsgId) || []);
  }

  /** 防越权：只保留当前用户可见（internal/public 或自己的 private）的知识库 */
  private async filterVisibleKbs(kbIds: string[], userId: string): Promise<string[]> {
    if (!kbIds.length) return kbIds;
    const [user, kbs] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } }),
      this.prisma.knowledgeBase.findMany({
        where: { id: { in: kbIds } },
        select: { id: true, userId: true, visibility: true },
      }),
    ]);
    if (user?.role === 'admin') return kbIds;
    return kbs
      .filter((kb) => canReadKb(kb, { id: userId, username: '', role: user?.role || 'viewer' }))
      .map((kb) => kb.id);
  }

  /** 从知识库读取检索参数；无知识库时用默认值 */
  private async resolveRetriever(kbIds: string[]) {
    const firstKbId = kbIds[0];
    if (!firstKbId) return DEFAULT_RETRIEVER;
    const kb = await this.prisma.knowledgeBase.findUnique({
      where: { id: firstKbId },
      select: { retrieverConfig: true },
    });
    const cfg: any = kb?.retrieverConfig || {};
    return {
      topK: cfg.topK ?? DEFAULT_RETRIEVER.topK,
      threshold: cfg.threshold ?? DEFAULT_RETRIEVER.threshold,
      rerank: cfg.rerank ?? DEFAULT_RETRIEVER.rerank,
      hybrid: cfg.hybrid ?? DEFAULT_RETRIEVER.hybrid,
    };
  }
}
