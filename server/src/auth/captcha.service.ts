import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * 图形验证码（自绘 SVG，零外部依赖）：4 位小写字符 + 随机旋转 + 干扰线。
 * 答案存 Redis（captcha:{id}）5 分钟有效、校验一次性（防重放），比较前统一小写。
 * Redis 故障 fail-closed：验证码服务不可用即拒绝发码（安全优先，与 refresh 一致）。
 */
const CAPTCHA_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789'; // 去易混淆 0o1i
const CAPTCHA_TTL_SEC = 300;
const COLORS = ['#3f6ae1', '#27408f', '#c0392b', '#16825d', '#8e44ad', '#b7791f'];

@Injectable()
export class CaptchaService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** 生成图形验证码：返回 { id, svg }（svg 由前端转 data URL 展示，点击可刷新） */
  async issue(): Promise<{ id: string; svg: string }> {
    const chars = Array.from({ length: 4 }, () =>
      CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)]
    );
    const id = `cap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await this.redis.set(`captcha:${id}`, chars.join(''), 'EX', CAPTCHA_TTL_SEC);
    return { id, svg: this.render(chars) };
  }

  /**
   * 校验并销毁（一次性）：错误/过期统一报「验证码错误或已过期」，不泄露具体原因。
   * v0.9.57 防并发双花：GET+DEL 两步在并发下可被同一图形码双用（各发一封邮件），
   * 改 Lua 原子取删——无论对错都销毁，并发第二发必落空。
   */
  private static readonly GETDEL_LUA =
    'local v = redis.call("GET", KEYS[1]) if v then redis.call("DEL", KEYS[1]) end return v';

  async verify(id: string, code: string): Promise<void> {
    const key = `captcha:${id}`;
    let saved: string | null = null;
    try {
      saved = (await this.redis.eval(
        CaptchaService.GETDEL_LUA,
        1,
        key
      )) as string | null; // 无论对错都销毁：错一次必须换新图
    } catch {
      throw new ServiceUnavailableException('验证码服务暂不可用，请稍后重试');
    }
    if (!saved || saved !== (code || '').trim().toLowerCase()) {
      throw new BadRequestException('验证码错误或已过期');
    }
  }

  /** 自绘 SVG：随机基线抖动/旋转/配色 + 2 条贝塞尔干扰线 + 噪点 */
  private render(chars: string[]): string {
    const w = 104;
    const h = 36;
    const pick = () => COLORS[Math.floor(Math.random() * COLORS.length)];
    const glyphs = chars
      .map((c, i) => {
        const x = 16 + i * 24;
        const y = 25 + Math.floor(Math.random() * 6) - 3;
        const rot = Math.floor(Math.random() * 50) - 25;
        return `<text x="${x}" y="${y}" fill="${pick()}" font-size="${20 + Math.floor(Math.random() * 5)}" font-family="Georgia,serif" font-weight="bold" transform="rotate(${rot} ${x} ${y})">${c}</text>`;
      })
      .join('');
    const lines = Array.from({ length: 2 }, () => {
      const y1 = Math.floor(Math.random() * h);
      const y2 = Math.floor(Math.random() * h);
      return `<path d="M0 ${y1} C ${w / 3} ${Math.floor(Math.random() * h)}, ${(w * 2) / 3} ${Math.floor(Math.random() * h)}, ${w} ${y2}" stroke="${pick()}" stroke-opacity="0.35" stroke-width="1.2" fill="none"/>`;
    }).join('');
    const dots = Array.from({ length: 24 }, () => {
      const cx = Math.floor(Math.random() * w);
      const cy = Math.floor(Math.random() * h);
      return `<circle cx="${cx}" cy="${cy}" r="0.9" fill="${pick()}" fill-opacity="0.3"/>`;
    }).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" rx="6" fill="#f4f6fb"/>${dots}${lines}${glyphs}</svg>`;
  }
}
