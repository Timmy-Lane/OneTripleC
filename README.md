# OneTripleC

> **Custodial wallet and cross-chain execution backend with channel-agnostic architecture**

OneTripleC is a backend-first Web3 portfolio project demonstrating production-grade architecture for custodial wallet management and cross-chain intent execution. Users receive an automatic EOA wallet upon signup (via any interface: Telegram, Web, WebApp) and can execute cross-chain swaps without connecting a wallet.

**Portfolio Project Disclaimer**
This is a technical demonstration project, not a production DeFi protocol. Built to showcase backend architecture, custodial wallet security, multi-interface design, and engineering discipline for hiring purposes.

## Core Concept

```
User signs up via Telegram/Web/WebApp
           ↓
Backend generates EOA wallet automatically
           ↓
User receives wallet address immediately (no MetaMask, no WalletConnect)
           ↓
User sends intent: "Swap 100 USDC to ETH"
           ↓
System fetches quotes → User confirms
           ↓
Backend signs and executes transaction with user's wallet
           ↓
User receives tx hash + execution report
```

**Key Principles:**
- **Custodial simplicity**: Backend generates and securely stores private keys
- **No wallet connection flow**: Users get wallet address immediately
- **Channel-agnostic**: Same wallet accessible from Telegram, Web, or WebApp
- **Backend-first**: API drives everything
- **Explainable routing**: Net output, fees, ETA
- **Reliability > speed**: State machines, retries, monitoring

## Architecture Overview

### Channel-Agnostic Design
```
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ Telegram Bot     │    │ Web UI (future)  │    │ WebApp (future)  │
│ (Interface)      │    │ (Interface)      │    │ (Interface)      │
└────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                                 ▼
                      ┌──────────────────┐
                      │ AuthService      │
                      │ (User Identity)  │
                      └─────────┬────────┘
                                │
                    ┌───────────┴───────────┐
                    │                       │
                    ▼                       ▼
         ┌──────────────────┐    ┌──────────────────┐
         │ WalletService    │    │ IntentService    │
         │ (EOA Custody)    │    │ (Orchestration)  │
         └──────────────────┘    └──────────────────┘
                    │                       │
                    └───────────┬───────────┘
                                │
                                ▼
                      ┌──────────────────┐
                      │ ExecutionService │
                      │ (Signs & Submits)│
                      └──────────────────┘
                                │
                                ▼
                      ┌──────────────────┐
                      │ Blockchain (EVM) │
                      └──────────────────┘
```

### Data Flow

**User Signup (Any Interface):**
1. User signs up via Telegram/Web/WebApp
2. Backend creates user identity (channel-agnostic)
3. Backend generates new EOA keypair (viem)
4. Private key encrypted with AES-256-GCM
5. Wallet stored in database
6. User receives wallet address immediately

**Intent Execution:**
1. User sends intent: "swap 100 USDC to ETH"
2. Backend parses intent, fetches quotes from DEXs
3. User confirms quote
4. Backend retrieves user's wallet, decrypts private key
5. Backend signs transaction using wallet's private key
6. Transaction submitted to blockchain
7. Backend monitors confirmation
8. User receives notification via their interface

### Supported v1 Scope
- **Networks**: Ethereum, Base, Arbitrum (same-chain swaps only initially)
- **Tokens**: Whitelisted ERC20 + native tokens
- **DEX**: Uniswap V2, Uniswap V3
- **Bridge**: Cross-chain support (future)
- **Interfaces**: Telegram (current), Web/WebApp (future)

## Project Structure

```
OneTripleC/
├── src/                           # Backend application core
│   ├── interfaces/                # Channel-specific adapters
│   │   ├── telegram/              # Telegram bot integration
│   │   ├── web/                   # Web UI (future)
│   │   └── webapp/                # Telegram WebApp (future)
│   ├── api/                       # Fastify API layer
│   │   ├── middleware/            # Auth, rate-limiting
│   │   └── routes/                # auth, wallets, intents, quotes, executions
│   ├── domain/                    # Core business logic
│   │   ├── auth/                  # User authentication (channel-agnostic)
│   │   ├── wallet/                # Wallet creation, key encryption
│   │   ├── intents/               # Intent processing
│   │   ├── execution/             # Transaction signing & submission
│   │   └── routing/               # DEX/bridge routing
│   ├── adapters/                  # External service integrations
│   │   ├── blockchain/            # Viem clients, RPC access
│   │   ├── dex/                   # Uniswap V2/V3 adapters
│   │   ├── bridge/                # Bridge adapters (future)
│   │   └── telegram/              # Telegram Bot API client
│   ├── workers/                   # BullMQ background workers
│   ├── persistence/               # Database (PostgreSQL + Drizzle ORM)
│   │   ├── models/                # Database schema
│   │   └── repositories/          # users, credentials, wallets, intents, quotes, executions
│   └── shared/                    # Shared utilities & types
├── docs/                          # Technical documentation
│   └── ARCHITECTURE.md            # Comprehensive architecture design
├── CLAUDE.md                      # Development instructions for Claude Code
└── README.md                      # This file
```

## Tech Stack

**Backend Infrastructure:**
- **Runtime**: Bun (not Node.js)
- **API**: Fastify (performance + plugins)
- **Database**: PostgreSQL + Drizzle ORM
- **Queue**: Redis + BullMQ (async execution)
- **Blockchain**: Viem (EVM interactions)
- **Encryption**: Node.js crypto (AES-256-GCM)

**Architecture Patterns:**
- Channel-agnostic user identity
- Custodial wallet management
- Intent-based state machines
- Asynchronous worker execution
- Repository pattern + domain-driven design

## Local Development

### Prerequisites

**Required:**
- [Bun](https://bun.sh/) v1.0.0 or later
- [Docker](https://www.docker.com/get-started) and [Docker Compose](https://docs.docker.com/compose/install/)

### Quick Start

**1. Clone and install dependencies:**

```bash
git clone <repository>
cd OneTripleC
bun install
```

**2. Start local infrastructure (PostgreSQL + Redis):**

```bash
docker compose up -d
docker compose ps  # Verify containers are running
```

**3. Configure environment:**

```bash
cp .env.example .env

# Edit .env and set:
# - DATABASE_URL (default works with Docker Compose)
# - REDIS_URL (default works with Docker Compose)
# - WALLET_ENCRYPTION_KEY (generate 32-byte hex string)
# - RPC URLs for Ethereum, Base, Arbitrum
# - TELEGRAM_BOT_TOKEN (optional, for Telegram bot)
```

**Generate encryption key:**
```bash
# Generate a secure 32-byte key for wallet encryption
openssl rand -hex 32
```

**4. Initialize database:**

```bash
bun run db:generate
bun run db:migrate

# (Optional) Open Drizzle Studio to inspect database
bun run db:studio
```

**5. Start the backend:**

```bash
# Terminal 1: Start API server
bun run dev

# Terminal 2: Start background workers
bun run worker:start

# Terminal 3: Start Telegram bot (optional)
bun run bot:start
```

The API will be available at `http://localhost:3000`. Health check: `http://localhost:3000/health`

### Development Commands

```bash
# API & Workers
bun run dev              # Start API server with hot reload
bun run worker:start     # Start background workers
bun run bot:start        # Start Telegram bot
bun run start            # Production mode (no hot reload)

# Database
bun run db:generate      # Generate Drizzle migrations
bun run db:migrate       # Run migrations
bun run db:studio        # Open Drizzle Studio

# Code Quality
bun run typecheck        # TypeScript type checking
bun run lint             # ESLint
bun run lint:fix         # ESLint with auto-fix
bun run format           # Prettier formatting
bun run format:check     # Check formatting
bun test                 # Run tests
```

### Infrastructure Details

**Docker Compose services:**

- **PostgreSQL**: Port `5432`, database `onetriplec`
- **Redis**: Port `6379`, persistence enabled

**Stopping infrastructure:**

```bash
docker compose stop         # Stop containers (keeps data)
docker compose down         # Stop and remove containers (keeps volumes)
docker compose down -v      # Stop and remove everything including data
```

## Database Schema

### Core Tables

```typescript
// users: channel-agnostic identity
users:
  - id (UUID, PK)
  - created_at
  - updated_at

// user_credentials: authentication methods (Telegram, email, OAuth)
user_credentials:
  - id (UUID, PK)
  - user_id (FK → users.id)
  - provider (enum: 'telegram' | 'email' | 'google' | 'apple')
  - provider_user_id (text)
  - metadata (jsonb)
  - UNIQUE(provider, provider_user_id)

// wallets: one EOA per user
wallets:
  - id (UUID, PK)
  - user_id (FK → users.id, UNIQUE)
  - address (text, UNIQUE)
  - encrypted_private_key (text)
  - encryption_key_id (text)

// intents: user intent lifecycle
intents:
  - id (UUID, PK)
  - user_id (FK → users.id)
  - raw_message (text)
  - state (enum: CREATED, PARSING, PARSED, QUOTED, ACCEPTED, EXECUTING, COMPLETED, FAILED)
  - source_chain_id, target_chain_id, source_token, target_token, source_amount
  - error_message

// quotes: route options for intents
quotes:
  - id (UUID, PK)
  - intent_id (FK → intents.id)
  - route (jsonb: steps, fees, provider)
  - estimated_output, total_fee
  - expires_at

// executions: transaction execution tracking
executions:
  - id (UUID, PK)
  - intent_id (FK → intents.id)
  - quote_id (FK → quotes.id)
  - user_address (wallet address)
  - tx_hash (transaction hash on blockchain)
  - state (enum: PENDING, EXECUTING, COMPLETED, FAILED)
```

## Security Model

### Custodial Trade-offs

**Accepted:**
- Backend generates and stores private keys
- Single point of failure (backend compromise = all keys exposed)
- Regulatory implications (custodial = MSB in some jurisdictions)

**UX Benefits:**
- No wallet connection required
- Instant onboarding (wallet address in <1 second)
- Multi-device access (same wallet from any interface)
- No seed phrase management for users

### Security Measures

**Encryption:**
- AES-256-GCM for all private keys at rest
- Master key stored in KMS (production) or env vars (dev)
- Unique IV and auth tag per encrypted key

**Access Controls:**
- Rate limiting per user and operation type
- Audit logging for all key decryption and transaction signing
- Private keys never logged or exposed in responses

**Production Hardening (Future):**
- HSM integration for key storage
- Multi-sig for high-value operations
- Spending limits per user (daily/per-transaction)
- Transaction approval flow for large amounts
- Cold wallet for most funds, hot wallet for small amounts

### Threat Model

| Risk | Impact | Mitigation |
|------|--------|-----------|
| Backend compromise | All keys exposed | Encryption at rest, KMS, rate limiting |
| Database breach | Encrypted keys stolen | Master key stored separately, strong encryption |
| Insider threat | Developer access | Access controls, audit logs, least privilege |
| Phishing | User tricked | Transaction approval UI, spending limits |
| Regulatory | Custodial = MSB | Compliance framework, KYC (future) |

## What This Project Demonstrates

### Backend Engineering
- Production-grade API architecture (Fastify)
- Custodial wallet management with encryption
- Channel-agnostic user identity model
- Asynchronous job processing at scale (BullMQ)
- Database design for financial applications
- Error handling + retry strategies

### Web3 Orchestration
- Multi-chain transaction coordination
- DEX adapter pattern (Uniswap V2/V3)
- Quote aggregation and routing
- Transaction signing with viem
- Real-time blockchain monitoring

### System Design
- Clean separation of concerns (interfaces ↔ domain ↔ persistence)
- Intent-based user experience
- State machine execution models
- Extensible interface layer (Telegram → Web → WebApp)

## Explicit Non-Goals

**This project intentionally excludes:**
- Non-custodial wallet architecture
- Account Abstraction (ERC-4337)
- Production DeFi protocol features
- Advanced trading strategies
- User onboarding or KYC (v1)
- React dashboard/frontend (v1)
- Gasless transactions or paymasters
- Multi-sig or governance systems

## Adding New Interfaces

### Example: Adding Web UI

**Step 1:** Implement authentication
```typescript
// src/interfaces/web/auth-routes.ts
app.post('/auth/email/register', async (req, reply) => {
  const { email, password } = req.body;

  // Use existing AuthService (no core changes needed)
  const user = await authService.getOrCreateUser({
    provider: 'email',
    providerId: email,
    metadata: { email }
  });

  // WalletService already created wallet
  const wallet = await walletService.getWalletByUserId(user.id);

  return { token: generateJWT(user.id), walletAddress: wallet.address };
});
```

**Step 2:** Use existing APIs
```typescript
// Web UI calls same API routes as Telegram
fetch('/intents', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({ rawMessage: 'swap 100 USDC to ETH' })
});
```

**No changes to core domain logic required.**

## Future Extensions

**Potential v2 features (not implemented):**
- Web UI (email/password, OAuth)
- Telegram WebApp (in-app wallet access)
- Cross-chain bridge integration (Across, Stargate)
- Additional DEX protocols (1inch, Paraswap)
- Advanced routing algorithms
- Real-time price feeds
- Spending limits and approval flows
- Multi-sig for high-value operations
- Cold wallet integration

---

**Author**: Portfolio demonstration project
**Purpose**: Technical architecture showcase
**Status**: Active development

For detailed architecture documentation, see [ARCHITECTURE.md](./ARCHITECTURE.md)
For development instructions, see [CLAUDE.md](./CLAUDE.md)
