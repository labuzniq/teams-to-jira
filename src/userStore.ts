// src/userStore.ts
import { RegistryProject } from './projectRegistry';

export interface UserPrefs {
  jiraUsername: string;
  baseUrlOverride?: string;
  recentProjectKeys: string[];
  userProjects: RegistryProject[];
}

export interface UserStore {
  get(userId: string): Promise<UserPrefs | undefined>;
  save(userId: string, prefs: UserPrefs): Promise<void>;
}

export class MemoryUserStore implements UserStore {
  private data = new Map<string, UserPrefs>();

  async get(userId: string): Promise<UserPrefs | undefined> {
    return this.data.get(userId);
  }

  async save(userId: string, prefs: UserPrefs): Promise<void> {
    this.data.set(userId, prefs);
  }
}

const MAX_RECENT = 10;

export function touchRecentProject(prefs: UserPrefs, key: string): UserPrefs {
  const rest = prefs.recentProjectKeys.filter((k) => k !== key);
  return { ...prefs, recentProjectKeys: [key, ...rest].slice(0, MAX_RECENT) };
}
