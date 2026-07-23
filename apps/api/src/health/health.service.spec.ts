import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import { DbService } from '../db/db.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  it('reports ok after the database responds', async () => {
    const dbService = { ping: vi.fn().mockResolvedValue(undefined) } as unknown as DbService;
    const service = new HealthService(dbService);

    await expect(service.check()).resolves.toEqual({ status: 'ok' });
  });

  it('does not report healthy when the database is unavailable', async () => {
    const dbService = {
      ping: vi.fn().mockRejectedValue(new Error('offline')),
    } as unknown as DbService;
    const service = new HealthService(dbService);

    await expect(service.check()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
