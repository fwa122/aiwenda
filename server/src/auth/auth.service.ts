import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { withRoleName } from '../common/role.util';
import { genId } from '../common/id.util';
import { OperationLogService } from '../log/operation-log.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly log: OperationLogService
  ) {}

  /**
   * 自助注册：服务端强制 viewer 角色（请求体不接受任何角色字段，防越权）；
   * 受 system_settings.security.enableRegister 开关控制（默认开放）。
   */
  async register(dto: RegisterDto, ip?: string) {
    const setting = await this.prisma.systemSetting.findUnique({ where: { id: 1 } });
    const security: any = setting?.security || {};
    if (security.enableRegister === false) {
      throw new ForbiddenException('当前已关闭自助注册，请联系管理员开通账号');
    }

    const exist = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (exist) throw new ConflictException('用户名已存在');

    const user = await this.prisma.user.create({
      data: {
        id: genId('user'),
        username: dto.username,
        passwordHash: await bcrypt.hash(dto.password, 10),
        nickname: dto.nickname || dto.username,
        email: dto.email,
        role: 'viewer',
        status: 'active',
      },
    });

    this.log.record({
      action: '注册账号',
      target: dto.username,
      userName: dto.username,
      ip,
      result: '成功',
    });

    return { id: user.id, username: user.username };
  }

  async validateUser(username: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (!user || user.status !== 'active') return null;
    const ok = await bcrypt.compare(password, user.passwordHash);
    return ok ? user : null;
  }

  async login(dto: LoginDto) {
    const user = await this.validateUser(dto.username, dto.password);
    if (!user) {
      throw new UnauthorizedException('用户名或密码不正确');
    }
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
    };
    const token = await this.jwt.signAsync(payload);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    return { token, user: this.toProfile(user) };
  }

  /** 去掉密码字段，返回安全的用户对象（含 roleName） */
  toProfile(user: Prisma.UserGetPayload<{}>) {
    const { passwordHash, ...rest } = user;
    return withRoleName(rest);
  }
}
