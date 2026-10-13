import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** 用例来源：手工新建 / 内置模板导入 / 难例回归 */
export const EVAL_CASE_SOURCES = ['manual', 'template', 'hardcase'] as const;

/** 创建评测用例 */
export class CreateEvalCaseDto {
  @IsString()
  @MaxLength(512)
  question: string;

  @IsString()
  @MaxLength(128)
  docNameContains: string;

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  keywords: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsIn(EVAL_CASE_SOURCES as unknown as string[])
  source?: string;

  @IsOptional()
  @IsBoolean()
  isHard?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** 更新评测用例：所有字段可选，未传保持原值 */
export class UpdateEvalCaseDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  question?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  docNameContains?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  keywords?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsIn(EVAL_CASE_SOURCES as unknown as string[])
  source?: string;

  @IsOptional()
  @IsBoolean()
  isHard?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/** 批量导入的 单条用例（question 为去重键） */
export class ImportEvalCaseItemDto {
  @IsString()
  @MaxLength(512)
  question: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  docNameContains?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  keywords?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsIn(EVAL_CASE_SOURCES as unknown as string[])
  source?: string;

  @IsOptional()
  @IsBoolean()
  isHard?: boolean;
}

/** 批量导入：按问题去重（同库内已存在或本次重复的跳过） */
export class ImportEvalCasesDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ImportEvalCaseItemDto)
  cases: ImportEvalCaseItemDto[];
}
