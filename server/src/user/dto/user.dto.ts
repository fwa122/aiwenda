import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class UpdateProfileDto {
  @IsOptional() @IsString() nickname?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() department?: string;
}

export class ChangePasswordDto {
  @IsNotEmpty({ message: '原密码不能为空' })
  oldPassword: string;

  // 与注册口令策略（RegisterDto）保持一致，避免改密后绕过复杂度要求
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).{8,32}$/, {
    message: '新密码需 8~32 位，且同时包含字母和数字',
  })
  newPassword: string;
}

export class CreateUserDto {
  @IsNotEmpty({ message: '用户名不能为空' })
  @IsString()
  username: string;

  @IsNotEmpty({ message: '密码不能为空' })
  // 与注册口令策略（RegisterDto）保持一致：管理员建号不得低于自助注册强度
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).{8,32}$/, {
    message: '密码需 8~32 位，且同时包含字母和数字',
  })
  password: string;

  @IsOptional() @IsString() nickname?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() role?: 'admin' | 'editor' | 'viewer';
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() status?: 'active' | 'disabled';
  @IsOptional() conversationLimit?: number;
  @IsOptional() docLimit?: number;
  @IsOptional() storageLimit?: number;
  @IsOptional() monthlyTokenLimit?: number;
}

export class UpdateUserDto {
  @IsOptional() @IsString() nickname?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() role?: 'admin' | 'editor' | 'viewer';
  @IsOptional() @IsString() department?: string;
  @IsOptional() @IsString() status?: 'active' | 'disabled';
  @IsOptional() conversationLimit?: number;
  @IsOptional() docLimit?: number;
  @IsOptional() storageLimit?: number;
  @IsOptional() monthlyTokenLimit?: number;
}
