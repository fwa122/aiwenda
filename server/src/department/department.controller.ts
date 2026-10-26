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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { DepartmentService } from './department.service';
import {
  AddDeptMemberDto,
  CreateDepartmentDto,
  MoveDepartmentDto,
  UpdateDepartmentDto,
} from './dto/department.dto';

@Controller('departments')
export class DepartmentController {
  constructor(private readonly departmentService: DepartmentService) {}

  /** 组织树：所有登录用户可读（后续部门选择器/数据范围展示都要用） */
  @Get('tree')
  @UseGuards(JwtAuthGuard)
  tree() {
    return this.departmentService.tree();
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'super_admin')
  create(@Body() dto: CreateDepartmentDto) {
    return this.departmentService.create(dto);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'super_admin')
  update(@Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
    return this.departmentService.update(id, dto);
  }

  @Put(':id/move')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'super_admin')
  move(@Param('id') id: string, @Body() dto: MoveDepartmentDto) {
    return this.departmentService.move(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'super_admin')
  remove(@Param('id') id: string) {
    return this.departmentService.remove(id);
  }

  @Get(':id/members')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'super_admin')
  listMembers(@Param('id') id: string, @Query() query: any) {
    return this.departmentService.listMembers(id, query);
  }

  @Post(':id/members')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'super_admin')
  addMember(@Param('id') id: string, @Body() dto: AddDeptMemberDto) {
    return this.departmentService.addMember(id, dto);
  }

  @Delete(':id/members/:userId')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('owner', 'super_admin')
  removeMember(@Param('id') id: string, @Param('userId') userId: string) {
    return this.departmentService.removeMember(id, userId);
  }
}
