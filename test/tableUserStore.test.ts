// test/tableUserStore.test.ts
import { TableUserStore } from '../src/tableUserStore';
import { UserPrefs } from '../src/userStore';

class FakeTableClient {
  entities = new Map<string, { partitionKey: string; rowKey: string; prefsJson: string }>();
  createCalls = 0;

  async createTable(): Promise<void> {
    this.createCalls++;
  }

  async getEntity(pk: string, rk: string): Promise<{ prefsJson?: string }> {
    const e = this.entities.get(`${pk}|${rk}`);
    if (!e) {
      const err = new Error('not found') as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    }
    return e;
  }

  async upsertEntity(
    e: { partitionKey: string; rowKey: string; prefsJson: string },
    _mode: string
  ): Promise<void> {
    this.entities.set(`${e.partitionKey}|${e.rowKey}`, e);
  }
}

const PREFS: UserPrefs = {
  jiraUsername: 'ann',
  recentProjectKeys: ['ABC'],
  userProjects: [],
};

describe('TableUserStore', () => {
  it('returns undefined on 404', async () => {
    const store = new TableUserStore(new FakeTableClient());
    expect(await store.get('u1')).toBeUndefined();
  });

  it('round-trips prefs as JSON under partition "user"', async () => {
    const fake = new FakeTableClient();
    const store = new TableUserStore(fake);
    await store.save('u1', PREFS);
    expect(fake.entities.has('user|u1')).toBe(true);
    expect(await store.get('u1')).toEqual(PREFS);
  });

  it('rethrows non-404 errors', async () => {
    const fake = new FakeTableClient();
    fake.getEntity = async () => {
      const err = new Error('boom') as Error & { statusCode: number };
      err.statusCode = 500;
      throw err;
    };
    const store = new TableUserStore(fake);
    await expect(store.get('u1')).rejects.toThrow('boom');
  });
});
