import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  title?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  kbIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  model?: string;
}

export class UpdateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  title?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  pinned?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  kbIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  model?: string;
}

export class BatchDeleteConversationsDto {
  @IsArray()
  @IsString({ each: true })
  ids: string[];
}

/** 点踩原因预定义标签 */
const FEEDBACK_REASONS = ['offtopic', 'citation', 'outdated', 'other'] as const;

export class MessageFeedbackDto {
  /** like | dislike；null 表示取消反馈 */
  @IsOptional()
  @Transform(({ value }) => (value === 'null' ? null : value))
  @IsIn(['like', 'dislike', null])
  type: 'like' | 'dislike' | null;

  /** 点踩原因标签（仅 dislike 时写入；like/null 时清空） */
  @IsOptional()
  @IsIn(FEEDBACK_REASONS)
  reason?: 'offtopic' | 'citation' | 'outdated' | 'other';

  /** 自由备注 */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}
