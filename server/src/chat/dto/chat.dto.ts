import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/** 会话级检索参数覆盖（可选，优先于知识库默认配置） */
export class RetrieverOverrideDto {
  @IsOptional()
  @IsNumber()
  topK?: number;

  @IsOptional()
  @IsNumber()
  threshold?: number;

  @IsOptional()
  @IsBoolean()
  hybrid?: boolean;

  @IsOptional()
  @IsBoolean()
  rerank?: boolean;
}

export class ChatCompletionDto {
  /** 为空时服务端自动创建会话（标题取问题前 20 字） */
  @IsOptional()
  @IsString()
  conversationId?: string;

  @IsString()
  @MaxLength(2000)
  question: string;

  /** 限定检索范围；为空表示全库 */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  kbIds?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  model?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  stream?: boolean;

  /** 会话级检索参数覆盖（可选，优先于知识库默认配置） */
  @IsOptional()
  @IsObject()
  @Type(() => RetrieverOverrideDto)
  retriever?: RetrieverOverrideDto;

  /** 附件 ID（先经 POST /chat/attachments 提取文本后获得，仅本次回答有效） */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachmentIds?: string[];
}

/** 附件上传项：文件以 base64 随 JSON 传输（前端 FileReader 读取） */
export class AttachmentItemDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  base64Content: string;
}

export class CreateAttachmentsDto {
  @IsArray()
  @Type(() => AttachmentItemDto)
  files: AttachmentItemDto[];
}
