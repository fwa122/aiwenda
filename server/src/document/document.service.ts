import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as fs from 'fs/promises';
import * as path from 'path';
import { genId } from '../common/id.util';
import { canReadKb, canWriteKb, SessionUser } from '../common/kb-access';
import { PrismaService } from '../prisma/prisma.service';
import { AiServiceClient } from '../integrations/ai-service.client';

const UPLOAD_ROOT = path.resolve(process.cwd(), 'uploads');

/** 允许上传的文档扩展名（与 ai-service app/parser.py 支持严格对齐） */
const ALLOWED_DOC_EXTS = ['pdf', 'docx', 'txt', 'md', 'csv'];

@Injectable()
export class DocumentService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly ai: AiServiceClient
  ) {}

  /**
   * 知识库访问校验：不存在 → 404；读操作不可见 / 写操作无归属 → 403。
   * 文档作为子资源，权限完全由父知识库决定。
   */
  async assertKb(kbId: string, user: SessionUser, need: 'read' | 'write' = 'read') {
    const kb = await this.prisma.knowledgeBase.findUnique({ where: { id: kbId } });
    if (!kb) throw new NotFoundException('知识库不存在');
    const ok = need === 'write' ? canWriteKb(kb, user) : canReadKb(kb, user);
    if (!ok) throw new ForbiddenException('无权操作该知识库下的文档');
    return kb;
  }

  async list(
    kbId: string,
    query: { keyword?: string; status?: string; page?: number; pageSize?: number },
    user: SessionUser
  ) {
    await this.assertKb(kbId, user);
    const where: Prisma.DocumentWhereInput = { kbId };
    if (query.keyword) where.name = { contains: query.keyword };
    if (query.status) where.status = query.status;

    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 10;

    const [list, total] = await this.prisma.$transaction([
      this.prisma.document.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { updatedAt: 'desc' },
      }),
      this.prisma.document.count({ where }),
    ]);

    return { list, total, page, pageSize };
  }

  /**
   * 上传文档：保存文件到本地 uploads/<kbId>/，并写入 documents 记录（status=pending）。
   * 真正的解析 + 切片 + 向量化由 Python AI 服务消费队列完成；
   * 此处仅持久化元数据，便于联调与后续 worker 接入。
   */
  async upload(kbId: string, files: Express.Multer.File[], user: SessionUser) {
    await this.assertKb(kbId, user, 'write');
    if (!files || files.length === 0) {
      throw new BadRequestException('未收到文件');
    }

    const dir = path.join(UPLOAD_ROOT, kbId);
    await fs.mkdir(dir, { recursive: true });

    const created: any[] = [];
    for (const file of files) {
      const ext = (file.originalname.split('.').pop() || '').toLowerCase();
      // 白名单与 ai-service parser 支持严格对齐；格式校验兜住路径注入与怪字符
      if (!ALLOWED_DOC_EXTS.includes(ext)) {
        throw new BadRequestException(
          `不支持的文档格式 .${ext || '(无扩展名)'}，仅允许: ${ALLOWED_DOC_EXTS.join(', ')}`,
        );
      }
      const safeName = `${genId('doc')}.${ext}`;
      await fs.writeFile(path.join(dir, safeName), file.buffer);

      const doc = await this.prisma.document.create({
        data: {
          id: genId('doc'),
          kbId,
          name: file.originalname,
          type: ext,
          size: BigInt(file.size),
          storageKey: `${kbId}/${safeName}`,
          status: 'pending',
          version: 'v1.0',
          uploader: user.username,
        },
      });
      created.push(doc);
    }

    // 更新知识库文档计数
    const docCount = await this.prisma.document.count({ where: { kbId } });
    await this.prisma.knowledgeBase.update({
      where: { id: kbId },
      data: { docCount, status: 'indexing' },
    });

    // 投递解析任务（fire-and-forget；AI 服务不可达时文档停留 pending）
    created.forEach((doc) => this.ai.submitParseTask(doc.id));

    return created;
  }

  async remove(kbId: string, docId: string, user: SessionUser) {
    await this.assertKb(kbId, user, 'write');
    const doc = await this.prisma.document.findFirst({ where: { id: docId, kbId } });
    if (!doc) throw new NotFoundException('文档不存在');

    // 删除本地文件（若存在）
    if (doc.storageKey) {
      await fs
        .rm(path.join(UPLOAD_ROOT, doc.storageKey), { force: true })
        .catch(() => {});
    }

    await this.prisma.document.delete({ where: { id: docId } });
    // 返回名称供审计日志与前端展示使用

    const docCount = await this.prisma.document.count({ where: { kbId } });
    const chunkCount = await this.prisma.chunk.count({ where: { kbId } });
    const totalSize = await this.prisma.document.aggregate({
      where: { kbId },
      _sum: { size: true },
    });
    await this.prisma.knowledgeBase.update({
      where: { id: kbId },
      data: {
        docCount,
        chunkCount,
        totalSize: (totalSize._sum.size as bigint) ?? BigInt(0),
      },
    });

    return { id: docId, name: doc.name };
  }

  /**
   * 重新解析文档：真实环境由 Python 服务对源文件重新解析 / 重切 / 重建向量。
   * 这里把状态置为解析中，index 状态交给 worker。
   */
  async reparse(kbId: string, docId: string, user: SessionUser) {
    await this.assertKb(kbId, user, 'write');
    const doc = await this.prisma.document.findFirst({ where: { id: docId, kbId } });
    if (!doc) throw new NotFoundException('文档不存在');
    await this.prisma.document.update({
      where: { id: docId },
      data: { status: 'parsing', progress: 0 },
    });
    this.ai.submitParseTask(docId);
    return { id: docId };
  }

  /** 文档切片列表（不含向量列，避免巨大 payload）。权限随所属知识库 */
  async chunks(docId: string, user: SessionUser) {
    const doc = await this.prisma.document.findUnique({ where: { id: docId } });
    if (!doc) throw new NotFoundException('文档不存在');
    const kb = await this.prisma.knowledgeBase.findUnique({ where: { id: doc.kbId } });
    if (!kb || !canReadKb(kb, user)) throw new ForbiddenException('无权访问该文档');
    return this.prisma.chunk.findMany({
      where: { docId },
      orderBy: { chunkIndex: 'asc' },
      select: {
        id: true,
        docId: true,
        chunkIndex: true,
        page: true,
        charCount: true,
        content: true,
        createdAt: true,
      },
    });
  }
}
