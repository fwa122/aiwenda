import { IsIn, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * LLM API Key（前端设置页配置）：undefined=不变更；空串=清除（回落 .env）；非空=写入覆盖。
 * 接口返回一律脱敏（仅尾 4 位），明文只落库。
 */
export class ApiKeysDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  zhipu?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  qianwen?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  moonshot?: string;
}

/**
 * 系统设置：各分区均为可选对象，未传的分区保持原值。
 * 结构与前端 SettingsView 各 Tab 对应（见接口文档第八章）。
 */
export class UpdateSettingsDto {
  @IsOptional()
  @IsObject()
  model?: Record<string, any>;

  @IsOptional()
  @IsObject()
  retrieval?: Record<string, any>;

  @IsOptional()
  @IsObject()
  security?: Record<string, any>;

  @IsOptional()
  @IsObject()
  storage?: Record<string, any>;

  @IsOptional()
  @ValidateNested()
  @Type(() => ApiKeysDto)
  apiKeys?: ApiKeysDto;
}

/** key 有效性验证（保存前预检 / 现网生效值复检） */
export class VerifyKeyDto {
  @IsIn(['zhipu', 'qianwen', 'moonshot'])
  provider!: 'zhipu' | 'qianwen' | 'moonshot';

  @IsOptional()
  @IsString()
  @MaxLength(300)
  key?: string;
}
