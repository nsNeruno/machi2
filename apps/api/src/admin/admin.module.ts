import { Module } from '@nestjs/common';

import { QueueEventsModule } from '../queue/queue-events.module';
import { AdminAuthService } from './admin-auth.service';
import { AdminBootstrapService } from './admin-bootstrap.service';
import { AdminGamesController } from './admin-games.controller';
import { AdminGuard } from './admin.guard';
import { AdminLocationsController } from './admin-locations.controller';
import { AdminMaintenanceController } from './admin-maintenance.controller';
import { AdminQueueController } from './admin-queue.controller';
import { AdminSessionController } from './admin-session.controller';
import { AdminSessionService } from './admin-session.service';
import { AdminService } from './admin.service';
import { AdminUsersController } from './admin-users.controller';

@Module({
  imports: [QueueEventsModule],
  controllers: [
    AdminSessionController,
    AdminLocationsController,
    AdminGamesController,
    AdminQueueController,
    AdminUsersController,
    AdminMaintenanceController,
  ],
  providers: [AdminAuthService, AdminBootstrapService, AdminSessionService, AdminService, AdminGuard],
})
export class AdminModule {}
