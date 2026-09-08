import { IsArray, IsInt, IsISO8601, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateApiKeyDto {
  @IsString()
  @MaxLength(64)
  name: string;

  /** 授权知识库 ID 列表；空数组表示不限 */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scope?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quotaPerDay?: number;

  /** 过期时间（ISO 8601）；不传表示永不过期 */
  @IsOptional()
  @IsISO8601()
  expiredAt?: string;
}
