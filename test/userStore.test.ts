// test/userStore.test.ts
import { MemoryUserStore, touchRecentProject, UserPrefs } from '../src/userStore';

const prefs = (recent: string[]): UserPrefs => ({
  jiraUsername: 'jsmith',
  recentProjectKeys: recent,
  userProjects: [],
});

describe('MemoryUserStore', () => {
  it('returns undefined for unknown user, round-trips saved prefs', async () => {
    const store = new MemoryUserStore();
    expect(await store.get('u1')).toBeUndefined();
    await store.save('u1', prefs(['ABC']));
    expect((await store.get('u1'))!.recentProjectKeys).toEqual(['ABC']);
  });
});

describe('touchRecentProject', () => {
  it('front-inserts a new key', () => {
    expect(touchRecentProject(prefs(['ABC']), 'XYZ').recentProjectKeys).toEqual(['XYZ', 'ABC']);
  });

  it('moves an existing key to front without duplicating', () => {
    expect(touchRecentProject(prefs(['ABC', 'XYZ']), 'XYZ').recentProjectKeys).toEqual(['XYZ', 'ABC']);
  });

  it('caps the list at 10', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `P${i}`);
    const out = touchRecentProject(prefs(ten), 'NEW').recentProjectKeys;
    expect(out).toHaveLength(10);
    expect(out[0]).toBe('NEW');
    expect(out).not.toContain('P9');
  });

  it('does not mutate the input', () => {
    const p = prefs(['ABC']);
    touchRecentProject(p, 'XYZ');
    expect(p.recentProjectKeys).toEqual(['ABC']);
  });
});
