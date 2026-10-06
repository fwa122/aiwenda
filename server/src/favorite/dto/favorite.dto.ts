import { IsString, MaxLength } from 'class-validator';

export class CreateFavoriteDto {
  /** 被收藏的回答（assistant 消息）ID */
  @IsString()
  @MaxLength(64)
  messageId: string;
}
