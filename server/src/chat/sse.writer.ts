import { Response } from 'express';

/**
 * SSE 写入器：统一响应头、事件封装、心跳。
 * 事件格式与前端 api/chat.js 解析器对齐：`data: {"type":"...","data":...}\n\n`
 */
export class SseWriter {
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(private readonly res: Response) {}

  /** 设置响应头并开始心跳 */
  open() {
    const res = this.res;
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // 防 Nginx 缓冲
    res.flushHeaders?.();

    // 15s 心跳，注释行前端解析器会忽略
    this.heartbeat = setInterval(() => {
      this.raw(': ping\n\n');
    }, 15000);
  }

  /** 发送业务事件 */
  event(type: string, data: unknown) {
    this.raw(`data: ${JSON.stringify({ type, data })}\n\n`);
  }

  /** 原样写入（心跳/注释行） */
  raw(text: string) {
    if (!this.res.writableEnded) {
      this.res.write(text);
    }
  }

  /** 结束流并清理心跳 */
  close() {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (!this.res.writableEnded) {
      this.res.end();
    }
  }
}
