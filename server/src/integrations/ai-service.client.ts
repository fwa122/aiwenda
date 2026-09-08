import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * SSE 事件统一结构（与前端 api/chat.js 解析器对齐）：
 * data 行内 JSON 携带 type 字段
 */
export interface AiSseEvent {
  type: 'references' | 'delta' | 'done' | 'error';
  data: any;
}

/** 发给 Python /internal/chat 的请求体 */
export interface InternalChatPayload {
  question: string;
  kbIds: string[];
  model?: string;
  /** [{role, content}]，最近 N 轮 */
  history: { role: string; content: string }[];
  /** 检索/生成参数（来自知识库或系统配置） */
  topK?: number;
  threshold?: number;
  rerank?: boolean;
  /** 混合检索：向量 + 词法召回 + RRF 融合重排 */
  hybrid?: boolean;
  /** 由 Node 从 settings 读取后传入（Python 无状态） */
  systemPrompt?: string;
  fallbackReply?: string;
  /** 采样参数（0~1），用于 GLM 调用 */
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  /** 强制引用：回答无 [n] 编号时由 Python 自动追加来源列表 */
  forceCitation?: boolean;
}

const MOCK_ANSWER = `根据当前知识库内容，为您整理如下回答：

### 结论
AI 服务后端尚未接入真实大模型，当前为 **Node BFF 内置的模拟流式输出**，用于验证问答链路。

### 已验证的能力
1. SSE 协议（references / delta / done / error 四类事件）
2. 消息与引用来源的持久化
3. 前端中断（停止生成）与服务端状态回收

> 接入 Python AI 服务后，本段内容由 LLM 真实生成，本提示将自动消失。`;

@Injectable()
export class AiServiceClient {
  private readonly logger = new Logger(AiServiceClient.name);
  private readonly baseUrl: string;
  private readonly mockMode: boolean;
  private readonly internalToken: string;

  constructor(config: ConfigService) {
    this.baseUrl = (config.get<string>('AI_SERVICE_URL') || 'http://localhost:8000').replace(/\/$/, '');
    this.mockMode = config.get<string>('AI_MOCK') === 'true';
    this.internalToken = config.get<string>('AI_SERVICE_TOKEN') || '';
    if (this.mockMode) {
      this.logger.warn('AI_MOCK=true：SSE 走内置模拟流（不调用 LLM），仅用于联调');
    }
  }

  get isMock(): boolean {
    return this.mockMode;
  }

  /** 内部接口鉴权头（AI 服务 fail-closed：令牌缺失时上游会拒绝请求） */
  private authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.internalToken) {
      headers.Authorization = `Bearer ${this.internalToken}`;
    }
    return headers;
  }

  /** 健康检查（AI 服务就绪探测） */
  async health(timeoutMs = 3000): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/internal/health`, {
        signal: AbortSignal.timeout(timeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** 投递文档解析任务（fire-and-forget，失败不抛出，文档停留 pending） */
  submitParseTask(docId: string): void {
    fetch(`${this.baseUrl}/internal/tasks/parse`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ docId }),
      signal: AbortSignal.timeout(5000),
    }).catch((e) => this.logger.warn(`投递解析任务失败 doc=${docId}: ${e?.message}`));
  }

  /** 读取 AI 服务的真实模型信息（供设置页锁定展示，不支持前端切换） */
  async modelInfo(): Promise<{ model: string; embedding: any; available: boolean }> {
    try {
      const res = await fetch(`${this.baseUrl}/internal/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) throw new Error('bad status');
      const data: any = await res.json();
      return { model: data?.llm?.model || '', embedding: data?.embedding || null, available: true };
    } catch {
      return { model: '', embedding: null, available: false };
    }
  }

  /** 检索（供 retrieval-test 转发） */
  async search(payload: {
    kbIds: string[];
    query: string;
    topK?: number;
    threshold?: number;
    hybrid?: boolean;
    rerank?: boolean;
  }): Promise<{ results: any[]; elapsedMs: number; total: number }> {
    const res = await fetch(`${this.baseUrl}/internal/search`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new Error(`AI 服务检索失败（HTTP ${res.status}）`);
    return res.json();
  }

  /**
   * 附件同步文本提取（临时问答上下文）。
   * 文件以 base64 随 JSON 传输；AI 服务侧 5MB 上限 + 白名单校验，超限/不支持格式抛错。
   */
  async extractAttachment(name: string, base64Content: string): Promise<{ name: string; text: string; chars: number; truncated: boolean }> {
    const res = await fetch(`${this.baseUrl}/internal/extract`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify({ name, base64Content }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        detail = (await res.json())?.detail || detail;
      } catch {
        /* 保留状态码 */
      }
      throw new Error(detail);
    }
    return res.json();
  }

  /**
   * 流式问答。返回 SSE 事件异步迭代器。
   * - mock 模式：内置假流
   * - 真实模式：转发 Python /internal/chat 的 SSE
   * @param signal 前端断开时触发 abort
   */
  async *streamChat(
    payload: InternalChatPayload,
    signal?: AbortSignal
  ): AsyncGenerator<AiSseEvent> {
    if (this.mockMode) {
      yield* this.mockStream(payload, signal);
      return;
    }
    yield* this.upstreamStream(payload, signal);
  }

  /** 真实上游：解析 Python 返回的 SSE */
  private async *upstreamStream(
    payload: InternalChatPayload,
    signal?: AbortSignal
  ): AsyncGenerator<AiSseEvent> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/internal/chat`, {
        method: 'POST',
        headers: this.authHeaders(),
        body: JSON.stringify(payload),
        signal,
      });
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      throw new Error(`AI 服务连接失败（${this.baseUrl}）`);
    }
    if (!res.ok || !res.body) {
      throw new Error(`AI 服务响应异常（HTTP ${res.status}）`);
    }

    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    try {
      for await (const chunk of res.body as any) {
        buffer += decoder.decode(chunk, { stream: true });
        // SSE 事件以空行分隔
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';
        for (const block of blocks) {
          const evt = this.parseSseBlock(block);
          if (evt) yield evt;
        }
      }
      const tail = this.parseSseBlock(buffer);
      if (tail) yield tail;
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      throw e;
    }
  }

  /** 解析单个 SSE 块（取 data: 行），忽略注释/心跳 */
  private parseSseBlock(block: string): AiSseEvent | null {
    for (const line of block.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const raw = trimmed.slice(5).trim();
      if (!raw || raw === '[DONE]') continue;
      try {
        const evt = JSON.parse(raw);
        if (evt && typeof evt.type === 'string') {
          return { type: evt.type, data: evt.data ?? null };
        }
      } catch {
        /* 忽略不可解析行 */
      }
    }
    return null;
  }

  /** 内置假流：验证 SSE 全链路用 */
  private async *mockStream(
    payload: InternalChatPayload,
    signal?: AbortSignal
  ): AsyncGenerator<AiSseEvent> {
    const sleep = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
      });

    try {
      await sleep(600); // 模拟检索耗时
      yield { type: 'references', data: [] }; // 暂无真实检索，来源为空

      // 按 2~5 字符切片推送，模拟 token 粒度
      let cursor = 0;
      while (cursor < MOCK_ANSWER.length) {
        if (signal?.aborted) return;
        const size = 2 + Math.floor(Math.random() * 4);
        yield {
          type: 'delta',
          data: { content: MOCK_ANSWER.slice(cursor, cursor + size) },
        };
        cursor += size;
        await sleep(16 + Math.random() * 24);
      }

      yield {
        type: 'done',
        data: {
          meta: {
            model: payload.model || 'mock',
            elapsedMs: 0, // 由 chat.service 统一计算
            tokens: {
              prompt: 320 + payload.question.length * 8,
              completion: Math.ceil(MOCK_ANSWER.length / 1.6),
            },
          },
        },
      };
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      throw e;
    }
  }
}
