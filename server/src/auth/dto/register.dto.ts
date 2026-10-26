import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

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

  /** 邮箱必填唯一（v0.9.47）：忘记密码按邮箱发码重置的前提 */
  @IsEmail({}, { message: '邮箱格式不正确' })
  @MaxLength(128)
  email: string;

  /** 注册场景邮箱验证码（6 位，先在 /auth/email-code 获取） */
  @IsString()
  @Matches(/^\d{6}$/, { message: '邮箱验证码为 6 位数字' })
  emailCode: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  nickname?: string;
}

export class SendEmailCodeDto {
  /** 验证码使用场景：register 注册 / reset 找回密码 */
  @IsIn(['register', 'reset'])
  scene: 'register' | 'reset';

  @IsEmail({}, { message: '邮箱格式不正确' })
  @MaxLength(128)
  email: string;

  /** 图形验证码 id（GET /auth/captcha 获取） */
  @IsString()
  captchaId: string;

  /** 图形验证码答案（4 位，不区分大小写） */
  @IsString()
  captchaCode: string;
}

export class ResetPasswordDto {
  /** 账号绑定邮箱（发码地址） */
  @IsEmail({}, { message: '邮箱格式不正确' })
  @MaxLength(128)
  email: string;

  /** 邮箱验证码（reset 场景 6 位） */
  @IsString()
  @Matches(/^\d{6}$/, { message: '邮箱验证码为 6 位数字' })
  code: string;

  /** 新密码：与注册同强度（8~32 位，字母+数字） */
  @IsString()
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).{8,32}$/, {
    message: '密码需 8~32 位，且同时包含字母和数字',
  })
  newPassword: string;
}
