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

/** 预览/下载的 MIME 白名单：按扩展名映射，未知类型一律拒绝 */
const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  csv: 'text/csv; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * 修复 Multer 的文件名乱码：multipart 中的 filename 是 UTF-8 字节，
 * 但 Multer 按 latin-1 解码成字符串，中文变成 "Ã¨Â°…" 形式的乱码。
 * 这里按 latin-1 还原原始字节再按 UTF-8 解码；带双向保护——
 * 纯 ASCII 名与已正确解码的名字（无 latin1 扩展区字符）原样保留，
 * 还原后出现 U+FFFD 替换符的（说明不是 latin1 乱码）同样保留原名。
 */
function fixFilenameEncoding(name: string): string {
  if (!/[\u0080-\u00FF]/.test(name)) return name;
  const restored = Buffer.from(name, 'latin1').toString('utf8');
  return restored.includes('\uFFFD') ? name : restored;
}

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

  /**
   * 原始文件预览/下载：定位记录 → 权限断言 → 推导绝对路径 → 校验可读。
   * 路径完全由服务端生成的 storageKey 推导，不接受任何用户可控路径片段；
   * resolve 后再前缀校验一次，防止存储数据被篡改时的路径穿越（纵深防御）。
   */
  async getFile(docId: string, user: SessionUser) {
    const doc = await this.prisma.document.findUnique({ where: { id: docId } });
    if (!doc) throw new NotFoundException('文档不存在');
    const kb = await this.assertKb(doc.kbId, user);

    const contentType = MIME_BY_EXT[(doc.type || '').toLowerCase()];
    if (!contentType) throw new BadRequestException('该文档类型不支持预览或下载');

    const abs = path.resolve(UPLOAD_ROOT, doc.storageKey);
    if (!abs.startsWith(UPLOAD_ROOT + path.sep)) {
      throw new BadRequestException('非法文件路径');
    }
    try {
      await fs.access(abs);
    } catch {
      throw new NotFoundException('文件已丢失，请重新上传');
    }
    return { doc, kb, abs, contentType };
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
      const originalName = fixFilenameEncoding(file.originalname);
      const ext = (originalName.split('.').pop() || '').toLowerCase();
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
          name: originalName,
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
