// src/tableUserStore.ts (stub — replaced in Task 9)
import { MemoryUserStore } from './userStore';

export class TableUserStore extends MemoryUserStore {
  static fromConnectionString(_conn: string): TableUserStore {
    throw new Error('TableUserStore not implemented yet (Task 9)');
  }
}
