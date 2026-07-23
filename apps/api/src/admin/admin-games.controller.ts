import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  adminCommunityNoteSchema,
  adminGameCreateSchema,
  adminGameReorderSchema,
  adminGameUpdateSchema,
  type AdminGameResponse,
} from '@machi2/shared';

import { CurrentAdmin, type AuthenticatedAdmin } from './admin-context';
import { AdminService } from './admin.service';
import { AdminGuard } from './admin.guard';
import { parseBody } from './admin-validation';

@Controller('admin')
@UseGuards(AdminGuard)
@SkipThrottle()
export class AdminGamesController {
  constructor(private readonly adminService: AdminService) {}

  @Get('locations/:locationId/games')
  list(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('locationId') locationId: string,
  ): Promise<AdminGameResponse[]> {
    return this.adminService.listGames(admin, locationId);
  }

  @Post('locations/:locationId/games')
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('locationId') locationId: string,
    @Body() body: unknown,
  ): Promise<AdminGameResponse> {
    const input = parseBody(adminGameCreateSchema, body, 'invalid_game', 'Game details are invalid.');
    return this.adminService.createGame(admin, locationId, input);
  }

  @Put('locations/:locationId/games/order')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reorder(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('locationId') locationId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const input = parseBody(adminGameReorderSchema, body, 'invalid_reorder', 'Reorder payload is invalid.');
    await this.adminService.reorderGames(admin, locationId, input.order);
  }

  @Patch('games/:id')
  update(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AdminGameResponse> {
    const input = parseBody(adminGameUpdateSchema, body, 'invalid_game', 'Game details are invalid.');
    return this.adminService.updateGame(admin, id, input);
  }

  @Delete('games/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
  ): Promise<void> {
    await this.adminService.deleteGame(admin, id);
  }

  @Put('games/:id/community-note')
  setCommunityNote(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AdminGameResponse> {
    const input = parseBody(adminCommunityNoteSchema, body, 'invalid_note', 'Community note is invalid.');
    return this.adminService.setCommunityNote(admin, id, input);
  }
}
