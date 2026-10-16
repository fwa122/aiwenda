import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateDepartmentDto {
  @IsNotEmpty({ message: '部门名称不能为空' })
  @IsString()
  @MaxLength(64, { message: '部门名称最长 64 字' })
  name: string;

  // 为空 = 创建根部门
  @IsOptional() @IsString()
  parentId?: string;

  @IsOptional() @IsString()
  leaderId?: string;
}

export class UpdateDepartmentDto {
  @IsOptional() @IsString()
  @MaxLength(64, { message: '部门名称最长 64 字' })
  name?: string;

  @IsOptional() @IsString()
  leaderId?: string;
}

export class MoveDepartmentDto {
  // null = 移到根级；传部门 id = 移到其子级。字段缺失视为非法请求
  @IsOptional() @IsString()
  parentId?: string | null;
}

export class AddDeptMemberDto {
  @IsNotEmpty({ message: 'userId 不能为空' })
  @IsString()
  userId: string;

  // 缺省 false；用户尚无任何部门归属时服务层自动置为主部门
  @IsOptional() @IsBoolean()
  isPrimary?: boolean;
}
