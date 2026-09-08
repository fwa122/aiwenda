import { IsObject, IsOptional } from 'class-validator';

/**
 * 系统设置：四个分区均为可选对象，未传的分区保持原值。
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
}
