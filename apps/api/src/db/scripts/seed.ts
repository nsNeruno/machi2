import '../../config/load-env';

import argon2 from 'argon2';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { v7 as uuidv7 } from 'uuid';

import { getEnvironment } from '../../config/environment';
import { adminUsers, appMeta, games, locations } from '../schema';

async function run(): Promise<void> {
  const { databaseUrl } = getEnvironment();
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    await db
      .insert(appMeta)
      .values({ key: 'seeded_at', value: new Date().toISOString() })
      .onConflictDoUpdate({
        target: appMeta.key,
        set: { value: new Date().toISOString() },
      });

    const [location] = await db
      .insert(locations)
      .values({
        id: uuidv7(),
        slug: 'machi-local',
        name: 'Machi Arcade',
        address: 'Local development fixture',
        timezone: 'Asia/Jakarta',
      })
      .onConflictDoUpdate({
        target: locations.slug,
        set: {
          name: 'Machi Arcade',
          address: 'Local development fixture',
          timezone: 'Asia/Jakarta',
          isActive: true,
        },
      })
      .returning();

    if (!location) {
      throw new Error('Location seed did not return a row.');
    }

    const gameFixtures = [
      { name: 'Chunithm', cabinetLabel: 'Cabinet 1', sortOrder: 10, maxQueueLen: 20 },
      { name: 'maimai DX', cabinetLabel: 'Cabinet 2', sortOrder: 20, maxQueueLen: 20 },
      { name: 'Wangan Midnight', cabinetLabel: 'Cabinet 3', sortOrder: 30, maxQueueLen: 12 },
    ];
    for (const game of gameFixtures) {
      await db
        .insert(games)
        .values({ id: uuidv7(), locationId: location.id, ...game })
        .onConflictDoUpdate({
          target: [games.locationId, games.name, games.cabinetLabel],
          set: { sortOrder: game.sortOrder, maxQueueLen: game.maxQueueLen, isActive: true },
        });
    }

    const adminEmail = (process.env.ADMIN_SEED_EMAIL ?? 'admin@example.com').trim().toLowerCase();
    const adminPassword = process.env.ADMIN_SEED_PASSWORD ?? 'change-me-please';
    const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });
    await db
      .insert(adminUsers)
      .values({ id: uuidv7(), email: adminEmail, passwordHash, role: 'superadmin' })
      .onConflictDoUpdate({ target: adminUsers.email, set: { passwordHash, role: 'superadmin', isActive: true } });

    console.log('Development seed loaded: Machi Arcade, three games, and superadmin');
    console.log(`  Admin login → ${adminEmail} / ${adminPassword}`);
  } finally {
    await client.end({ timeout: 5 });
  }
}

void run();
