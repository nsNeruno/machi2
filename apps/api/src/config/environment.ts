import './load-env';

import { z } from 'zod';

const environmentSchema = z.object({
  DATABASE_URL: z.url(),
  DEVICE_TOKEN_SECRET: z.string().min(1),
  IP_HASH_SALT: z.string().min(1),
  SESSION_SECRET: z.string().min(1),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().max(720).default(12),
  SESSION_COOKIE_SECURE: z.enum(['0', '1']).default('0'),
  ADMIN_SEED_EMAIL: z.string().trim().toLowerCase().min(1).optional(),
  ADMIN_SEED_PASSWORD: z.string().min(1).optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  REJOIN_COOLDOWN_SECONDS: z.coerce.number().int().min(0).default(30),
  // Enqueue rate-limit tiers. Defaults match CLAUDE.md §6 (the production posture):
  // 3 enqueues / 60s per IP at the transport layer, 1 / 5s per device token in the
  // domain service. Override in a local .env to stop the limits fighting iterative
  // testing on localhost (where every request shares one IP).
  ENQUEUE_IP_LIMIT: z.coerce.number().int().positive().default(3),
  ENQUEUE_IP_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  ENQUEUE_DEVICE_LIMIT: z.coerce.number().int().positive().default(1),
  ENQUEUE_DEVICE_TTL_SECONDS: z.coerce.number().int().positive().default(5),
  // Read/SSE transport tier, per IP. Board GETs and each SSE (re)connect count against
  // it. Loosen in a local .env when testing across devices on one Wi-Fi: they all reach
  // the API through the Vite dev proxy from loopback, so every device shares one IP
  // bucket and a couple of reloads drains the default budget.
  READ_IP_LIMIT: z.coerce.number().int().positive().default(60),
  READ_IP_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  // Concurrent SSE streams allowed per IP. Same dev caveat as READ_IP_LIMIT: every
  // device shares one IP through the Vite proxy, so raise it locally to test live
  // updates across your phone and laptop at once.
  MAX_STREAMS_PER_IP: z.coerce.number().int().positive().default(3),
  TRUST_PROXY: z.enum(['0', '1']).default('0'),
});

export type Environment = {
  databaseUrl: string;
  deviceTokenSecret: string;
  ipHashSalt: string;
  sessionSecret: string;
  sessionTtlHours: number;
  sessionCookieSecure: boolean;
  adminSeedEmail?: string;
  adminSeedPassword?: string;
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  rejoinCooldownSeconds: number;
  enqueueIpLimit: number;
  enqueueIpTtlMs: number;
  enqueueDeviceLimit: number;
  enqueueDeviceTtlMs: number;
  readIpLimit: number;
  readIpTtlMs: number;
  maxStreamsPerIp: number;
  trustProxy: boolean;
};

export function getEnvironment(): Environment {
  const parsed = environmentSchema.parse(process.env);

  return {
    databaseUrl: parsed.DATABASE_URL,
    deviceTokenSecret: parsed.DEVICE_TOKEN_SECRET,
    ipHashSalt: parsed.IP_HASH_SALT,
    sessionSecret: parsed.SESSION_SECRET,
    sessionTtlHours: parsed.SESSION_TTL_HOURS,
    sessionCookieSecure: parsed.SESSION_COOKIE_SECURE === '1',
    adminSeedEmail: parsed.ADMIN_SEED_EMAIL,
    adminSeedPassword: parsed.ADMIN_SEED_PASSWORD,
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    rejoinCooldownSeconds: parsed.REJOIN_COOLDOWN_SECONDS,
    enqueueIpLimit: parsed.ENQUEUE_IP_LIMIT,
    enqueueIpTtlMs: parsed.ENQUEUE_IP_TTL_SECONDS * 1_000,
    enqueueDeviceLimit: parsed.ENQUEUE_DEVICE_LIMIT,
    enqueueDeviceTtlMs: parsed.ENQUEUE_DEVICE_TTL_SECONDS * 1_000,
    readIpLimit: parsed.READ_IP_LIMIT,
    readIpTtlMs: parsed.READ_IP_TTL_SECONDS * 1_000,
    maxStreamsPerIp: parsed.MAX_STREAMS_PER_IP,
    trustProxy: parsed.TRUST_PROXY === '1',
  };
}
