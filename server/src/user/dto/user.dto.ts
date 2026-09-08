import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MinLength,
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

  @IsNotEmpty({ message: '新密码不能为空' })
  @MinLength(6, { message: '新密码至少 6 位' })
  newPassword: string;
}

export class CreateUserDto {
  @IsNotEmpty({ message: '用户名不能为空' })
  @IsString()
  username: string;

  @IsNotEmpty({ message: '密码不能为空' })
  @MinLength(6, { message: '密码至少 6 位' })
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
