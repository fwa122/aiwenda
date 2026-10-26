import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CurrentUser } from '../common/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import {
  ChangePasswordDto,
  CreateUserDto,
  UpdateProfileDto,
  UpdateUserDto,
} from './dto/user.dto';

@Controller('user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('profile')
  @UseGuards(JwtAuthGuard)
  profile(@CurrentUser('id') id: string) {
    return this.userService.getProfile(id);
  }

  @Put('profile')
  @UseGuards(JwtAuthGuard)
  updateProfile(@CurrentUser('id') id: string, @Body() dto: UpdateProfileDto) {
    return this.userService.updateProfile(id, dto);
  }

  @Put('password')
  @UseGuards(JwtAuthGuard)
  changePassword(
    @CurrentUser('id') id: string,
    @Body() dto: ChangePasswordDto
  ) {
    return this.userService.changePassword(id, dto.oldPassword, dto.newPassword);
  }
}

@Controller('users')
export class UsersController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  // 用户列表：管理员及以上可见（管理员查看，编辑/删除由服务层按四级范围校验）
  @Roles('owner', 'super_admin', 'admin')
  list(@Query() query: any) {
    return this.userService.list(query);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'super_admin', 'admin')
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: { role: string }) {
    return this.userService.create(dto, actor);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'super_admin', 'admin')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: { role: string }
  ) {
    return this.userService.update(id, dto, actor);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'super_admin', 'admin')
  remove(@Param('id') id: string, @CurrentUser() actor: { role: string }) {
    return this.userService.remove(id, actor);
  }
}
