import {
  Global,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  OnModuleInit,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import type { Readable } from 'stream';

export const MINIO_CLIENT = 'MINIO_CLIENT';

/** 默认桶名（MINIO_BUCKET 可覆盖） */
const DEFAULT_BUCKET = 'kb-documents';

/**
 * 文档对象存储门面：put / get / remove 三个原语。
 * key 与文档表 storage_key 一致（`<kbId>/<doc_xxx>.<ext>`），天然不含用户可控路径片段。
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    @Inject(MINIO_CLIENT) private readonly client: Client,
    private readonly config: ConfigService
  ) {}

  private get bucket(): string {
    return this.config.get<string>('MINIO_BUCKET') || DEFAULT_BUCKET;
  }

  /** 启动自检：连接 MinIO 并确保桶存在（连不上则拒绝启动，fail-fast） */
  async onModuleInit() {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        this.logger.log(`已创建 MinIO 桶: ${this.bucket}`);
      }
    } catch (err) {
      this.logger.error(
        'MinIO 连接失败：请检查 MINIO_ENDPOINT / MINIO_ACCESS_KEY / MINIO_SECRET_KEY 与服务可用性'
      );
      throw err;
    }
  }

  async put(key: string, buffer: Buffer, contentType: string) {
    // minio 8.x 签名：putObject(bucket, key, stream, size?, metaData?)
    await this.client.putObject(this.bucket, key, buffer, buffer.length, {
      'Content-Type': contentType,
    });
  }

  /** 取文件流；对象不存在转 404（沿用「文件已丢失，请重新上传」语义） */
  async get(key: string): Promise<Readable> {
    try {
      return await this.client.getObject(this.bucket, key);
    } catch (err: any) {
      if (err?.code === 'NoSuchKey' || err?.code === 'NoSuchBucket') {
        throw new NotFoundException('文件已丢失，请重新上传');
      }
      throw err;
    }
  }

  /** 删除对象；失败仅告警（孤儿对象可由运维清理），不阻断文档记录删除主流程 */
  async remove(key: string) {
    try {
      await this.client.removeObject(this.bucket, key);
    } catch (err: any) {
      this.logger.warn(`删除对象失败（产生孤儿对象）: ${key}: ${err?.message ?? err}`);
    }
  }
}

/**
 * MinIO（S3 兼容）对象存储客户端：上传原始文档的唯一存储后端。
 * 密钥未配置直接抛错（fail-fast，与 Redis/JWT 同风格），不带默认弱凭据。
 */
@Global()
@Module({
  providers: [
    {
      provide: MINIO_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const accessKey = config.get<string>('MINIO_ACCESS_KEY');
        const secretKey = config.get<string>('MINIO_SECRET_KEY');
        if (!accessKey || !secretKey) {
          throw new Error('MINIO_ACCESS_KEY / MINIO_SECRET_KEY 未配置，拒绝启动（fail-fast）');
        }
        // 端点形如 minio:9000 / 127.0.0.1:9000 / host.example.com（无端口默认 9000）
        const endpoint = config.get<string>('MINIO_ENDPOINT') || '127.0.0.1:9000';
        const sep = endpoint.lastIndexOf(':');
        return new Client({
          endPoint: sep > 0 ? endpoint.slice(0, sep) : endpoint,
          port: sep > 0 ? Number(endpoint.slice(sep + 1)) : 9000,
          useSSL: (config.get<string>('MINIO_SECURE') || 'false') === 'true',
          accessKey,
          secretKey,
        });
      },
    },
    StorageService,
  ],
  exports: [StorageService],
})
export class StorageModule {}
