import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { genId } from '../common/id.util';
import { withRoleName } from '../common/role.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateUserDto,
  UpdateProfileDto,
  UpdateUserDto,
} from './dto/user.dto';

@Injectable()
export class UserService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getProfile(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('用户不存在');
    const { passwordHash, ...rest } = u;
    return withRoleName(rest);
  }

  async updateProfile(id: string, dto: UpdateProfileDto) {
    return withRoleName(await this.prisma.user.update({ where: { id }, data: { ...dto } }));
  }

  async changePassword(id: string, oldPassword: string, newPassword: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('用户不存在');
    const ok = await bcrypt.compare(oldPassword, u.passwordHash);
    if (!ok) throw new BadRequestException('原密码错误');
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });
    return null;
  }

  async list(query: {
    keyword?: string;
    role?: string;
    page?: number;
    pageSize?: number;
  }) {
    const where: Prisma.UserWhereInput = {};
    if (query.keyword) {
      where.OR = [
        { username: { contains: query.keyword } },
        { nickname: { contains: query.keyword } },
      ];
    }
    if (query.role) where.role = query.role;

    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 20;

    const [list, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      list: list.map(({ passwordHash, ...r }) => withRoleName(r)),
      total,
      page,
      pageSize,
    };
  }

  async create(dto: CreateUserDto) {
    const exist = await this.prisma.user.findUnique({
      where: { username: dto.username },
    });
    if (exist) throw new BadRequestException('用户名已存在');
    return this.prisma.user.create({
      data: {
        id: genId('user'),
        username: dto.username,
        passwordHash: await bcrypt.hash(dto.password, 10),
        nickname: dto.nickname ?? dto.username,
        email: dto.email,
        role: dto.role ?? 'viewer',
        department: dto.department,
        status: dto.status ?? 'active',
        conversationLimit: dto.conversationLimit ?? 30,
        docLimit: dto.docLimit ?? 200,
        storageLimit: dto.storageLimit ?? 1073741824,
        monthlyTokenLimit: dto.monthlyTokenLimit ?? 200000,
      },
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    return withRoleName(await this.prisma.user.update({ where: { id }, data: { ...dto } }));
  }

  async remove(id: string) {
    await this.prisma.user.delete({ where: { id } });
    return null;
  }
}
