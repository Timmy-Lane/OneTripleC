import { db } from '../src/persistence/db.js';
import { users } from '../src/persistence/models/schema.js';

const API_BASE_URL = 'http://localhost:3000';

async function getOrCreateTestUser() {
  const existingUsers = await db.select().from(users).limit(1);
  
  if (existingUsers.length > 0) {
    console.log('📋 Using existing user:');
    console.log(`   ID: ${existingUsers[0].id}`);
    console.log(`   Username: @${existingUsers[0].telegramUsername}`);
    return existingUsers[0];
  }

  const testUser = await db.insert(users).values({
    telegramId: Math.floor(Math.random() * 1000000000),
    telegramUsername: 'testuser',
    telegramFirstName: 'Test',
    telegramLastName: 'User',
    isActive: true,
    isBlocked: false,
    preferences: {},
  }).returning();

  console.log('✅ Created new test user:');
  console.log(`   ID: ${testUser[0].id}`);
  console.log(`   Telegram ID: ${testUser[0].telegramId}`);
  return testUser[0];
}

async function testCreateIntent(userId: string, rawMessage: string) {
  console.log(`\n🚀 Testing POST /intents`);
  console.log(`   Raw message: "${rawMessage}"`);

  const response = await fetch(`${API_BASE_URL}/intents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, rawMessage }),
  });

  if (!response.ok) {
    const error = await response.json();
    console.error('❌ Failed to create intent:', error);
    return null;
  }

  const intent = await response.json();
  console.log('✅ Intent created:');
  console.log(`   ID: ${intent.id}`);
  console.log(`   State: ${intent.state}`);
  console.log(`   Created at: ${intent.createdAt}`);
  
  return intent;
}

async function testGetIntent(intentId: string) {
  console.log(`\n📊 Testing GET /intents/${intentId}`);

  const response = await fetch(`${API_BASE_URL}/intents/${intentId}`);

  if (!response.ok) {
    const error = await response.json();
    console.error('❌ Failed to get intent:', error);
    return null;
  }

  const intent = await response.json();
  console.log('✅ Intent retrieved:');
  console.log(`   ID: ${intent.id}`);
  console.log(`   State: ${intent.state}`);
  console.log(`   Raw message: "${intent.rawMessage}"`);
  
  if (intent.sourceChainId) {
    console.log(`   Source chain: ${intent.sourceChainId}`);
    console.log(`   Target chain: ${intent.targetChainId}`);
    console.log(`   Source token: ${intent.sourceToken}`);
    console.log(`   Target token: ${intent.targetToken}`);
    console.log(`   Source amount: ${intent.sourceAmount}`);
    console.log(`   Parsing confidence: ${intent.parsingConfidence}`);
  }
  
  if (intent.errorMessage) {
    console.log(`   ⚠️  Error: ${intent.errorMessage}`);
  }

  return intent;
}

async function pollIntentUntilComplete(intentId: string, maxAttempts = 20) {
  console.log(`\n⏳ Polling intent until processing completes...`);
  
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const intent = await testGetIntent(intentId);
    if (!intent) return null;

    if (intent.state === 'PARSED' || intent.state === 'FAILED') {
      console.log(`\n✅ Processing complete! Final state: ${intent.state}`);
      return intent;
    }

    console.log(`   Attempt ${i + 1}/${maxAttempts}: State is ${intent.state}, waiting...`);
  }

  console.log(`\n⚠️  Timeout: Intent still processing after ${maxAttempts} attempts`);
  return null;
}

async function main() {
  console.log('🧪 OneTripleC Intent API Test\n');
  console.log('=' .repeat(50));

  try {
    const user = await getOrCreateTestUser();

    const testMessages = [
      'swap 100 USDC to ETH',
      'bridge 50 USDC from Ethereum to Base',
      'send 1 ETH to 0x1234567890123456789012345678901234567890',
    ];

    for (const message of testMessages) {
      console.log('\n' + '='.repeat(50));
      
      const intent = await testCreateIntent(user.id, message);
      if (!intent) continue;

      await pollIntentUntilComplete(intent.id);
    }

    console.log('\n' + '='.repeat(50));
    console.log('✅ All tests completed!\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

main();
