import {
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { createReadStream } from 'fs';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { OperationLogService } from '../log/operation-log.service';
import { DocumentService } from './document.service';

/** 知识库下的文档集合：列表 / 上传 / 删除 / 重新解析 */
@Controller('knowledge/:kbId/documents')
@UseGuards(JwtAuthGuard)
export class DocumentCollectionController {
  constructor(
    private readonly service: DocumentService,
    private readonly log: OperationLogService
  ) {}

  @Get()
  list(@Param('kbId') kbId: string, @Query() query: any, @CurrentUser() user: any) {
    return this.service.list(kbId, query, user);
  }

  @Post()
  // 单文件上限 20MB（Multer 超限自动映射为 413）
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: 20 * 1024 * 1024 } }))
  async upload(
    @Param('kbId') kbId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @CurrentUser() user: any,
    @Ip() ip: string
  ) {
    const docs = await this.service.upload(kbId, files, user);
    this.log.record({
      userId: user?.id,
      userName: user?.username,
      action: '上传文档',
      target: docs.map((d: any) => d.name).join('、'),
      ip,
    });
    return docs;
  }

  @Delete(':docId')
  async remove(
    @Param('kbId') kbId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: any,
    @Ip() ip: string
  ) {
    const result = await this.service.remove(kbId, docId, user);
    this.log.record({
      userId: user?.id,
      userName: user?.username,
      action: '删除文档',
      target: (result as any)?.name || docId,
      ip,
    });
    return result;
  }

  @Post(':docId/reparse')
  reparse(@Param('kbId') kbId: string, @Param('docId') docId: string, @CurrentUser() user: any) {
    return this.service.reparse(kbId, docId, user);
  }
}

/** 单文档切片 / 原始文件：/documents/:docId/chunks | /documents/:docId/file */
@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentController {
  constructor(
    private readonly service: DocumentService,
    private readonly log: OperationLogService
  ) {}

  @Get(':docId/chunks')
  chunks(@Param('docId') docId: string, @CurrentUser() user: any) {
    return this.service.chunks(docId, user);
  }

  /**
   * 原始文件预览（mode=inline）/下载（mode=attachment）。
   * 前端通过 fetch→Blob 携带 JWT，文件 URL 永不裸露；
   * 下载一律写审计日志，private 库的在线预览同样记录。
   */
  @Get(':docId/file')
  async file(
    @Param('docId') docId: string,
    @Query('mode') mode: string,
    @CurrentUser() user: any,
    @Ip() ip: string,
    @Res({ passthrough: true }) res: Response
  ): Promise<StreamableFile> {
    const { doc, kb, abs, contentType } = await this.service.getFile(docId, user);
    const disposition = mode === 'attachment' ? 'attachment' : 'inline';
    // RFC 5987 编码：兼容中文文件名，且杜绝 header 注入（换行/引号已被编码吞掉）
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename*=UTF-8''${encodeURIComponent(doc.name)}`
    );
    res.setHeader('Content-Type', contentType);
    if (disposition === 'attachment' || kb.visibility === 'private') {
      this.log.record({
        userId: user?.id,
        userName: user?.username,
        action: disposition === 'attachment' ? '下载文档' : '预览文档',
        target: doc.name,
        ip,
      });
    }
    return new StreamableFile(createReadStream(abs));
  }
}
