import { describe, expect, it } from 'vitest';

import { ServiceDateService } from './service-date.service';

describe('ServiceDateService', () => {
  const service = new ServiceDateService();

  it('rolls over at midnight in Asia/Jakarta rather than UTC', () => {
    expect(service.current('Asia/Jakarta', new Date('2026-01-31T16:59:00.000Z'))).toBe(
      '2026-01-31',
    );
    expect(service.current('Asia/Jakarta', new Date('2026-01-31T17:01:00.000Z'))).toBe(
      '2026-02-01',
    );
  });

  it('uses location-local dates across a DST-observing timezone boundary', () => {
    expect(service.current('America/New_York', new Date('2026-11-01T03:59:00.000Z'))).toBe(
      '2026-10-31',
    );
    expect(service.current('America/New_York', new Date('2026-11-01T04:01:00.000Z'))).toBe(
      '2026-11-01',
    );
  });
});
