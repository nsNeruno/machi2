import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  adminGrantsSchema,
  adminPasswordSchema,
  adminUserCreateSchema,
  adminUserUpdateSchema,
  type AdminUserResponse,
} from '@machi2/shared';

import { CurrentAdmin, type AuthenticatedAdmin } from './admin-context';
import { AdminService } from './admin.service';
import { AdminGuard, SuperadminOnly } from './admin.guard';
import { parseBody } from './admin-validation';

@Controller('admin/users')
@UseGuards(AdminGuard)
@SuperadminOnly()
@SkipThrottle()
export class AdminUsersController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  list(): Promise<AdminUserResponse[]> {
    return this.adminService.listUsers();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: unknown): Promise<AdminUserResponse> {
    const input = parseBody(adminUserCreateSchema, body, 'invalid_admin_user', 'Admin user details are invalid.');
    return this.adminService.createUser(input);
  }

  @Patch(':id')
  update(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AdminUserResponse> {
    const input = parseBody(adminUserUpdateSchema, body, 'invalid_admin_user', 'Admin user details are invalid.');
    return this.adminService.updateUser(admin.user.id, id, input);
  }

  @Put(':id/grants')
  setGrants(@Param('id') id: string, @Body() body: unknown): Promise<AdminUserResponse> {
    const input = parseBody(adminGrantsSchema, body, 'invalid_grants', 'Grant list is invalid.');
    return this.adminService.setGrants(id, input.locationIds);
  }

  @Post(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setPassword(@Param('id') id: string, @Body() body: unknown): Promise<void> {
    const input = parseBody(adminPasswordSchema, body, 'invalid_password', 'Password is invalid.');
    await this.adminService.setPassword(id, input.password);
  }
}
