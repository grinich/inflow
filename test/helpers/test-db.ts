import Dexie from 'dexie';
import { applySchema } from '@/db/database';

let counter = 0;

export function createTestDatabase() {
  const name = `TestDB_${Date.now()}_${counter++}`;
  const database = new Dexie(name);
  applySchema(database);
  return database;
}
