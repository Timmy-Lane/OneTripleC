import { db } from '../src/persistence/db.js';
import { users } from '../src/persistence/models/schema.js';

async function createTestUser() {
  try {
    const testUser = await db.insert(users).values({
      telegramId: Math.floor(Math.random() * 1000000000),
      telegramUsername: 'testuser',
      telegramFirstName: 'Test',
      telegramLastName: 'User',
      isActive: true,
      isBlocked: false,
      preferences: {},
    }).returning();

    console.log('✅ Test user created:');
    console.log(`   ID: ${testUser[0].id}`);
    console.log(`   Telegram ID: ${testUser[0].telegramId}`);
    console.log(`   Username: @${testUser[0].telegramUsername}`);
    
    return testUser[0];
  } catch (error) {
    console.error('❌ Failed to create test user:', error);
    throw error;
  } finally {
    process.exit(0);
  }
}

createTestUser();
