import {
  Inject,
  Logger,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { createDatabase, type Database } from '@business-software/db';
import { describeError } from './errors.js';

/** Injection token for the app's `Database` (pool + Drizzle), connected as app_runtime. */
export const DATABASE = 'DATABASE';

@Module({})
export class DatabaseModule implements OnApplicationShutdown {
  static register(databaseUrl: string): DynamicModule {
    const logger = new Logger('Database');
    return {
      module: DatabaseModule,
      providers: [
        {
          provide: DATABASE,
          useFactory: () =>
            createDatabase(databaseUrl, (error) => {
              logger.error(`Idle database connection failed: ${describeError(error)}`);
            }),
        },
      ],
      exports: [DATABASE],
    };
  }

  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async onApplicationShutdown(): Promise<void> {
    await this.database.close();
  }
}
