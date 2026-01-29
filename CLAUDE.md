---
description: Backend architecture for OneTripleC, a custodial wallet and cross-chain execution platform with channel-agnostic design
globs: '*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json'
alwaysApply: true
---

# OneTripleC Architecture

## System Overview

OneTripleC is a **custodial wallet and execution backend** with channel-agnostic architecture.

- Core product: Automatic EOA wallet creation + cross-chain transaction execution
- Multi-interface: Telegram, Web UI, WebApp (all clients, not the architecture)
- Custodial model: Backend generates and securely stores private keys
- No wallet connection required: Users get wallet address immediately on signup

## Technology Stack

### Runtime & Tooling

- **Runtime**: Bun (not Node.js)
  - Use `bun <file>` instead of `node <file>` or `ts-node <file>`
  - Use `bun test` instead of `jest` or `vitest`
  - Use `bun run <script>` instead of `npm run <script>`
  - Use `bunx <package>` instead of `npx <package>`
  - Bun automatically loads `.env` (no dotenv needed)

### Core Stack

- **HTTP Server**: Fastify (not Express, not Bun.serve)
  - Reason: Production-grade plugins (rate-limit, swagger, helmet)
  - Fastify is battle-tested for high-throughput APIs
- **Database**: PostgreSQL via Drizzle ORM
  - Source of truth for all state
  - Migrations in `src/persistence/migrations/`
- **Job Queue**: BullMQ + ioredis
  - Redis as job queue and ephemeral cache
  - Workers process background tasks
- **Blockchain**: Viem (not ethers.js)
  - Multi-chain RPC client
  - Transaction building and submission

## Architectural Layers

### 1. Interfaces Layer (`src/interfaces/`)

**Responsibility**: Channel-specific adapters (Telegram, Web, WebApp)

- Each interface authenticates users via its own method
- All interfaces use `AuthService` to get/create users
- Returns user.id to API layer via JWT or session
- **Interface implementations are independent and pluggable**

**Key files**:

- `telegram/bot.ts`: Telegram bot handlers
- `telegram/auth.ts`: Telegram-specific authentication
- `web/auth-routes.ts`: Email/password, OAuth (future)
- `webapp/auth.ts`: Telegram WebApp authentication (future)

### 2. API Layer (`src/api/`)

**Responsibility**: HTTP transport and orchestration

- Thin controllers that validate input and delegate to domain services
- Expose REST endpoints for all interfaces
- Extract user from JWT/session via middleware
- Return HTTP errors, never throw unhandled exceptions
- **Does NOT contain business logic**

**Key files**:

- `server.ts`: Fastify setup, plugin registration, health checks
- `routes/`: One file per domain (auth, wallets, intents, quotes, executions)
- `middleware/`: Auth extraction, rate-limiting, error handling
- `schemas/`: Zod schemas for request/response validation

### 3. Domain Layer (`src/domain/`)

**Responsibility**: Pure business logic (framework-agnostic)

- Orchestrates workflows (auth → wallet → intent → quote → execution)
- Stateless services, no direct DB or API knowledge
- Depends ONLY on repositories and adapters (via interfaces)
- **Does NOT know about HTTP, Workers, or Interfaces**

**Key files**:

- `auth/auth-service.ts`: Channel-agnostic user lookup/creation
- `wallet/wallet-service.ts`: Wallet creation, key encryption/decryption
- `intents/intent-service.ts`: Intent lifecycle orchestration
- `routing/quote-service.ts`: Quote fetching and ranking
- `execution/execution-service.ts`: Transaction building and signing with wallet keys

### 4. Persistence Layer (`src/persistence/`)

**Responsibility**: Database access (PostgreSQL)

- Repository pattern: one repository per aggregate root
- Only executes queries, no business logic
- Uses Drizzle ORM for type-safe queries

**Key files**:

- `db.ts`: Drizzle client setup
- `models/schema.ts`: Database schema (tables, enums, indexes)
- `repositories/`: CRUD operations per entity
  - `user-repository.ts`: User CRUD (channel-agnostic)
  - `credential-repository.ts`: User authentication credentials (Telegram, email, OAuth)
  - `wallet-repository.ts`: Wallet CRUD and encrypted key storage
  - `intent-repository.ts`, `quote-repository.ts`, `execution-repository.ts`: Unchanged

### 5. Workers Layer (`src/workers/`)

**Responsibility**: Background job processing (BullMQ)

- Dequeue jobs from Redis
- Orchestrate domain services
- Handle retries and error logging
- Update job progress

**Key files**:

- `index.ts`: Worker initialization (parse-intent, fetch-quotes)
- `execution-worker.ts`: Execute intent (sign & submit transactions)
- `monitoring-worker.ts`: Monitor transaction confirmations
- `notification-worker.ts`: Send Telegram/email notifications

### 6. Adapters Layer (`src/adapters/`)

**Responsibility**: External service clients

- Abstract external APIs behind interfaces
- Called by domain services, not directly by API or workers
- Retry logic and error mapping

**Key files**:

- `blockchain/`: Viem clients, transaction submission
- `dex/`: Uniswap, 1inch, 0x adapters
- `bridge/`: Across, Stargate adapters
- `telegram/`: Telegram Bot API client

## User Identity Model (Channel-Agnostic)

### Core Principle
User identity is independent of any interface. Users can authenticate via Telegram, email, OAuth, or future methods.

### Database Schema

```typescript
// users: core identity (channel-agnostic)
users:
  - id (UUID, PK)
  - created_at
  - updated_at

// user_credentials: authentication methods (1:many with users)
user_credentials:
  - id (UUID, PK)
  - user_id (UUID, FK → users.id)
  - provider (enum: 'telegram' | 'email' | 'google' | 'apple')
  - provider_user_id (text: telegram_id, email, oauth_sub)
  - metadata (jsonb: provider-specific data)
  - created_at
  - UNIQUE(provider, provider_user_id)

// wallets: one EOA per user
wallets:
  - id (UUID, PK)
  - user_id (UUID, FK → users.id, UNIQUE)
  - address (text, UNIQUE)
  - encrypted_private_key (text)
  - encryption_key_id (text)
  - created_at
```

### AuthService Pattern

```typescript
// All interfaces use this single entry point
const user = await authService.getOrCreateUser({
  provider: 'telegram',
  providerId: ctx.from.id.toString(),
  metadata: { username: ctx.from.username }
});

// Returns user.id for use in API requests
// WalletService automatically created wallet during user creation
```

## Wallet Management (Custodial Model)

### Automatic Wallet Creation
- One EOA wallet per user
- Generated automatically on user signup
- Private key encrypted with AES-256-GCM
- Wallet address returned immediately

### Key Generation Flow

```typescript
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

// 1. Generate keypair
const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

// 2. Encrypt private key
const { encryptedData, iv, authTag } = encryptPrivateKey(
  privateKey,
  MASTER_KEY
);

// 3. Store wallet
await createWallet({
  userId: user.id,
  address: account.address,
  encrypted_private_key: JSON.stringify({ encryptedData, iv, authTag })
});
```

### Security Model
- **Encryption at rest**: AES-256-GCM with backend master key
- **Key storage**: Master key in env vars (dev) or KMS (production)
- **Rate limiting**: Per user, per operation
- **Audit logging**: All key access logged
- **Never logged**: Private keys never appear in logs or responses

### Transaction Signing

```typescript
// ExecutionService uses wallet's private key to sign transactions
const wallet = await walletService.getWalletByUserId(userId);
const privateKey = await walletService.getPrivateKey(wallet.id);

const account = privateKeyToAccount(privateKey);
const client = createWalletClient({ account, chain, transport });

const hash = await client.sendTransaction(tx);
```

## Data Flow

### User Signup (Any Interface)

1. User signs up via Telegram/Web/WebApp
2. Interface calls `AuthService.getOrCreateUser({ provider, providerId, metadata })`
3. AuthService creates user in `users` table
4. AuthService creates credential in `user_credentials` table
5. WalletService generates new EOA keypair (viem)
6. WalletService encrypts private key with master key
7. WalletService creates wallet in `wallets` table
8. User receives wallet address immediately

### Interface → Create Intent

1. User sends message via any interface (Telegram, Web, etc.)
2. Interface authenticates user, gets `user.id`
3. Interface sends `POST /intents` with JWT/session (contains `user.id`) and raw message
4. API extracts `user.id` from auth middleware
5. API validates, persists intent (state: `CREATED`), enqueues `parse-intent` job
6. Worker dequeues, calls `IntentService.parseIntent()`, updates state to `PARSED`
7. Worker enqueues `fetch-quotes` job
8. Worker fetches quotes, persists to DB, updates state to `QUOTED`
9. Interface polls `GET /intents/:id`, shows quotes to user

### Confirm Intent → Execute

1. User confirms via any interface
2. Interface sends `POST /intents/:id/accept` with quoteId
3. API validates quote, updates state to `ACCEPTED`, enqueues `execute-intent` job
4. Worker dequeues, calls `ExecutionService.execute()`
5. ExecutionService gets user's wallet, decrypts private key
6. ExecutionService builds and signs transactions using wallet's private key
7. ExecutionService submits tx, stores `tx_hash`, enqueues `monitor-tx` job
8. Monitoring worker polls RPC, updates execution state on confirmation
9. Notification worker sends message to user via their interface

## Folder Structure

```
src/
├── interfaces/           # Channel-specific adapters (Telegram, Web, WebApp)
│   ├── telegram/         # Telegram bot integration
│   ├── web/              # Web UI auth (future)
│   └── webapp/           # Telegram WebApp (future)
├── api/                  # HTTP transport (Fastify routes)
│   ├── middleware/       # Auth, rate-limiting, error handling
│   └── routes/           # auth, wallets, intents, quotes, executions
├── domain/               # Business logic (services, state machines)
│   ├── auth/             # User authentication (channel-agnostic)
│   ├── wallet/           # Wallet creation, key management
│   ├── intents/          # Intent lifecycle orchestration
│   ├── routing/          # Quote fetching and ranking
│   └── execution/        # Transaction building and signing
├── persistence/          # Database access (repositories, Drizzle)
│   ├── models/           # Database schema
│   └── repositories/     # users, credentials, wallets, intents, quotes, executions
├── workers/              # Background jobs (BullMQ workers)
├── adapters/             # External clients (blockchain, DEX, bridge, Telegram)
├── services/             # Infrastructure (Redis, queue setup)
└── shared/               # Config, types, utils, constants
```

## V1 Database Philosophy

OneTripleC's database follows these principles:

### 1. Minimal Persistence
- PostgreSQL is the source of truth for **user actions** and **runtime config**
- Redis is ephemeral (queues, coordination)
- Blockchain is the source of truth for **transaction state**

### 2. Execution-Focused
- **Execution** is the core business unit
- One execution = one logical user action = one or more blockchain transactions
- Store `tx_hash`, not transaction details (fetch via RPC on demand)

### 3. No Premature Optimization
- No route caching (learned routes)
- No balance caching (always fetch from RPC)
- No protocol registries (hardcode in adapters)
- No per-transaction persistence (store final tx_hash only)

### Allowed Tables

| Table | Purpose | Status |
|-------|---------|--------|
| users | Channel-agnostic user identity | REQUIRED |
| user_credentials | Authentication methods (Telegram, email, OAuth) | REQUIRED |
| wallets | EOA wallets (one per user) | REQUIRED |
| intents | Intent lifecycle | REQUIRED |
| quotes | Route options | REQUIRED |
| executions | Execution tracking | REQUIRED |
| chains | Runtime chain config | REQUIRED |
| tokens | Token metadata | ALLOWED (optional) |

### Forbidden Tables

| Table | Why Forbidden | Alternative |
|-------|---------------|-------------|
| orders | Redundant with executions | Use `executions` |
| execution_steps | Over-engineering | Store in `quotes.route` JSON |
| transactions | Duplicates blockchain data | Fetch via RPC using `tx_hash` |
| execution_logs | Logs don't belong in DB | Structured logs (Pino) |
| fee_breakdowns | Redundant accounting | Compute from `quotes.route.fees` |
| balances | Cached RPC data | Query RPC on demand |
| sessions | Ephemeral state | Use Redis or JWT |
| routes | Premature optimization | Fetch quotes on demand |
| dexes | Protocol config | Hardcode in adapters |
| bridges | Protocol config | Hardcode in adapters |

### Rule: Justify New Tables

Before adding a new table, answer:

1. **Can this live in `executions.tx_hash`?**
   - If it's transaction data, fetch via RPC

2. **Can this live in `quotes.route` JSON?**
   - If it's execution steps/details, store in route

3. **Can this live in application logs?**
   - If it's debugging/audit data, use structured logs

4. **Can this live in Redis?**
   - If it's ephemeral session state, use Redis

5. **Can this live in code/config?**
   - If it's protocol addresses/constants, hardcode it

If the answer to ALL of these is "no", then justify the new table.

## State Management

### PostgreSQL (Source of Truth)

- Core entities: users, intents, quotes, executions
- Runtime configuration: chains, tokens
- Atomic updates with transactions
- Indexed for fast queries (see `schema.ts`)

### Redis (Ephemeral)

- Job queues (BullMQ)
- Session state (Telegram chat context)
- Rate-limiting counters
- **Never persists critical data**

## Naming Conventions

### Files

- Kebab-case: `intent-service.ts`, `quote-repository.ts`
- One class per file, filename = class name
- Suffix by type: `-service.ts`, `-repository.ts`, `-adapter.ts`, `-worker.ts`

### Code

- Interfaces: `PascalCase` (e.g., `IntentService`)
- Functions: `camelCase` (e.g., `parseIntent`)
- Constants: `SCREAMING_SNAKE_CASE` (e.g., `MAX_RETRIES`)
- Database columns: `snake_case` (e.g., `source_chain_id`)

### Routes

- RESTful: `/intents`, `/intents/:id`, `/intents/:id/confirm`
- Use nouns, not verbs: `/intents/:id/cancel` (not `/cancelIntent`)

## Error Handling

### API Layer

- Return HTTP errors with status codes
- Map domain errors to HTTP errors:
  - `IntentValidationError` → 400
  - `QuoteExpiredError` → 410
  - `UnauthorizedError` → 401
  - All others → 500

### Domain Layer

- Throw typed errors: `IntentValidationError`, `QuoteExpiredError`, `ExecutionFailedError`
- Never catch errors (let API/Workers handle)

### Workers

- Catch all errors, log, update job state
- Retry with exponential backoff (BullMQ handles this)
- Mark job as failed after max retries

## Testing Strategy

### Unit Tests

- Test domain services in isolation
- Mock repositories and adapters
- Use `bun test`

### Integration Tests

- Test API routes with real DB (test schema)
- Test workers with real Redis (local instance)
- Use factories for test data

### E2E Tests (Future)

- Test Telegram → API → Worker → Blockchain flow
- Use testnet RPCs
- Mock Telegram webhook

## Development Workflow

### Local Setup

```bash
bun install
docker-compose up -d  # PostgreSQL + Redis
bun run db:migrate
bun run dev           # Start API
bun run worker:start  # Start workers
```

### Linting & Type Checking

```bash
bun run lint          # ESLint
bun run typecheck     # TypeScript
bun run format:check  # Prettier
```

### Database Migrations

```bash
bun run db:generate   # Generate migration from schema changes
bun run db:migrate    # Apply migrations
bun run db:studio     # Open Drizzle Studio
```

## Production Considerations

### Deployment

- API and Workers are separate processes
- Scale API horizontally (stateless)
- Scale workers by queue (e.g., 5 execution workers, 10 monitoring workers)

### Monitoring

- Health checks: `/health` (DB + Redis)
- Metrics: BullMQ queue depth, job latency
- Logs: Structured JSON (Pino), sent to log aggregator

### Security

- **Custodial Model Risks**: Backend holds all private keys (single point of failure)
- **Encryption at rest**: AES-256-GCM for all private keys
- **Key management**: Master key in KMS (production) or env vars (dev)
- **Rate limiting**: Per user, per operation type
- **Audit logging**: All key decryption and transaction signing logged
- **Never logged**: Private keys never appear in logs, responses, or errors
- **Spending limits**: Configurable daily/transaction limits per user (future)
- **Interface auth**: Telegram webhook signature validation, JWT for Web/WebApp

## Decision Log

### Why Fastify over Bun.serve?

- Fastify has mature plugin ecosystem (swagger, rate-limit, helmet)
- Bun.serve is great for simple apps, but Fastify is battle-tested

### Why Workers?

- API must respond quickly (<200ms)
- Blockchain queries take seconds
- Workers handle long-running tasks asynchronously

### Why Repositories?

- Decouple domain logic from Drizzle ORM
- Easy to mock for testing
- Single place to change queries

### Why Adapters?

- External APIs change (DEXs, bridges)
- Adapters abstract API details
- Easy to swap implementations

## Frontend (Minimal)

Bun supports HTML imports for the confirmation WebApp:

```ts
import index from './index.html';

Bun.serve({
  routes: {
    '/': index,
  },
  development: {
    hmr: true,
  },
});
```

HTML files can import `.tsx` files directly. Bun bundles automatically.

---

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Intent Lifecycle

The system processes user intents through a state machine:

### State Transitions

```
CREATED → PARSING → PARSED → QUOTED → ACCEPTED → EXECUTING → COMPLETED
    ↓         ↓        ↓         ↓         ↓           ↓
  FAILED   FAILED   FAILED   FAILED   FAILED      FAILED
    ↓         ↓        ↓         ↓
CANCELLED CANCELLED CANCELLED CANCELLED
```

### Intent States

| State           | Description                                 |
| --------------- | ------------------------------------------- |
| CREATED         | Intent received from user, awaiting parsing |
| PARSING         | Worker is parsing the raw message           |
| PARSED          | Intent successfully parsed, ready for quote |
| QUOTED          | Quotes available for user review            |
| ACCEPTED        | User accepted a quote                       |
| EXECUTING       | Transaction being executed                  |
| COMPLETED       | Intent fully executed                       |
| FAILED          | Error occurred at any stage                 |
| CANCELLED       | User cancelled the intent                   |

### Flow

1. **API** (`POST /intents`): Creates intent in `CREATED` state, enqueues `parse-intent` job
2. **Worker**: Picks up job, transitions `CREATED → PARSING → PARSED` (or `FAILED`)
3. **Worker**: On success, enqueues `fetch-quotes` job (stub)
4. **API** (`GET /intents/:id`): Returns current intent state

### Queue Architecture

- **Queue Name**: `intent-queue`
- **Job Types**:
  - `parse-intent`: Parse raw message to extract intent fields
  - `fetch-quotes`: Fetch quotes from DEXs/bridges (stub)

### Files

| Component      | Path                                                |
| -------------- | --------------------------------------------------- |
| API Routes     | `src/api/routes/intents.ts`                         |
| Domain Service | `src/domain/intents/intent-service.ts`              |
| Repository     | `src/persistence/repositories/intent-repository.ts` |
| Queue Service  | `src/services/queue.ts`                             |
| Worker         | `src/workers/index.ts`                              |

### Running Locally

```sh
# Start dependencies
docker compose up -d

# Run API server
bun run src/api/server.ts

# Run workers (in separate terminal)
bun run src/workers/index.ts
```

### Testing the Flow

```sh
# Create an intent (replace USER_ID with a valid user UUID)
curl -X POST http://localhost:3000/intents \
  -H "Content-Type: application/json" \
  -d '{"userId": "USER_ID", "rawMessage": "swap 100 USDC to ETH"}'

# Check intent status
curl http://localhost:3000/intents/INTENT_ID
```

## DEX Adapters

### Uniswap V2 Adapter

**Location**: `src/adapters/dex/uniswap-v2-adapter.ts`

**Purpose**: Provides production-grade Uniswap V2 (constant product AMM) quote fetching and swap transaction building for OneTripleC.

**Supported Features**:
- EVM chains only (Ethereum, Base, Arbitrum, Optimism, Polygon)
- `swapExactTokensForTokens` - user specifies exact input amount
- Single-hop paths (Token ↔ WETH)
- Two-hop paths (Token ↔ Intermediate ↔ WETH)
- Reserves-based quoting (on-chain `getReserves()` calls)
- Constant product formula: x * y = k
- 0.3% fee tier (hardcoded)

**Explicit Limitations**:
- **No auto path discovery**: Pools must be provided by caller
- **No liquidity checks**: Assumes pool has sufficient liquidity
- **No price impact calculation**: Uses simple constant product formula
- **No fee-on-transfer token support**: Standard ERC20 only (no `swapExactTokensForTokensSupportingFeeOnTransferTokens`)
- **No approval logic**: Handled separately by execution service
- **No balance checks**: Assumes caller validated sufficient balance
- **No execution**: Only builds unsigned transaction data

**Architectural Statement**:
This adapter focuses on the core Uniswap V2 constant product AMM formula. It fetches reserves via multicall for efficiency and applies the `(x * y = k)` formula locally. Unlike V3, V2 does not require a separate Quoter contract—quotes are calculated client-side from reserves.

**Integration**:
- Implements `DexAdapter` interface
- Called by `QuoteService` in domain layer
- Uses `getViemClient()` for blockchain access
- Uses `getRouterAddress()` from registries
- Fetches reserves via multicall for multiple pools

**Key Differences from V3**:
- **Reserves-based**: Fetches `reserve0` and `reserve1` from pair contracts
- **Local calculation**: Quote math runs client-side (no Quoter contract)
- **Simpler paths**: No compressed encoding, just token address arrays
- **Fixed fee**: 0.3% (V2 does not support multiple fee tiers)

**Usage Example**:
```typescript
const adapter = new UniswapV2Adapter({
  chainId: 1,
  rpcUrl: 'https://eth.llamarpc.com'
});

const quote = await adapter.getQuote({
  chainId: 1,
  fromToken: USDC_ADDRESS,
  toToken: WETH_ADDRESS,
  amount: parseUnits('1000', 6),
  side: 'BUY',
  slippageBps: 50
});

const tx = await adapter.buildSwapTransaction(
  quote,
  userAddress,
  50 // 0.5% slippage
);
```

### Uniswap V3 Adapter

**Location**: `src/adapters/dex/uniswap-v3-adapter.ts`

**Purpose**: Provides production-grade Uniswap V3 quote fetching and swap transaction building for OneTripleC.

**Supported Features**:
- EVM chains only (Ethereum, Base, Arbitrum, Optimism, Polygon)
- `exactInput` swaps ONLY (user specifies input amount)
- Single-hop paths (Token ↔ WETH)
- Two-hop paths (Token ↔ Intermediate ↔ WETH)
- Fixed fee tiers: 500 (0.05%), 3000 (0.3%), 10000 (1%)
- Quoting via Uniswap V3 Quoter contract (on-chain simulation)
- Calldata construction via Uniswap V3 SwapRouter

**Explicit Limitations**:
- **No auto path discovery**: Pools must be provided by caller
- **No liquidity scanning**: Does not query pool liquidity
- **No tick math**: Relies on Quoter contract for calculations
- **No dynamic fee tier search**: Uses default 0.3% (3000) fee tier
- **No batch quoting**: Single quote per call (batch optimization deferred)
- **No permit2**: Standard ERC20 approval flow
- **No approval/allowance logic**: Handled separately by execution service
- **No balance checks**: Assumes caller validated sufficient balance
- **No execution**: Only builds unsigned transaction data

**Architectural Statement**:
This adapter intentionally avoids smart routing and batch quoting. These features belong in higher-level orchestration services. The adapter's role is strictly limited to:
1. Fetching quotes from Uniswap V3 Quoter
2. Encoding swap calldata for Uniswap V3 Router

**Integration**:
- Implements `DexAdapter` interface
- Called by `QuoteService` in domain layer
- Uses `getViemClient()` for blockchain access
- Uses `getRouterAddress()` and `getQuoterAddress()` from registries

**Usage Example**:
```typescript
const adapter = new UniswapV3Adapter({
  chainId: 1,
  rpcUrl: 'https://eth.llamarpc.com'
});

const quote = await adapter.getQuote({
  chainId: 1,
  fromToken: USDC_ADDRESS,
  toToken: WETH_ADDRESS,
  amount: parseUnits('1000', 6),
  side: 'BUY',
  slippageBps: 50
});

const tx = await adapter.buildSwapTransaction(
  quote,
  userAddress,
  50 // 0.5% slippage
);
```

## QuoteService Integration

**Location**: `src/domain/routing/quote-service.ts`

**Purpose**: Orchestrates quote fetching from multiple DEX adapters and returns the best available routes.

**Changes in Step 7**:
- Replaced stub `UniswapAdapter` with real `UniswapV2Adapter` and `UniswapV3Adapter`
- Now requires `QuoteServiceConfig` with `chainId` and `rpcUrl` for adapter initialization
- Fetches quotes from both V2 and V3 adapters in parallel
- Returns all successful quotes (allows caller to select best)
- Removed singleton pattern - use `createQuoteService(config)` factory function

**Current Behavior**:
```typescript
const quoteService = createQuoteService({
  chainId: 1,
  rpcUrl: 'https://eth.llamarpc.com'
});

const quotes = await quoteService.fetchQuotes({
  sourceChainId: 1,
  targetChainId: 1,
  sourceToken: USDC_ADDRESS,
  targetToken: WETH_ADDRESS,
  sourceAmount: '1000000000', // 1000 USDC (6 decimals)
  slippageBps: 50
});

// Returns: QuoteResult[] with both V2 and V3 quotes (if successful)
```

**Type Conversions**:
- Request uses string amounts → converted to `bigint` for adapters
- Adapters return `bigint` amounts → converted back to strings for API
- Uses `Address` type from viem for type safety

**Pool Discovery Status**:
- **Current**: Adapters assume direct pair or single intermediate hop to WETH
- **Limitation**: Does not query pool contracts to verify existence
- **TODO**: Add pool discovery service to validate pool addresses before quoting
- **Workaround**: Adapters derive pool addresses (placeholder logic for MVP)

**Error Handling**:
- Individual adapter failures don't block other adapters
- Returns empty array if all adapters fail
- Logs errors with structured context

**Integration Points**:
- Called by API routes to fetch quotes for user intents
- Adapters use `getViemClient()` for blockchain access
- Future: Add quote ranking/selection logic

DO NOT USE EMOJI
