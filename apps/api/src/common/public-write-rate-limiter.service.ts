import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

type RateLimitActor = {
  deviceTokenHash: string;
  ipHash: string;
};

@Injectable()
export class PublicWriteRateLimiterService {
  private readonly attempts = new Map<string, number[]>();

  assertWithinWindow(scope: string, key: string, limit: number, windowMs: number): void {
    const now = Date.now();
    const compositeKey = `${scope}:${key}`;
    const current = (this.attempts.get(compositeKey) ?? []).filter(
      (attempt) => attempt > now - windowMs,
    );

    if (current.length >= limit) {
      this.attempts.set(compositeKey, current);
      throw new HttpException(
        { code: 'rate_limited', message: 'Please wait a moment before trying again.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    current.push(now);
    this.attempts.set(compositeKey, current);
  }

  assertForActor(scope: string, actor: RateLimitActor, limit: number, windowMs: number): void {
    this.assertWithinWindow(`${scope}:device`, actor.deviceTokenHash, limit, windowMs);
    this.assertWithinWindow(
      `${scope}:ip-device`,
      `${actor.ipHash}:${actor.deviceTokenHash}`,
      limit,
      windowMs,
    );
  }
}
