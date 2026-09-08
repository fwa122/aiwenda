import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { ConversationService } from './conversation.service';
import {
  BatchDeleteConversationsDto,
  CreateConversationDto,
  MessageFeedbackDto,
  UpdateConversationDto,
} from './dto/conversation.dto';

@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class ConversationController {
  constructor(private readonly service: ConversationService) {}

  @Get()
  list(@CurrentUser('id') userId: string, @Query() query: any) {
    return this.service.list(userId, query);
  }

  @Post('batch-delete')
  batchRemove(@CurrentUser('id') userId: string, @Body() dto: BatchDeleteConversationsDto) {
    return this.service.batchRemove(userId, dto.ids);
  }

  @Get(':id')
  detail(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.service.detail(userId, id);
  }

  @Post()
  create(@CurrentUser('id') userId: string, @Body() dto: CreateConversationDto) {
    return this.service.create(userId, dto);
  }

  @Put(':id')
  update(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto
  ) {
    return this.service.update(userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.service.remove(userId, id);
  }
}

/** 消息反馈：/messages/:id/feedback */
@Controller('messages')
@UseGuards(JwtAuthGuard)
export class MessageController {
  constructor(private readonly service: ConversationService) {}

  @Post(':id/feedback')
  feedback(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: MessageFeedbackDto
  ) {
    return this.service.feedback(userId, id, dto.type);
  }
}
