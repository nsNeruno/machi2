import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { getEnvironment } from '../config/environment';
import * as schema from './schema';

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly client: ReturnType<typeof postgres>;
  readonly db: ReturnType<typeof drizzle<typeof schema>>;

  constructor() {
    const { databaseUrl } = getEnvironment();
    this.client = postgres(databaseUrl, { max: 10 });
    this.db = drizzle(this.client, { schema });
  }

  async ping(): Promise<void> {
    await this.client`select 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.end({ timeout: 5 });
  }
}
