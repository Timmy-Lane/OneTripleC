---
description: Backend architecture for OneTripleC, a Telegram-first cross-chain intent execution platform
globs: '*.ts, *.tsx, *.html, *.css, *.js, *.jsx, package.json'
alwaysApply: true
---

# OneTripleC Architecture

## System Overview

OneTripleC is a **backend-heavy, Telegram-first** cross-chain intent execution platform.

- Primary interface: Telegram bot
- Minimal frontend: WebApp for confirmations only
- Core product: Backend orchestration of cross-chain transactions

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

### 1. API Layer (`src/api/`)

**Responsibility**: HTTP transport and orchestration

- Thin controllers that validate input and delegate to domain services
- Expose REST endpoints for Telegram bot and WebApp
- Return HTTP errors, never throw unhandled exceptions
- **Does NOT contain business logic**

**Key files**:

- `server.ts`: Fastify setup, plugin registration, health checks
- `routes/`: One file per domain (intents, quotes, executions, users)
- `middleware/`: Auth, rate-limiting, error handling
- `schemas/`: Zod schemas for request/response validation

### 2. Domain Layer (`src/domain/`)

**Responsibility**: Pure business logic (framework-agnostic)

- Orchestrates workflows (parse intent → fetch quotes → build execution)
- Stateless services, no direct DB or API knowledge
- Depends ONLY on repositories and adapters (via interfaces)
- **Does NOT know about HTTP or Workers**

**Key files**:

- `intents/intent-service.ts`: Intent lifecycle orchestration
- `routing/quote-service.ts`: Quote fetching and ranking
- `execution/execution-service.ts`: Transaction building and submission
- `state/state-machine.ts`: Intent state transitions

### 3. Persistence Layer (`src/persistence/`)

**Responsibility**: Database access (PostgreSQL)

- Repository pattern: one repository per aggregate root
- Only executes queries, no business logic
- Uses Drizzle ORM for type-safe queries

**Key files**:

- `db.ts`: Drizzle client setup
- `models/schema.ts`: Database schema (tables, enums, indexes)
- `repositories/`: CRUD operations per entity

### 4. Workers Layer (`src/workers/`)

**Responsibility**: Background job processing (BullMQ)

- Dequeue jobs from Redis
- Orchestrate domain services
- Handle retries and error logging
- Update job progress

**Key files**:

- `index.ts`: Worker initialization
- `execution/`: Intent parsing, quote fetching, execution
- `monitoring/`: Transaction monitoring, quote expiry
- `notifications/`: Telegram notifications

### 5. Adapters Layer (`src/adapters/`)

**Responsibility**: External service clients

- Abstract external APIs behind interfaces
- Called by domain services, not directly by API or workers
- Retry logic and error mapping

**Key files**:

- `blockchain/`: Viem clients, transaction submission
- `dex/`: Uniswap, 1inch, 0x adapters
- `bridge/`: Across, Stargate adapters
- `telegram/`: Telegram Bot API client

## Data Flow

### Telegram → Create Intent

1. Bot sends `POST /intents` with raw message
2. API validates, persists intent (state: `CREATED`), enqueues `parse-intent` job
3. Worker dequeues, calls `IntentService.parseIntent()`, updates state to `PARSED`
4. Worker enqueues `fetch-quotes` job
5. Worker fetches quotes, persists to DB, updates state to `QUOTED`
6. Bot polls `GET /intents/:id`, shows quotes to user

### Confirm Intent → Execute

1. User confirms via Telegram
2. Bot sends `POST /intents/:id/confirm`
3. API validates quote, updates state to `ACCEPTED`, enqueues `execute-intent` job
4. Worker dequeues, calls `ExecutionService.execute()`, builds txs
5. Worker submits tx, enqueues `monitor-tx` job
6. Monitoring worker polls RPC, updates tx state on confirmation
7. Notification worker sends Telegram message

## Folder Structure

```
src/
├── api/                  # HTTP transport (Fastify routes)
├── domain/               # Business logic (services, state machines)
├── persistence/          # Database access (repositories, Drizzle)
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
| users | Telegram identity | REQUIRED |
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
| sessions | Ephemeral state | Use Redis |
| routes | Premature optimization | Fetch quotes on demand |
| dexes | Protocol config | Hardcode in adapters |
| bridges | Protocol config | Hardcode in adapters |
| wallets | No persistent wallet mgmt | Prompt user per execution |

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

- Rate limiting per Telegram user
- Telegram auth validation (webhook signature)
- Private key management (env vars, secrets manager)

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

DO NOT USE EMOJI
