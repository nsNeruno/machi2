import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { DbService } from '../db/db.service';

export type HealthResponse = { status: 'ok' };

@Injectable()
export class HealthService {
  constructor(private readonly dbService: DbService) {}

  async check(): Promise<HealthResponse> {
    try {
      await this.dbService.ping();
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({
        code: 'database_unavailable',
        message: 'Database is unavailable.',
      });
    }
  }
}
