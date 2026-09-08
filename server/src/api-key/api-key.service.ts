import { createHash, randomBytes } from 'crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { genId } from '../common/id.util';
import { PrismaService } from '../prisma/prisma.service';
import { CreateApiKeyDto } from './dto/api-key.dto';

@Injectable()
export class ApiKeyService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 生成 sk-kb- 前缀密钥；只存 sha256 哈希，明文仅在创建响应中出现一次 */
  private generate() {
    const secret = randomBytes(24).toString('hex'); // 48 位十六进制
    const fullKey = `sk-kb-${secret}`;
    const keyHash = createHash('sha256').update(fullKey).digest('hex');
    const keyPreview = `sk-kb-${secret.slice(0, 4)}****${secret.slice(-4)}`;
    return { fullKey, keyHash, keyPreview };
  }

  async list(userId: string) {
    const rows = await this.prisma.apiKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        keyPreview: true,
        scope: true,
        status: true,
        quotaPerDay: true,
        usedToday: true,
        createdAt: true,
        lastUsedAt: true,
        expiredAt: true,
      },
    });
    // 契约字段名为 key（脱敏展示）
    return rows.map(({ keyPreview, ...r }) => ({ ...r, key: keyPreview }));
  }

  async create(userId: string, dto: CreateApiKeyDto) {
    const { fullKey, keyHash, keyPreview } = this.generate();
    const row = await this.prisma.apiKey.create({
      data: {
        id: genId('key'),
        userId,
        name: dto.name,
        keyHash,
        keyPreview,
        scope: (dto.scope || []) as Prisma.InputJsonValue,
        quotaPerDay: dto.quotaPerDay ?? 1000,
        ...(dto.expiredAt ? { expiredAt: new Date(dto.expiredAt) } : {}),
      },
    });
    // 创建时一次性返回明文
    return { ...row, key: fullKey };
  }

  async remove(id: string, userId: string) {
    const row = await this.prisma.apiKey.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('密钥不存在');
    await this.prisma.apiKey.delete({ where: { id } });
    return { id };
  }
}
