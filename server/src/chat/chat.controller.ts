import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { ChatService, QUICK_PROMPTS, SUGGESTIONS } from './chat.service';
import { ChatCompletionDto, CreateAttachmentsDto } from './dto/chat.dto';
import { SseWriter } from './sse.writer';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  /**
   * 上传附件（临时问答上下文）：base64 JSON 传输，同步提取文本，
   * 返回附件 id（随 completions 的 attachmentIds 传入，一次性消费）。
   */
  @Post('attachments')
  async uploadAttachments(@CurrentUser('id') userId: string, @Body() dto: CreateAttachmentsDto) {
    return this.chatService.createAttachments(userId, dto.files);
  }

  /**
   * SSE 问答。手写 res 流（不走响应拦截器），
   * 事件协议见 docs/开发文档.md 6.4.3
   */
  @Post('completions')
  async completions(
    @CurrentUser('id') userId: string,
    @Req() req: Request,
    @Res() res: Response,
    @Body() dto: ChatCompletionDto
  ) {
    const sse = new SseWriter(res);
    try {
      await this.chatService.streamAnswer(userId, dto, req, res, sse);
    } catch (e: any) {
      // streamAnswer 内部抛出（如会话不存在/参数错误）：按 HTTP 语义返回 JSON。
      // 注意：此处绝不能再调 sse.close()（会 end 响应导致 ERR_HTTP_HEADERS_SENT）
      if (!res.headersSent) {
        res.status(e?.status || 500).json({
          code: e?.status || 500,
          message: e?.message || '服务内部错误',
          data: null,
        });
      }
    }
  }

  /** 当前真实生效的模型（只读，设置页锁定展示用） */
  @Get('model')
  model() {
    return this.chatService.modelInfo();
  }

  @Get('suggestions')
  suggestions() {
    return SUGGESTIONS;
  }

  @Get('quick-prompts')
  quickPrompts() {
    return QUICK_PROMPTS;
  }
}
