# Claude Code Guide for OneTripleC

> **Guide for AI agents and future contributors working on OneTripleC**

This document explains how to reason about the OneTripleC codebase, architectural rules, and safe extension patterns. Follow these guidelines when making changes.

## 🏗️ Architectural Principles

### 1. Backend-First Philosophy
- **Rule**: API and workers drive all functionality. No business logic in frontend.
- **Rationale**: Ensures system can be operated programmatically and scales independently.
- **Example**: Intent creation happens via API endpoint, not direct database access.

### 2. Domain-Driven Design
- **Rule**: Core business logic lives in `src/domain/` and is adapter-agnostic.
- **Structure**:
  ```
  src/domain/intents/     # Intent lifecycle management
  src/domain/execution/   # Cross-chain execution logic
  src/domain/routing/     # Route calculation algorithms
  src/domain/state/       # State machine definitions
  ```
- **Example**: `IntentService` handles intent creation without knowing about Fastify or Redis.

### 3. Dependency Direction
- **Rule**: Dependencies flow inward. Domain logic never depends on adapters.
- **Pattern**:
  ```
  API Layer ──> Domain Layer ──> Persistence Layer
      │              │                 │
  Adapters ──────────┘          Infrastructure
  ```

### 4. Async-First Execution
- **Rule**: All blockchain operations must be asynchronous via BullMQ workers.
- **Rationale**: Blockchain transactions are slow and can fail. Never block API responses.
- **Pattern**: API accepts intent → Queue worker job → Update status asynchronously

## 📁 Code Organization Rules

### 1. File Placement Guidelines

#### When to create files in `src/api/`
- HTTP route handlers
- Request/response schemas
- Middleware functions
- Server configuration

#### When to create files in `src/domain/`
- Core business logic
- State machines
- Validation rules
- Algorithm implementations

#### When to create files in `src/adapters/`
- External service integrations
- Protocol-specific implementations
- Chain-specific logic
- Third-party API wrappers

#### When to create files in `src/workers/`
- Background job processors
- Async task execution
- Long-running operations
- Event handlers

### 2. Naming Conventions
- **Services**: `intent-service.ts`, `routing-service.ts`
- **Adapters**: `uniswap-adapter.ts`, `ethereum-client.ts`
- **Workers**: `execution-worker.ts`, `monitoring-worker.ts`
- **Types**: `intent.types.ts`, `blockchain.types.ts`

## 🔗 Adding New Chains

### Step 1: Configuration
1. Add chain config to `src/shared/config/index.ts`:
   ```typescript
   POLYGON_RPC_URL: z.string(),
   POLYGON_SMART_ACCOUNT_FACTORY: z.string().optional(),
   ```

2. Update chain enum in `src/shared/types/index.ts`:
   ```typescript
   export const ChainSchema = z.enum(['ethereum', 'base', 'arbitrum', 'polygon']);
   ```

### Step 2: Blockchain Adapter
1. Create `src/adapters/blockchain/polygon-client.ts`
2. Implement `ChainClient` interface
3. Add to adapter factory in `src/adapters/blockchain/index.ts`

### Step 3: Update Workers
1. Modify execution workers to handle new chain
2. Add monitoring for new chain's transactions
3. Update notification messages

### ⚠️ Safety Checks
- Always test on testnets first
- Verify contract addresses before deployment
- Add comprehensive error handling for new chains

## 🔀 Adding New DEX Protocols

### Step 1: DEX Adapter Interface
1. Implement base `DexAdapter` interface:
   ```typescript
   interface DexAdapter {
     getQuote(params: QuoteParams): Promise<Quote>;
     buildSwapTx(params: SwapParams): Promise<Transaction>;
     validateSwap(tx: Transaction): Promise<boolean>;
   }
   ```

### Step 2: Protocol Implementation
1. Create `src/adapters/dex/[protocol]-adapter.ts`
2. Handle protocol-specific logic (AMM math, fee structures)
3. Add to DEX factory

### Step 3: Routing Integration
1. Update `src/domain/routing/route-calculator.ts`
2. Add protocol to route comparison logic
3. Consider liquidity and gas costs

### ⚠️ Safety Checks
- Validate all swap parameters
- Implement slippage protection
- Test with small amounts first

## 🌉 Adding New Bridge Protocols

### Step 1: Bridge Adapter
1. Implement `BridgeAdapter` interface:
   ```typescript
   interface BridgeAdapter {
     getSupportedRoutes(): ChainPair[];
     estimateFee(route: BridgeRoute): Promise<BridgeFee>;
     initiateBridge(params: BridgeParams): Promise<Transaction>;
     trackBridge(txHash: string): Promise<BridgeStatus>;
   }
   ```

### Step 2: Integration
1. Create adapter in `src/adapters/bridge/`
2. Add to routing calculations
3. Implement bridge monitoring

### ⚠️ Safety Checks
- Verify bridge contract security
- Test with small amounts
- Implement timeout handling

## 🛠️ Extending Execution Logic

### Core Execution Pattern
```typescript
// 1. Validate intent
const validated = await validateIntent(intent);

// 2. Calculate route
const route = await calculateOptimalRoute(validated);

// 3. Execute via workers
await queueExecution(intent.id, route);

// 4. Monitor & update
await startMonitoring(intent.id);
```

### Adding New Execution Steps
1. Define step in `src/domain/execution/steps/`
2. Add to execution state machine
3. Implement worker handler
4. Add monitoring and error recovery

### State Machine Extensions
- Keep states simple and atomic
- Always handle failure transitions
- Log all state changes for debugging

## 🧪 Testing Guidelines

### Unit Tests
- Test domain logic independently of adapters
- Mock external dependencies
- Focus on business rules and edge cases

### Integration Tests
- Test adapter implementations with testnet contracts
- Verify error handling and retries
- Test end-to-end execution flows

### Performance Tests
- Measure worker throughput
- Test database query performance
- Monitor memory usage under load

## 🚨 Error Handling Patterns

### 1. Graceful Degradation
```typescript
try {
  const route = await primaryRouter.calculate(intent);
} catch (error) {
  const fallbackRoute = await fallbackRouter.calculate(intent);
  logger.warn('Primary router failed, using fallback', { error });
}
```

### 2. Retry Logic
```typescript
const result = await withRetry(
  () => blockchain.sendTransaction(tx),
  { 
    attempts: 3, 
    backoff: 'exponential',
    shouldRetry: (error) => error.code === 'NETWORK_ERROR'
  }
);
```

### 3. Circuit Breakers
- Implement for external service calls
- Fail fast when services are down
- Provide degraded functionality when possible

## 📊 Monitoring & Observability

### Required Logging
- All intent state changes
- Worker job start/completion/failure
- External API calls and responses
- Transaction hashes and confirmations

### Metrics to Track
- Intent completion rate
- Average execution time
- Worker queue depth
- Error rates by type

### Alerting Triggers
- Worker failures exceeding threshold
- Intent stuck in pending state
- Blockchain connection failures
- Database performance degradation

## 🔒 Security Guidelines

### Input Validation
- Use Zod schemas for all API inputs
- Validate blockchain addresses and amounts
- Sanitize user-provided data

### Access Control
- Implement proper authentication for admin endpoints
- Rate limit user requests
- Validate intent ownership

### Smart Contract Safety
- Use minimal proxy patterns
- Implement proper access controls
- Audit all contract interactions

## 🔄 Development Workflow

### Making Changes
1. Create feature branch from main
2. Implement changes following architectural rules
3. Add tests for new functionality
4. Run full test suite and linting
5. Update documentation if needed

### Code Review Checklist
- [ ] Follows architectural principles
- [ ] Proper error handling
- [ ] Comprehensive tests
- [ ] No security vulnerabilities
- [ ] Performance considerations addressed

---

**Remember**: OneTripleC prioritizes reliability over speed. When in doubt, choose the safer, more observable approach.