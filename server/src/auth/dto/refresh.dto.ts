import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** 刷新请求体：refreshToken 必填 */
export class RefreshDto {
  @IsString()
  @IsNotEmpty({ message: 'refreshToken 不能为空' })
  refreshToken: string;
}

/** 登出请求体：refreshToken 可选（缺省时仅前端清本地状态） */
export class LogoutDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
