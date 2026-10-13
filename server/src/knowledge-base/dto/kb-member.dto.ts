import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** 成员角色：editor 可写内容（上传/删除文档、改配置），viewer 仅可读 */
export const KB_MEMBER_ROLES = ['editor', 'viewer'] as const;

/** 邀请成员（按用户名检索） */
export class AddMemberDto {
  @IsString()
  @IsNotEmpty({ message: 'username 不能为空' })
  @MaxLength(64)
  username: string;

  @IsIn(KB_MEMBER_ROLES as unknown as string[])
  role: string;
}

/** 调整成员角色 */
export class UpdateMemberDto {
  @IsIn(KB_MEMBER_ROLES as unknown as string[])
  role: string;
}
