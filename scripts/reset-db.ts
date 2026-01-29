import { db } from '../src/persistence/db.js';
import { sql } from 'drizzle-orm';

async function resetDatabase() {
  console.log('Resetting database...');

  try {
    // Drop all tables
    await db.execute(sql`DROP SCHEMA public CASCADE`);
    await db.execute(sql`CREATE SCHEMA public`);

    // Grant permissions (ignore errors if role doesn't exist)
    try {
      await db.execute(sql`GRANT ALL ON SCHEMA public TO public`);
    } catch (e) {
      // Ignore permission errors
    }

    console.log('✓ Database reset successfully');
    console.log('Run "bun run db:migrate" to recreate tables');
  } catch (error) {
    console.error('Error resetting database:', error);
    process.exit(1);
  }

  process.exit(0);
}

resetDatabase();
