import { BadRequestException, Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { getEnvironment } from '../config/environment';

const deviceTokenSchema = z.uuid();

export type DeviceActor = {
  deviceTokenHash: string;
  deviceProof: string;
  ipHash: string;
};

@Injectable()
export class DeviceTokenService {
  requireActor(request: FastifyRequest): DeviceActor {
    const rawToken = this.getHeader(request, 'x-device-token');
    const parsedToken = deviceTokenSchema.safeParse(rawToken);

    if (!parsedToken.success) {
      throw new BadRequestException({
        code: 'invalid_device_token',
        message: 'X-Device-Token must be a UUID.',
      });
    }

    const deviceProof = this.verifyOrIssueProof(request, parsedToken.data);
    return {
      deviceTokenHash: this.hash(parsedToken.data, getEnvironment().deviceTokenSecret),
      deviceProof,
      ipHash: this.hash(request.ip, getEnvironment().ipHashSalt),
    };
  }

  optionalActor(request: FastifyRequest): DeviceActor | null {
    const rawToken = this.getHeader(request, 'x-device-token');
    if (!rawToken) {
      return null;
    }

    const parsedToken = deviceTokenSchema.safeParse(rawToken);
    if (!parsedToken.success) {
      return null;
    }

    const deviceProof = this.verifyOrIssueProof(request, parsedToken.data);
    return {
      deviceTokenHash: this.hash(parsedToken.data, getEnvironment().deviceTokenSecret),
      deviceProof,
      ipHash: this.hash(request.ip, getEnvironment().ipHashSalt),
    };
  }

  attachProof(reply: FastifyReply, actor: DeviceActor | null): void {
    if (actor) {
      reply.header('x-device-proof', actor.deviceProof);
    }
  }

  getHeader(request: FastifyRequest, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }

  private hash(value: string, secret: string): string {
    return createHmac('sha256', secret).update(value).digest('hex');
  }

  private verifyOrIssueProof(request: FastifyRequest, token: string): string {
    const expectedProof = this.hash(`proof:${token}`, getEnvironment().deviceTokenSecret);
    const suppliedProof = this.getHeader(request, 'x-device-proof');
    if (!suppliedProof) {
      return expectedProof;
    }

    const supplied = Buffer.from(suppliedProof, 'utf8');
    const expected = Buffer.from(expectedProof, 'utf8');
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new BadRequestException({
        code: 'invalid_device_proof',
        message: 'X-Device-Proof is invalid for this device token.',
      });
    }

    return expectedProof;
  }
}
