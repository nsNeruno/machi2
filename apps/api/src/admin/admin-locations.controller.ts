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
  Query,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import {
  adminLocationCreateSchema,
  adminLocationUpdateSchema,
  slugSchema,
  type AdminLocationResponse,
  type SlugAvailabilityResponse,
} from '@machi2/shared';

import { CurrentAdmin, type AuthenticatedAdmin } from './admin-context';
import { AdminService } from './admin.service';
import { AdminGuard, SuperadminOnly } from './admin.guard';
import { parseBody } from './admin-validation';

@Controller('admin/locations')
@UseGuards(AdminGuard)
@SkipThrottle()
export class AdminLocationsController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  list(@CurrentAdmin() admin: AuthenticatedAdmin): Promise<AdminLocationResponse[]> {
    return this.adminService.listLocations(admin);
  }

  @Get('slug-availability')
  async slugAvailability(
    @Query('slug') slug: string | undefined,
    @Query('excludeId') excludeId: string | undefined,
  ): Promise<SlugAvailabilityResponse> {
    const parsed = slugSchema.safeParse(slug ?? '');
    if (!parsed.success) {
      return { slug: slug ?? '', available: false };
    }
    return { slug: parsed.data, available: await this.adminService.slugAvailable(parsed.data, excludeId) };
  }

  @Post()
  @SuperadminOnly()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: unknown): Promise<AdminLocationResponse> {
    const input = parseBody(adminLocationCreateSchema, body, 'invalid_location', 'Location details are invalid.');
    return this.adminService.createLocation(input);
  }

  @Patch(':id')
  update(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<AdminLocationResponse> {
    const input = parseBody(adminLocationUpdateSchema, body, 'invalid_location', 'Location details are invalid.');
    return this.adminService.updateLocation(admin, id, input);
  }

  @Delete(':id')
  @SuperadminOnly()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    await this.adminService.deleteLocation(id);
  }
}
