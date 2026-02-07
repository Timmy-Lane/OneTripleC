# OneTripleC

> **Custodial wallet and swap execution backend for Telegram**

OneTripleC is a Web3 backend that provides automatic EOA wallet creation and token swap execution via Telegram bot. Users receive a wallet instantly on signup and can execute swaps without connecting an external wallet.

**Portfolio Project Disclaimer**
This is a technical demonstration project showcasing backend architecture, custodial wallet security, and Web3 integration.

## Core Concept

```
User sends /start to Telegram bot
           |
Backend generates EOA wallet automatically
           |
User receives wallet address immediately
           |
User initiates swap via bot
           |
System fetches quotes -> User confirms
           |
Backend signs and executes transaction
           |
User receives tx hash + explorer link
```

**Key Principles:**
- **Custodial simplicity**: Backend generates and securely stores private keys
- **No wallet connection**: Users get wallet address immediately
- **Telegram-native**: Full functionality via bot interface
- **Backend-first**: API drives everything

## Architecture

```
+------------------+
|  Telegram Bot    |
|  (Interface)     |
+--------+---------+
         |
         v
+------------------+
|  Fastify API     |
|  (REST + JWT)    |
+--------+---------+
         |
    +----+----+
    |         |
    v         v
+-------+  +----------+
|Wallet |  | Intent   |
|Service|  | Service  |
+-------+  +----+-----+
               |
               v
         +----------+
         |Execution |
         | Service  |
         +----+-----+
              |
              v
         +----------+
         |Blockchain|
         +----------+
```

### Data Flow

**User Signup:**
1. User sends `/start` to Telegram bot
2. Backend creates user, generates EOA keypair
3. Private key encrypted with AES-256-GCM
4. User receives wallet address

**Swap Execution:**
1. User initiates swap via bot
2. Backend parses intent, fetches quotes from DEXs
3. User confirms quote
4. Backend decrypts private key, signs transaction
5. Transaction submitted to blockchain
6. User receives confirmation + explorer link

## Project Structure

```
OneTripleC/
+-- src/
|   +-- api/                    # Fastify API layer
|   |   +-- middleware/         # Auth, rate-limiting
|   |   +-- routes/             # auth, wallets, intents, executions
|   +-- domain/                 # Core business logic
|   |   +-- auth/               # User authentication
|   |   +-- wallet/             # Wallet creation, encryption
|   |   +-- intents/            # Intent processing
|   |   +-- execution/          # Transaction signing
|   |   +-- routing/            # DEX routing
|   +-- adapters/               # External integrations
|   |   +-- blockchain/         # Viem clients
|   |   +-- dex/                # Uniswap V2/V3 adapters
|   +-- workers/                # BullMQ background workers
|   +-- persistence/            # PostgreSQL + Drizzle ORM
|   +-- services/               # Telegram bot, queue setup
|   +-- shared/                 # Config, types, utils
+-- docs/                       # Documentation
+-- CLAUDE.md                   # Development instructions
+-- README.md                   # This file
```

## Tech Stack

- **Runtime**: Bun
- **API**: Fastify
- **Database**: PostgreSQL + Drizzle ORM
- **Queue**: Redis + BullMQ
- **Blockchain**: Viem
- **Encryption**: AES-256-GCM
- **Bot**: grammy (Telegram Bot API)

## V1 Scope

- **Networks**: Ethereum, Base, Arbitrum (same-chain swaps)
- **DEX**: Uniswap V2, Uniswap V3
- **Interface**: Telegram bot only

## Local Development

### Prerequisites

- [Bun](https://bun.sh/) v1.0.0+
- [Docker](https://www.docker.com/get-started) + Docker Compose

### Quick Start

```bash
# Install dependencies
bun install

# Start infrastructure
docker compose up -d

# Configure environment
cp .env.example .env
# Edit .env with your values

# Generate encryption key
openssl rand -hex 32

# Initialize database
bun run db:generate
bun run db:migrate

# Start services (3 terminals)
bun run dev           # API server
bun run worker:start  # Background workers
bun run bot:start     # Telegram bot
```

API available at `http://localhost:3000`

### Commands

```bash
# Development
bun run dev              # API with hot reload
bun run worker:start     # Workers
bun run bot:start        # Telegram bot

# Database
bun run db:generate      # Generate migrations
bun run db:migrate       # Run migrations
bun run db:studio        # Drizzle Studio

# Quality
bun run typecheck        # Type checking
bun run lint             # ESLint
bun test                 # Tests
```

## Security

### Encryption
- AES-256-GCM for private keys at rest
- Master key in env vars (dev) or KMS (production)
- Unique IV per encrypted key

### Access Controls
- JWT authentication required
- Rate limiting per user
- Private keys never logged

## API Endpoints

```
POST /auth/telegram      - Authenticate, get JWT
POST /auth/refresh       - Refresh JWT
GET  /auth/me            - Current user info

GET  /wallets            - Get user wallet + balance
GET  /wallets/:id        - Get wallet by ID

POST /intents            - Create swap intent
GET  /intents/:id        - Get intent status
GET  /intents/:id/quotes - Get available quotes
POST /intents/:id/accept - Accept quote, execute

GET  /executions/:id     - Get execution status
```

All routes require `Authorization: Bearer <token>` header.

---

**Status**: Active development
**Docs**: See [CLAUDE.md](./CLAUDE.md) for development guide
