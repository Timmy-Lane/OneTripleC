# OneTripleC

> **Telegram-first cross-chain intent execution platform for EVM networks**

OneTripleC is a backend-first Web3 portfolio project demonstrating production-grade architecture for cross-chain intent execution. Users specify cross-chain swaps via Telegram, confirm once using Account Abstraction (ERC-4337), and the system automatically executes the full swap + bridge + swap flow.

**⚠️ PORTFOLIO PROJECT DISCLAIMER**  
This is a technical demonstration project, not a production DeFi protocol. Built to showcase backend architecture, Web3 orchestration, and engineering discipline for hiring purposes.

## 🎯 Core Concept

```
User Intent: "Swap 1 ETH on Ethereum → USDC on Base"
           ↓
User confirms ONCE via Telegram WebApp (ERC-4337 UserOperation)
           ↓
System executes: ETH → USDC (Ethereum) → Bridge → USDC (Base)
           ↓
User receives USDC on Base + execution report
```

**Key Principles:**
- **One confirmation per intent** (Account Abstraction)
- **No custody, no private keys** (Smart account architecture)
- **Backend-first** (API drives everything)
- **Explainable routing** (Net output, fees, ETA)
- **Reliability > speed** (State machines, retries, monitoring)

## 🏗️ Architecture Overview

### Backend-First Design
```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Telegram Bot    │    │ Fastify API      │    │ BullMQ Workers  │
│ + WebApp        │◄──►│ + Intent Engine  │◄──►│ + Execution     │
│ (User Interface)│    │ (Orchestration)  │    │ (Async Tasks)   │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                        │                        │
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│ Smart Accounts  │    │ PostgreSQL       │    │ Redis           │
│ (EVM chains)    │    │ (Source of Truth)│    │ (Queues + Cache)│
└─────────────────┘    └──────────────────┘    └─────────────────┘
```

### Intent Execution Flow
1. **Intent Creation**: User specifies cross-chain swap via Telegram
2. **Route Calculation**: System finds optimal path (DEX → Bridge → DEX)
3. **User Confirmation**: Single UserOperation signature via WebApp
4. **Async Execution**: BullMQ workers execute transactions sequentially
5. **Monitoring**: Real-time status updates + transaction tracking
6. **Notification**: Results delivered via Telegram

### Supported v1 Scope
- **Networks**: Ethereum, Base, Arbitrum
- **Tokens**: Whitelisted ERC20 only
- **DEX**: Uniswap v3
- **Bridge**: Across Protocol
- **Objective**: Maximize net output (price minus fees)

## 📁 Project Structure

```
OneTripleC/
├── src/                           # Backend application core
│   ├── api/                       # Fastify API layer
│   ├── domain/                    # Core business logic
│   │   ├── intents/              # Intent processing
│   │   ├── execution/            # Cross-chain execution
│   │   ├── routing/              # DEX/bridge routing
│   │   └── state/                # Intent state machine
│   ├── adapters/                  # External service integrations
│   │   ├── blockchain/           # EVM chain adapters
│   │   ├── dex/                  # DEX adapters (Uniswap v3)
│   │   ├── bridge/               # Bridge adapters (Across)
│   │   └── telegram/             # Telegram bot/WebApp
│   ├── workers/                   # BullMQ background workers
│   ├── persistence/               # Database and Redis
│   └── shared/                    # Shared utilities & types
├── contracts/                     # Smart contracts (minimal)
│   ├── src/                      # Account Abstraction contracts
│   ├── test/                     # Contract tests
│   └── script/                   # Deployment scripts
├── infrastructure/                # Docker & deployment
├── docs/                         # Technical documentation
└── tests/                        # End-to-end tests
```

## 🚀 Tech Stack

**Backend Infrastructure:**
- **Runtime**: Bun + Node.js + TypeScript
- **API**: Fastify (performance + plugins)
- **Database**: PostgreSQL (audit log + source of truth)
- **Queue**: Redis + BullMQ (async execution)
- **Blockchain**: Viem (EVM interactions)

**Smart Contracts:**
- **Account Abstraction**: ERC-4337 compatible smart accounts
- **Execution**: Minimal allowlisted executor contracts
- **Framework**: Foundry (Solidity dev environment)

**Architecture Patterns:**
- Intent-based state machines
- Asynchronous worker execution
- Repository pattern + domain-driven design
- Comprehensive error handling + retries

## ⚙️ Local Development

### Prerequisites
- [Bun](https://bun.sh/) (latest)
- [PostgreSQL](https://postgresql.org/) (local or Docker)
- [Redis](https://redis.io/) (local or Docker)
- [Foundry](https://getfoundry.sh/) (for contracts)

### Setup
```bash
# Clone and install
git clone <repository>
cd OneTripleC
bun install

# Environment configuration
cp .env.example .env
# Edit .env with your local database and RPC URLs

# Database setup
bun run db:generate
bun run db:migrate

# Run in development
bun run dev          # Start API server
bun run worker:start # Start background workers (separate terminal)

# Code quality
bun run typecheck    # TypeScript validation
bun run lint         # ESLint checks
bun run format       # Prettier formatting
```

### Contracts
```bash
# Solidity development
bun run contracts:build
bun run contracts:test
```

## 📋 What This Project Demonstrates

### Backend Engineering
- Production-grade API architecture
- Asynchronous job processing at scale
- Database design for financial applications
- Error handling + retry strategies
- Comprehensive logging + monitoring

### Web3 Orchestration
- Multi-chain transaction coordination
- Account Abstraction (ERC-4337) integration
- DEX + bridge routing optimization
- Real-time blockchain monitoring

### System Design
- Intent-based user experience
- State machine execution models
- Microservice communication patterns
- Scalable worker architecture

## 🚫 Explicit Non-Goals

**This project intentionally excludes:**
- Production DeFi protocol features
- Advanced trading strategies
- Token custody or wallet management
- User onboarding or KYC
- React dashboard/frontend (v1)
- Gasless transactions or paymasters
- Multi-sig or governance systems

## 🔒 Security Considerations

- **No private key custody** (users control smart accounts)
- **Allowlisted execution** (contracts restrict function calls)
- **Audit trails** (all actions logged in PostgreSQL)
- **Input validation** (Zod schemas throughout)
- **Rate limiting** (API protection)

## 📈 Future Extensions

**Potential v2 features (not implemented):**
- Additional chains (Polygon, Optimism)
- More DEX protocols (1inch, Paraswap)
- Advanced routing algorithms
- Real-time price feeds
- React admin dashboard
- Institutional features

---

**Author**: Portfolio demonstration project  
**Purpose**: Technical architecture showcase  
**Status**: Active development
