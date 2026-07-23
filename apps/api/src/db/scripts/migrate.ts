import '../../config/load-env';

import { resolve } from 'node:path';

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

import { getEnvironment } from '../../config/environment';

async function run(): Promise<void> {
  const { databaseUrl } = getEnvironment();
  const client = postgres(databaseUrl, { max: 1 });
  const db = drizzle(client);

  try {
    await migrate(db, { migrationsFolder: resolve(process.cwd(), 'src/db/migrations') });
    console.log('Migrations applied.');
  } finally {
    await client.end({ timeout: 5 });
  }
}

void run();
