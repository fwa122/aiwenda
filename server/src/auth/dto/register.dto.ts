import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class RegisterDto {
  /** 3~32 位，字母开头，仅字母/数字/下划线 */
  @IsString()
  @Matches(/^[A-Za-z][A-Za-z0-9_]{2,31}$/, {
    message: '用户名需 3~32 位、字母开头，仅含字母/数字/下划线',
  })
  username: string;

  /** 8~32 位，必须同时含字母和数字 */
  @IsString()
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).{8,32}$/, {
    message: '密码需 8~32 位，且同时包含字母和数字',
  })
  password: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  nickname?: string;

  @IsOptional()
  @IsEmail({}, { message: '邮箱格式不正确' })
  email?: string;
}
