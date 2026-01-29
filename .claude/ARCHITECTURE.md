# OneTripleC Architecture: Custodial Wallet Backend

## Executive Summary

OneTripleC is a **custodial wallet and execution backend** that provides users with automatic EOA wallet creation and cross-chain transaction execution. The system is **channel-agnostic**: users can interact via Telegram, Web UI, WebApp, or future interfaces, all controlling the same wallet.

## Core Principles

### 1. Custodial Model
- Backend generates and stores private keys
- Users receive wallet address immediately upon signup
- No wallet connection flow required (no MetaMask, no WalletConnect)
- UX simplicity prioritized over self-custody

### 2. Channel-Agnostic Design
- User identity is independent of any interface
- Telegram, Web, WebApp are **clients**, not the architecture
- Same wallet accessible from any entry point
- New interfaces added without refactoring core logic

### 3. Separation of Concerns
```
User Identity (who you are)
    ↓
Wallet Ownership (your EOA)
    ↓
Execution Logic (what you do with it)
```

Each layer is independent and testable.

---

## Architecture Layers

### Layer 1: User Identity (Channel-Agnostic)

#### Problem with Current Design
```typescript
// CURRENT: Telegram-centric
users:
  - id
  - telegram_id (unique)  ← Locked to Telegram
  - telegram_username
  - telegram_first_name
```

This prevents:
- Web login with email/password
- OAuth (Google, Apple)
- Multiple auth methods per user

#### New Design: Multi-Provider Identity

```typescript
// Primary user entity (channel-agnostic)
users:
  - id (UUID)
  - created_at
  - updated_at

// Credentials table (1:many with users)
user_credentials:
  - id (UUID)
  - user_id (FK → users.id)
  - provider (enum: 'telegram' | 'email' | 'google' | 'apple')
  - provider_user_id (text: telegram_id, email, oauth_sub, etc.)
  - metadata (jsonb: username, first_name, email, etc.)
  - created_at
  - UNIQUE(provider, provider_user_id)
```

#### Benefits
- One user can have multiple login methods
  - Example: Login via Telegram on mobile, email on desktop
- Same wallet accessible from any interface
- Adding new providers = inserting new credential types (no schema changes)

#### Example Flow
```typescript
// Telegram bot signup
const user = await authService.getOrCreateUser({
  provider: 'telegram',
  providerId: ctx.from.id.toString(),
  metadata: {
    username: ctx.from.username,
    first_name: ctx.from.first_name
  }
});

// Web signup (future)
const user = await authService.getOrCreateUser({
  provider: 'email',
  providerId: 'user@example.com',
  metadata: {
    email: 'user@example.com',
    verified: true
  }
});

// Both return same user.id → same wallet
```

---

### Layer 2: Wallet Management (EOA Generation & Key Custody)

#### Wallet Lifecycle

```typescript
wallets:
  - id (UUID)
  - user_id (FK → users.id, UNIQUE)  ← One wallet per user
  - address (text, UNIQUE)           ← Ethereum address (0x...)
  - encrypted_private_key (text)     ← AES-256-GCM encrypted
  - encryption_key_id (text)         ← Reference to master key
  - created_at
```

#### Wallet Creation Flow

1. **User signs up** (any interface: Telegram, Web, etc.)
2. **AuthService creates user** in `users` table
3. **WalletService automatically generates keypair**
   ```typescript
   import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

   const privateKey = generatePrivateKey();
   const account = privateKeyToAccount(privateKey);
   const address = account.address;
   ```
4. **Private key encrypted** with backend master key
5. **Wallet record saved** with `user_id`, `address`, `encrypted_private_key`
6. **Address returned to user** immediately (can fund from CEX, bridge, etc.)

#### Key Encryption Strategy

```typescript
// src/domain/wallet/key-encryption.ts

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const MASTER_KEY = process.env.WALLET_ENCRYPTION_KEY; // 32 bytes

export function encryptPrivateKey(privateKey: string): {
  encryptedData: string;
  iv: string;
  authTag: string;
} {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, MASTER_KEY, iv);

  let encrypted = cipher.update(privateKey, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return {
    encryptedData: encrypted,
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex')
  };
}

export function decryptPrivateKey(
  encryptedData: string,
  iv: string,
  authTag: string
): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    MASTER_KEY,
    Buffer.from(iv, 'hex')
  );

  decipher.setAuthTag(Buffer.from(authTag, 'hex'));

  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}
```

#### Storage Format

```typescript
// Database column: encrypted_private_key
{
  "encryptedData": "a3f2c8b1...",
  "iv": "9d8e7f6a...",
  "authTag": "1a2b3c4d..."
}
```

---

### Layer 3: Execution Service (Transaction Signing)

#### Current Problem
```typescript
// src/domain/intents/intent-service.ts:376
userAddress: '0x0000000000000000000000000000000000000000',  // Placeholder!
```

No actual transaction signing happens.

#### New Design

```typescript
// src/domain/execution/execution-service.ts

export class ExecutionService {
  async executeIntent(executionId: string): Promise<void> {
    const execution = await getExecutionById(executionId);
    const quote = await getQuoteById(execution.quoteId);
    const intent = await getIntentById(execution.intentId);

    // 1. Get user's wallet
    const wallet = await walletService.getWalletByUserId(intent.userId);

    // 2. Decrypt private key (in-memory only, never logged)
    const privateKey = await walletService.getPrivateKey(wallet.id);

    // 3. Create signer
    const account = privateKeyToAccount(privateKey);
    const client = createWalletClient({
      account,
      chain: mainnet,
      transport: http()
    });

    // 4. Build transactions from quote
    const txs = await this.buildTransactions(quote, wallet.address);

    // 5. Sign and submit
    for (const tx of txs) {
      const hash = await client.sendTransaction(tx);
      await updateExecution(executionId, { txHash: hash });
    }
  }
}
```

---

## Interface Abstraction

### Current Problem
- Telegram bot directly creates intents with hardcoded user lookup
- Adding Web UI would require duplicating auth logic

### New Design: AuthService as Gateway

```typescript
// src/domain/auth/auth-service.ts

export interface CredentialProvider {
  provider: 'telegram' | 'email' | 'google' | 'apple';
  providerId: string;
  metadata?: Record<string, any>;
}

export class AuthService {
  /**
   * Get user by credential, or create if not exists.
   * This is the single entry point for all interfaces.
   */
  async getOrCreateUser(credential: CredentialProvider): Promise<User> {
    // 1. Check if credential exists
    const existingCred = await findCredential(
      credential.provider,
      credential.providerId
    );

    if (existingCred) {
      return await getUserById(existingCred.userId);
    }

    // 2. Create new user
    const user = await createUser();

    // 3. Create credential
    await createCredential({
      userId: user.id,
      provider: credential.provider,
      providerId: credential.providerId,
      metadata: credential.metadata
    });

    // 4. Generate wallet
    const wallet = await walletService.createWalletForUser(user.id);

    return user;
  }
}
```

### Interface Integration Examples

#### Telegram Bot
```typescript
// src/interfaces/telegram/auth.ts

export async function authenticateTelegramUser(ctx: Context): Promise<User> {
  return authService.getOrCreateUser({
    provider: 'telegram',
    providerId: ctx.from.id.toString(),
    metadata: {
      username: ctx.from.username,
      first_name: ctx.from.first_name
    }
  });
}
```

#### Web API (Future)
```typescript
// src/interfaces/web/auth-routes.ts

app.post('/auth/email/register', async (req, reply) => {
  const { email, password } = req.body;

  // Hash password, verify email, etc.
  const user = await authService.getOrCreateUser({
    provider: 'email',
    providerId: email,
    metadata: { email, verified: false }
  });

  // Generate JWT
  const token = jwt.sign({ userId: user.id }, SECRET);

  return { token, walletAddress: user.wallet.address };
});
```

#### Telegram WebApp (Future)
```typescript
// src/interfaces/webapp/auth.ts

app.post('/auth/telegram-webapp', async (req, reply) => {
  const { initData } = req.body;

  // Validate Telegram WebApp signature
  const telegramUser = validateTelegramWebAppData(initData);

  const user = await authService.getOrCreateUser({
    provider: 'telegram',
    providerId: telegramUser.id.toString(),
    metadata: telegramUser
  });

  return { user, walletAddress: user.wallet.address };
});
```

---

## Security Model

### Threat Model

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Backend compromise | All private keys exposed | Encrypt at rest, rate limiting, audit logs |
| Database breach | Encrypted keys stolen | Master key stored separately (KMS), strong encryption |
| Insider threat | Developer access to keys | Access controls, audit logging, principle of least privilege |
| Phishing | User tricked into malicious tx | Transaction approval UI, spending limits |
| Regulatory | Custodial = MSB/FinCEN | Compliance framework, KYC (future), tx monitoring |

### Security Layers

#### 1. Encryption at Rest
```env
# .env (local)
WALLET_ENCRYPTION_KEY=a3f8c2b1d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1

# Production: Use KMS
AWS_KMS_KEY_ID=arn:aws:kms:...
```

#### 2. Rate Limiting
```typescript
// Per user, per hour
const LIMITS = {
  intentCreation: 10,
  execution: 5,
  walletCreation: 1
};
```

#### 3. Spending Limits (Future)
```typescript
wallets:
  - daily_limit_usd (default: $1000)
  - requires_approval_above_usd (default: $5000)
```

#### 4. Audit Logging
```typescript
audit_logs:
  - id
  - user_id
  - wallet_id
  - action (enum: 'key_generated', 'key_decrypted', 'tx_signed')
  - metadata (jsonb)
  - ip_address
  - user_agent
  - created_at
```

#### 5. Production Hardening
- **HSM Integration**: Hardware Security Module for key storage
- **Multi-sig**: High-value operations require multiple approvals
- **Cold wallet**: Move most funds to cold storage, hot wallet only for small amounts
- **Insurance**: Smart contract insurance for hacks

---

## Database Schema Changes

### Migration Plan

#### Phase 1: Add New Tables (Non-Breaking)
```sql
-- New user_credentials table
CREATE TABLE user_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_user_id)
);

CREATE INDEX idx_user_credentials_user_id ON user_credentials(user_id);
CREATE INDEX idx_user_credentials_provider ON user_credentials(provider, provider_user_id);

-- New wallets table
CREATE TABLE wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  address TEXT NOT NULL UNIQUE,
  encrypted_private_key TEXT NOT NULL,
  encryption_key_id TEXT NOT NULL DEFAULT 'master-key-v1',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_wallets_user_id ON wallets(user_id);
CREATE INDEX idx_wallets_address ON wallets(address);
```

#### Phase 2: Migrate Existing Data
```sql
-- Migrate telegram_id to user_credentials
INSERT INTO user_credentials (user_id, provider, provider_user_id, metadata)
SELECT
  id,
  'telegram',
  telegram_id::text,
  jsonb_build_object(
    'username', telegram_username,
    'first_name', telegram_first_name
  )
FROM users
WHERE telegram_id IS NOT NULL;

-- Generate wallets for existing users (run via script, not SQL)
-- See: scripts/generate-wallets-for-existing-users.ts
```

#### Phase 3: Update Schema
```sql
-- Remove Telegram-specific columns from users table
ALTER TABLE users DROP COLUMN telegram_id;
ALTER TABLE users DROP COLUMN telegram_username;
ALTER TABLE users DROP COLUMN telegram_first_name;
```

### Final Schema

```typescript
// users: core identity
{
  id: UUID (PK)
  created_at: timestamp
  updated_at: timestamp
}

// user_credentials: auth methods (1:many with users)
{
  id: UUID (PK)
  user_id: UUID (FK → users.id)
  provider: 'telegram' | 'email' | 'google' | 'apple'
  provider_user_id: string (telegram_id, email, oauth_sub)
  metadata: jsonb (provider-specific data)
  created_at: timestamp
  UNIQUE(provider, provider_user_id)
}

// wallets: one EOA per user
{
  id: UUID (PK)
  user_id: UUID (FK → users.id, UNIQUE)
  address: string (Ethereum address)
  encrypted_private_key: string (JSON with encryptedData, iv, authTag)
  encryption_key_id: string (reference to master key version)
  created_at: timestamp
}

// intents: unchanged (still references user_id)
{
  id: UUID (PK)
  user_id: UUID (FK → users.id)
  // ... rest unchanged
}

// quotes: unchanged
// executions: unchanged (now uses real wallet.address instead of 0x00...00)
```

---

## Service Layer Architecture

### New Directory Structure

```
src/
├── domain/
│   ├── auth/
│   │   ├── auth-service.ts              # User lookup/creation
│   │   ├── credential-provider.ts       # Interface for auth providers
│   │   └── types.ts
│   ├── wallet/
│   │   ├── wallet-service.ts            # Wallet creation, retrieval
│   │   ├── key-encryption.ts            # Encrypt/decrypt private keys
│   │   ├── key-generator.ts             # Generate new keypairs
│   │   └── types.ts
│   ├── execution/
│   │   ├── execution-service.ts         # Transaction building & signing
│   │   ├── transaction-signer.ts        # Viem integration
│   │   ├── approval-handler.ts          # ERC20 approvals
│   │   └── types.ts
│   ├── intents/
│   │   └── intent-service.ts            # Unchanged (orchestration)
│   └── routing/
│       └── quote-service.ts             # Unchanged
│
├── interfaces/                           # NEW: Interface adapters
│   ├── telegram/
│   │   ├── bot.ts                       # Telegram bot
│   │   ├── auth.ts                      # Telegram-specific auth
│   │   └── handlers/
│   │       ├── start.ts
│   │       ├── intent.ts
│   │       └── wallet.ts
│   ├── web/                             # Future: Web UI
│   │   ├── auth-routes.ts
│   │   ├── session-middleware.ts
│   │   └── passport-config.ts
│   └── webapp/                          # Future: Telegram WebApp
│       └── auth.ts
│
├── api/
│   ├── middleware/
│   │   ├── auth-middleware.ts           # Extract user from JWT/session
│   │   └── rate-limiter.ts
│   ├── routes/
│   │   ├── auth.ts                      # NEW: POST /auth/telegram, /auth/email
│   │   ├── wallets.ts                   # NEW: GET /wallets, GET /wallets/:id
│   │   ├── intents.ts                   # Updated: use req.user.id
│   │   └── executions.ts                # NEW: GET /executions/:id
│   └── server.ts
│
├── persistence/
│   ├── repositories/
│   │   ├── user-repository.ts           # Simplified (no Telegram fields)
│   │   ├── credential-repository.ts     # NEW
│   │   ├── wallet-repository.ts         # NEW
│   │   ├── intent-repository.ts         # Unchanged
│   │   ├── quote-repository.ts          # Unchanged
│   │   └── execution-repository.ts      # Updated: store real addresses
│   ├── models/
│   │   └── schema.ts                    # Updated schema
│   └── migrations/
│       ├── 0001_add_user_credentials.sql
│       ├── 0002_add_wallets.sql
│       └── 0003_migrate_telegram_data.sql
│
└── workers/
    ├── intent-worker.ts                 # Unchanged (parse, fetch-quotes)
    ├── execution-worker.ts              # NEW: execute-intent job
    └── monitoring-worker.ts             # NEW: monitor-tx job
```

---

## API Design

### Authentication Endpoints

```http
POST /auth/telegram
Body: { telegram_id, username, first_name }
Response: { userId, walletAddress, token }

POST /auth/email/register
Body: { email, password }
Response: { userId, walletAddress, token }

POST /auth/email/login
Body: { email, password }
Response: { userId, walletAddress, token }
```

### Wallet Endpoints

```http
GET /wallets
Headers: Authorization: Bearer <token>
Response: { wallets: [{ id, address, created_at }] }

GET /wallets/:id
Headers: Authorization: Bearer <token>
Response: { id, address, balance, created_at }
```

### Intent Endpoints (Updated)

```http
POST /intents
Headers: Authorization: Bearer <token>
Body: { rawMessage }
Response: { id, state, created_at }

# User authentication extracted from JWT token
# No longer requires userId in body
```

---

## Adding New Interfaces

### Example: Adding Web UI

#### Step 1: Add Email Provider
```typescript
// src/interfaces/web/auth-routes.ts

app.post('/auth/email/register', async (req, reply) => {
  const { email, password } = req.body;

  // Validate email, hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Use existing AuthService (no changes to core)
  const user = await authService.getOrCreateUser({
    provider: 'email',
    providerId: email,
    metadata: {
      email,
      password_hash: hashedPassword,
      verified: false
    }
  });

  // WalletService already created wallet
  const wallet = await walletService.getWalletByUserId(user.id);

  // Generate JWT
  const token = jwt.sign({ userId: user.id }, SECRET);

  return {
    token,
    userId: user.id,
    walletAddress: wallet.address
  };
});
```

#### Step 2: Add Session Middleware
```typescript
// src/api/middleware/auth-middleware.ts

export async function authenticateUser(req, reply) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return reply.status(401).send({ error: 'Unauthorized' });
  }

  const payload = jwt.verify(token, SECRET);
  const user = await getUserById(payload.userId);

  req.user = user; // Attach to request
}
```

#### Step 3: Use Existing APIs
```typescript
// Web UI calls same API routes
fetch('/intents', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ rawMessage: 'swap 100 USDC to ETH' })
});

// Same intent flow, same wallet, same execution
```

**No changes to core domain logic required.**

---

## Implementation Roadmap

### Phase 1: Identity & Wallet Foundation (Week 1)
- [ ] Create `user_credentials` table
- [ ] Create `wallets` table
- [ ] Implement `AuthService`
- [ ] Implement `WalletService` (key generation, encryption)
- [ ] Migrate existing Telegram users

### Phase 2: Execution Integration (Week 2)
- [ ] Implement `ExecutionService` (use real wallet private keys)
- [ ] Update `acceptIntent` to use real wallet address
- [ ] Add `execute-intent` worker
- [ ] Test end-to-end: Telegram → Intent → Execution → On-chain

### Phase 3: Telegram Refactor (Week 3)
- [ ] Update Telegram bot to use `AuthService`
- [ ] Add `/wallet` command (show address, balance)
- [ ] Add `/export` command (show private key with warnings)
- [ ] Update UI to show real wallet addresses

### Phase 4: Web Interface (Week 4)
- [ ] Implement email/password auth
- [ ] Add JWT session management
- [ ] Build minimal Web UI (Next.js/React)
- [ ] Test multi-interface: same user, same wallet

### Phase 5: Security Hardening (Week 5)
- [ ] Add rate limiting per user
- [ ] Implement audit logging
- [ ] Add spending limits
- [ ] KMS integration for production

---

## Security Best Practices

### Development
```env
# .env.local
WALLET_ENCRYPTION_KEY=<32-byte hex string>
DATABASE_URL=postgresql://localhost:5432/onetriplec_dev
NODE_ENV=development
```

### Production
```env
# Use AWS KMS or similar
AWS_KMS_KEY_ID=arn:aws:kms:us-east-1:123456789:key/...
DATABASE_URL=<encrypted connection string>
NODE_ENV=production
RATE_LIMIT_PER_USER_PER_HOUR=10
MAX_DAILY_SPEND_USD=1000
```

### Code Guidelines
1. **Never log private keys**
   ```typescript
   // BAD
   logger.info({ privateKey }, 'Generated key');

   // GOOD
   logger.info({ address }, 'Generated wallet');
   ```

2. **Always encrypt before storage**
   ```typescript
   const { encryptedData, iv, authTag } = encryptPrivateKey(privateKey);
   await saveWallet({ address, encrypted_private_key: JSON.stringify({ encryptedData, iv, authTag }) });
   ```

3. **Use parameterized queries**
   ```typescript
   // Drizzle ORM prevents SQL injection by default
   const wallet = await db.select().from(wallets).where(eq(wallets.userId, userId));
   ```

4. **Rate limit sensitive operations**
   ```typescript
   const rateLimiter = await fastify.register(require('@fastify/rate-limit'), {
     max: 10,
     timeWindow: '1 hour',
     keyGenerator: (req) => req.user.id
   });
   ```

---

## Comparison: Before vs After

### Before (Telegram-First)
- User identity tied to Telegram
- No wallet generation
- Placeholder addresses (`0x00...00`)
- Cannot add Web UI without refactor
- No private key management

### After (Channel-Agnostic)
- User identity independent of interface
- Automatic EOA wallet creation
- Real wallet addresses, real transactions
- Web UI adds new provider, uses same services
- Encrypted private key storage with KMS

---

## Conclusion

This architecture provides:
1. **Channel-agnostic identity**: Users can authenticate via any interface
2. **Automatic wallet creation**: EOA generated on signup
3. **Secure key custody**: Encrypted private keys with KMS
4. **Clean separation**: Auth ↔ Wallet ↔ Execution decoupled
5. **Extensibility**: New interfaces added without core changes

Trade-offs accepted:
- Custodial model (backend holds keys)
- Single point of failure (mitigated with encryption, rate limits, auditing)
- Regulatory compliance required (MSB/FinCEN)

The system prioritizes UX (no wallet connection) while maintaining security through encryption, rate limiting, and audit logging.
