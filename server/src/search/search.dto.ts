import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** 全局搜索入参：q 必填 1~64 字符；limit 可选（默认 10，上限 20） */
export class SearchQueryDto {
  @IsString()
  @MinLength(1, { message: '搜索关键词不能为空' })
  @MaxLength(64, { message: '搜索关键词不能超过 64 个字符' })
  q: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 10;
}
