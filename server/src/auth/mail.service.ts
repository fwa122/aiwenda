import {
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * SMTP 邮件发送（QQ 邮箱等）：配置从环境变量读取（SMTP_HOST/PORT/SECURE/USER/PASS/FROM）。
 * 未配置时 configured=false，发码接口直接 503 给出可读提示——不静默吞掉，避免「以为发了实际没发」。
 * transport 懒初始化（首次发信时创建），发信失败转 502 可读错误（上游 SMTP 拒绝等）。
 */
@Injectable()
export class MailService {
  private transporter: nodemailer.Transporter | null = null;

  constructor(private readonly config: ConfigService) {}

  get configured(): boolean {
    return !!(this.config.get<string>('SMTP_HOST') && this.config.get<string>('SMTP_USER'));
  }

  /** 发送验证码邮件（统一模板；QQ 邮箱 465 SSL） */
  async sendCode(to: string, code: string, minutes = 5): Promise<void> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        '邮件服务未配置（SMTP_HOST/SMTP_USER），请联系管理员在 .env 中配置后重启'
      );
    }
    const transport = (this.transporter ??= nodemailer.createTransport({
      host: this.config.get<string>('SMTP_HOST'),
      port: Number(this.config.get<string>('SMTP_PORT')) || 465,
      secure: this.config.get<string>('SMTP_SECURE') !== 'false', // 默认 SSL（465）
      auth: {
        user: this.config.get<string>('SMTP_USER'),
        pass: this.config.get<string>('SMTP_PASS'),
      },
    }));
    const from = this.config.get<string>('SMTP_FROM') || this.config.get<string>('SMTP_USER');
    try {
      await transport.sendMail({
        from: `"AI 知识库问答" <${from}>`,
        to,
        subject: `【验证码】您的验证码是 ${code}（${minutes} 分钟内有效）`,
        html: `
          <div style="max-width:480px;margin:0 auto;padding:24px;font-family:'PingFang SC','Microsoft YaHei',sans-serif;color:#2c3e50">
            <h2 style="margin:0 0 12px;font-size:18px">AI 知识库问答系统</h2>
            <p style="margin:0 0 16px;font-size:14px;color:#5f6b7a">您正在进行身份验证，本次验证码为：</p>
            <div style="display:inline-block;padding:12px 28px;background:#f0f4ff;border-radius:8px;font-size:28px;font-weight:700;letter-spacing:8px;color:#3f6ae1">${code}</div>
            <p style="margin:16px 0 0;font-size:13px;color:#8a94a3">验证码 ${minutes} 分钟内有效，请勿泄露给他人。若非本人操作，请忽略本邮件。</p>
          </div>`,
      });
    } catch (e: any) {
      throw new HttpException(
        `验证码邮件发送失败：${e?.response || e?.message || 'SMTP 错误'}`,
        502
      );
    }
  }
}

/** 邮箱验证码存取（Redis）：5 分钟有效、60 秒发送冷却、连续错 5 次销毁（防爆破 6 位码） */
@Injectable()
export class EmailCodeService {
  static readonly TTL_SEC = 5 * 60;
  static readonly COOL_SEC = 60;
  static readonly MAX_FAILS = 5;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private codeKey(scene: string, email: string) {
    return `emailcode:${scene}:${email}`;
  }
  private failKey(scene: string, email: string) {
    return `emailcode:fail:${scene}:${email}`;
  }
  private coolKey(scene: string, email: string) {
    return `emailcode:cool:${scene}:${email}`;
  }

  /** 生成并缓存验证码；60s 冷却内拒绝（邮件轰炸防护，图形码校验在前） */
  async issue(scene: string, email: string): Promise<string> {
    if (await this.redis.get(this.coolKey(scene, email))) {
      throw new HttpException('发送过于频繁，请 60 秒后再试', 429);
    }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.redis.set(this.codeKey(scene, email), code, 'EX', EmailCodeService.TTL_SEC);
    await this.redis.set(this.coolKey(scene, email), '1', 'EX', EmailCodeService.COOL_SEC);
    await this.redis.del(this.failKey(scene, email)).catch(() => {});
    return code;
  }

  /**
   * 校验一次性：错误计数满 5 次销毁；过期/错误统一 400，不泄露具体原因。
   * v0.9.57 防并发双花：GET 与 DEL 若分两步，同一验证码并发两发可都读到有效值、
   * 各自通过（同邮箱并发注册两个账号）。改 Lua 原子比较——**值相等才删**：
   * 正确码并发第二发必落空，错误码保留（维持「错 5 次才销毁」的手滑容错）。
   */
  private static readonly VERIFY_LUA =
    'local v = redis.call("GET", KEYS[1]) if v and v == ARGV[1] then redis.call("DEL", KEYS[1]) end return v';

  async verify(scene: string, email: string, code: string): Promise<void> {
    const key = this.codeKey(scene, email);
    const trimmed = (code || '').trim();
    const saved = (await this.redis
      .eval(EmailCodeService.VERIFY_LUA, 1, key, trimmed)
      .catch(() => null)) as string | null;
    if (!saved) throw new HttpException('验证码已过期，请重新获取', 400);
    if (saved !== trimmed) {
      const fails = await this.redis.incr(this.failKey(scene, email));
      await this.redis.expire(this.failKey(scene, email), EmailCodeService.TTL_SEC);
      if (fails >= EmailCodeService.MAX_FAILS) {
        await this.redis.del(key).catch(() => {});
      }
      throw new HttpException('验证码错误', 400);
    }
    // 正确匹配：Lua 已原子删除，无需再 del
  }
}
