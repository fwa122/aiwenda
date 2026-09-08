import {
  Controller,
  Delete,
  Get,
  Ip,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
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

/** 单文档切片：/documents/:docId/chunks */
@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentController {
  constructor(private readonly service: DocumentService) {}

  @Get(':docId/chunks')
  chunks(@Param('docId') docId: string, @CurrentUser() user: any) {
    return this.service.chunks(docId, user);
  }
}
