import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { adminLoginSchema, type AdminMeResponse } from '@machi2/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AdminAuthService } from './admin-auth.service';
import { CurrentAdmin, type AuthenticatedAdmin } from './admin-context';
import { AdminSessionService } from './admin-session.service';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import { parseBody } from './admin-validation';

@Controller('admin')
export class AdminSessionController {
  constructor(
    private readonly authService: AdminAuthService,
    private readonly sessionService: AdminSessionService,
    private readonly adminService: AdminService,
  ) {}

  @Post('session')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @SkipThrottle({ read: true, enqueue: true, complete: true })
  async login(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AdminMeResponse> {
    const input = parseBody(adminLoginSchema, body, 'invalid_login', 'Enter an email and password.');
    const user = await this.authService.verifyLogin(input.email, input.password, request.ip);
    const csrfToken = await this.sessionService.issue(reply, user.id);
    const grantedLocationIds = await this.adminService.grantedLocationIds(user.id);
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      grantedLocationIds,
      csrfToken,
    };
  }

  @Delete('session')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(AdminGuard)
  @SkipThrottle()
  async logout(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    await this.sessionService.revoke(reply, request);
  }

  @Get('me')
  @UseGuards(AdminGuard)
  @SkipThrottle()
  async me(@CurrentAdmin() admin: AuthenticatedAdmin): Promise<AdminMeResponse> {
    const grantedLocationIds = await this.adminService.grantedLocationIds(admin.user.id);
    return {
      id: admin.user.id,
      email: admin.user.email,
      role: admin.user.role,
      grantedLocationIds,
      csrfToken: admin.csrfToken,
    };
  }
}
