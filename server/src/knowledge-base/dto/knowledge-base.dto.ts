import {
  IsOptional,
  IsString,
  IsInt,
  IsNumber,
  IsBoolean,
  IsObject,
  Min,
  Max,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * 创建知识库入参。
 * 前端 createKnowledge 会传 name/description/embeddingModel/vectorStore/
 * chunkSize/chunkOverlap/parser/topK/threshold/rerank/hybrid/llm/visibility。
 * 检索与生成配置写成两张 Json 表（retrieverConfig / llmConfig）。
 */
export class CreateKbDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  embeddingModel?: string;

  @IsOptional()
  @IsString()
  vectorStore?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(64)
  @Max(4096)
  chunkSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  chunkOverlap?: number;

  @IsOptional()
  @IsString()
  parser?: string;

  // —— 检索配置（写入 retrieverConfig Json）——
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  topK?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  threshold?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  rerank?: boolean;

  @IsOptional()
  @IsString()
  rerankModel?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  hybrid?: boolean;

  // —— 生成配置（写入 llmConfig Json）——
  @IsOptional()
  @IsObject()
  llm?: Record<string, any>;

  @IsOptional()
  @IsString()
  visibility?: string;
}

/**
 * 更新知识库配置：所有字段可选，未传的保持原值。
 * 若传了 retriever/llm 对象则整体替换；若传了标量检索/生成字段则合并进对应 Json。
 */
export class UpdateKbDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  icon?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  embeddingModel?: string;

  @IsOptional()
  @IsString()
  vectorStore?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(64)
  @Max(4096)
  chunkSize?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  chunkOverlap?: number;

  @IsOptional()
  @IsString()
  parser?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  topK?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  threshold?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  rerank?: boolean;

  @IsOptional()
  @IsString()
  rerankModel?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  hybrid?: boolean;

  @IsOptional()
  @IsObject()
  llm?: Record<string, any>;

  @IsOptional()
  @IsString()
  visibility?: string;
}
