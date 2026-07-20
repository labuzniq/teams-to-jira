// src/tableUserStore.ts
import { TableClient } from '@azure/data-tables';
import { UserStore, UserPrefs } from './userStore';

const PARTITION = 'user';
const DEFAULT_TABLE = 'userprefs';

export interface TableClientLike {
  createTable(): Promise<unknown>;
  getEntity(partitionKey: string, rowKey: string): Promise<{ prefsJson?: string }>;
  upsertEntity(
    entity: { partitionKey: string; rowKey: string; prefsJson: string },
    mode: string
  ): Promise<unknown>;
}

export class TableUserStore implements UserStore {
  private ready: Promise<unknown> | undefined;

  constructor(private client: TableClientLike) {}

  static fromConnectionString(conn: string, table = DEFAULT_TABLE): TableUserStore {
    return new TableUserStore(
      TableClient.fromConnectionString(conn, table) as unknown as TableClientLike
    );
  }

  private ensureTable(): Promise<unknown> {
    // createTable is idempotent-ish: 409 "already exists" is swallowed
    this.ready ??= this.client.createTable().catch((err: { statusCode?: number }) => {
      if (err.statusCode !== 409) throw err;
    });
    return this.ready;
  }

  async get(userId: string): Promise<UserPrefs | undefined> {
    await this.ensureTable();
    try {
      const entity = await this.client.getEntity(PARTITION, userId);
      return entity.prefsJson ? (JSON.parse(entity.prefsJson) as UserPrefs) : undefined;
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 404) return undefined;
      throw err;
    }
  }

  async save(userId: string, prefs: UserPrefs): Promise<void> {
    await this.ensureTable();
    await this.client.upsertEntity(
      { partitionKey: PARTITION, rowKey: userId, prefsJson: JSON.stringify(prefs) },
      'Replace'
    );
  }
}
