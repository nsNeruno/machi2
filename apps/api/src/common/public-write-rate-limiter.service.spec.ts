import { describe, expect, it } from 'vitest';

import { PublicWriteRateLimiterService } from './public-write-rate-limiter.service';

describe('PublicWriteRateLimiterService', () => {
  it('enforces a device limit across IP changes while tracking the composite actor key', () => {
    const limiter = new PublicWriteRateLimiterService();

    limiter.assertForActor('enqueue', { deviceTokenHash: 'device-a', ipHash: 'ip-a' }, 1, 60_000);

    expect(() =>
      limiter.assertForActor('enqueue', { deviceTokenHash: 'device-a', ipHash: 'ip-b' }, 1, 60_000),
    ).toThrow('Please wait a moment before trying again.');

    expect(() =>
      limiter.assertForActor('enqueue', { deviceTokenHash: 'device-b', ipHash: 'ip-a' }, 1, 60_000),
    ).not.toThrow();
  });
});
