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

export class MessageFeedbackDto {
  /** like | dislike；null 表示取消反馈 */
  @IsOptional()
  @Transform(({ value }) => (value === 'null' ? null : value))
  @IsIn(['like', 'dislike', null])
  type: 'like' | 'dislike' | null;
}
