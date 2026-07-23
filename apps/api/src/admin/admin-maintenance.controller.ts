import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { maintenanceOverrideSchema, type GovernorStatus } from '@machi2/shared';

import { LoadGovernorService } from '../common/load-governor.service';
import { AdminGuard, SuperadminOnly } from './admin.guard';
import { parseBody } from './admin-validation';

@Controller('admin/maintenance')
@UseGuards(AdminGuard)
@SuperadminOnly()
@SkipThrottle()
export class AdminMaintenanceController {
  constructor(private readonly governor: LoadGovernorService) {}

  @Get()
  status(): GovernorStatus {
    return this.governor.getStatus();
  }

  @Post()
  async override(@Body() body: unknown): Promise<GovernorStatus> {
    const input = parseBody(maintenanceOverrideSchema, body, 'invalid_maintenance', 'Maintenance override is invalid.');
    return this.governor.setOverride(input.level, input.reason ?? null);
  }
}
