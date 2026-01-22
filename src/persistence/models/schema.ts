import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  bigint,
  boolean,
  timestamp,
  text,
  integer,
  jsonb,
  decimal,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

//enums
export const intentStateEnum = pgEnum('intent_state', [
  'CREATED',
  'PARSING',
  'PARSED',
  'QUOTE_REQUESTED',
  'QUOTED',
  'ACCEPTED',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
]);

export const orderStateEnum = pgEnum('order_state', [
  'PENDING',
  'VALIDATED',
  'ROUTING',
  'EXECUTING',
  'SETTLING',
  'COMPLETED',
  'FAILED',
  'REFUNDED',
  'CANCELLED',
]);

export const executionStateEnum = pgEnum('execution_state', [
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
]);

export const stepTypeEnum = pgEnum('step_type', [
  'SWAP',
  'BRIDGE',
  'TRANSFER',
  'APPROVE',
]);

export const stepStateEnum = pgEnum('step_state', [
  'PENDING',
  'BUILDING',
  'BUILT',
  'SUBMITTING',
  'SUBMITTED',
  'CONFIRMING',
  'CONFIRMED',
  'FAILED',
  'SKIPPED',
]);

export const txStatusEnum = pgEnum('tx_status', [
  'PENDING',
  'SUBMITTED',
  'CONFIRMED',
  'FAILED',
  'DROPPED',
  'REPLACED',
]);

//core
export const chains = pgTable(
  'chains',
  {
    id: integer('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull().unique(),
    rpcUrl: varchar('rpc_url', { length: 500 }).notNull(),
    explorerUrl: varchar('explorer_url', { length: 500 }),
    nativeToken: varchar('native_token', { length: 50 }).notNull(),
    isTestnet: boolean('is_testnet').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    blockTimeSeconds: integer('block_time_seconds').notNull().default(12),
    confirmationBlocks: integer('confirmation_blocks').notNull().default(1),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({
    isActiveIdx: index('idx_chains_is_active')
      .on(table.isActive)
      .where(sql`${table.isActive} = true`),
  })
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
    telegramUsername: varchar('telegram_username', { length: 255 }),
    telegramFirstName: varchar('telegram_first_name', { length: 255 }),
    telegramLastName: varchar('telegram_last_name', { length: 255 }),
    isActive: boolean('is_active').notNull().default(true),
    isBlocked: boolean('is_blocked').notNull().default(false),
    preferences: jsonb('preferences').default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({
    telegramIdIdx: index('idx_users_telegram_id').on(table.telegramId),
    isActiveIdx: index('idx_users_is_active')
      .on(table.isActive)
      .where(sql`${table.isActive} = true`),
  })
);

export const wallets = pgTable(
  'wallets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chainId: integer('chain_id')
      .notNull()
      .references(() => chains.id),
    address: varchar('address', { length: 255 }).notNull(),
    label: varchar('label', { length: 100 }),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({
    userIdIdx: index('idx_wallets_user_id').on(table.userId),
    addressIdx: index('idx_wallets_address').on(table.address),
    chainIdIdx: index('idx_wallets_chain_id').on(table.chainId),
    uniqueUserChainAddress: uniqueIndex('unique_user_chain_address').on(
      table.userId,
      table.chainId,
      table.address
    ),
  })
);

export const tokens = pgTable(
  'tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    chainId: integer('chain_id')
      .notNull()
      .references(() => chains.id),
    address: varchar('address', { length: 255 }).notNull(),
    symbol: varchar('symbol', { length: 50 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    decimals: integer('decimals').notNull(),
    isNative: boolean('is_native').notNull().default(false),
    logoUrl: varchar('logo_url', { length: 500 }),
    coingeckoId: varchar('coingecko_id', { length: 100 }),
    isActive: boolean('is_active').notNull().default(true),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({
    chainIdIdx: index('idx_tokens_chain_id').on(table.chainId),
    symbolIdx: index('idx_tokens_symbol').on(table.symbol),
    isActiveIdx: index('idx_tokens_is_active')
      .on(table.isActive)
      .where(sql`${table.isActive} = true`),
    uniqueChainTokenAddress: uniqueIndex('unique_chain_token_address').on(
      table.chainId,
      table.address
    ),
  })
);

//intent quote
export const intents = pgTable(
  'intents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    rawMessage: text('raw_message').notNull(),
    sourceChainId: integer('source_chain_id').references(() => chains.id),
    targetChainId: integer('target_chain_id').references(() => chains.id),
    sourceToken: varchar('source_token', { length: 255 }),
    targetToken: varchar('target_token', { length: 255 }),
    sourceAmount: decimal('source_amount', { precision: 78, scale: 0 }),
    minTargetAmount: decimal('min_target_amount', { precision: 78, scale: 0 }),
    slippageBps: integer('slippage_bps').default(50),
    state: intentStateEnum('state').notNull().default('CREATED'),
    parsingConfidence: decimal('parsing_confidence', {
      precision: 5,
      scale: 2,
    }),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  table => ({
    userIdIdx: index('idx_intents_user_id').on(table.userId),
    stateIdx: index('idx_intents_state').on(table.state),
    createdAtIdx: index('idx_intents_created_at').on(table.createdAt),
    expiresAtIdx: index('idx_intents_expires_at')
      .on(table.expiresAt)
      .where(sql`${table.expiresAt} IS NOT NULL`),
  })
);

export const quotes = pgTable(
  'quotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => intents.id, { onDelete: 'cascade' }),
    estimatedOutput: decimal('estimated_output', {
      precision: 78,
      scale: 0,
    }).notNull(),
    estimatedGasCost: decimal('estimated_gas_cost', {
      precision: 78,
      scale: 0,
    }).notNull(),
    protocolFee: decimal('protocol_fee', { precision: 78, scale: 0 })
      .notNull()
      .default('0'),
    bridgeFee: decimal('bridge_fee', { precision: 78, scale: 0 })
      .notNull()
      .default('0'),
    totalFee: decimal('total_fee', { precision: 78, scale: 0 }).notNull(),
    route: jsonb('route').notNull(),
    routeHash: varchar('route_hash', { length: 64 }),
    provider: varchar('provider', { length: 100 }),
    providerQuoteId: varchar('provider_quote_id', { length: 255 }),
    isAccepted: boolean('is_accepted').notNull().default(false),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({
    intentIdIdx: index('idx_quotes_intent_id').on(table.intentId),
    expiresAtIdx: index('idx_quotes_expires_at').on(table.expiresAt),
    isAcceptedIdx: index('idx_quotes_is_accepted').on(table.isAccepted),
    routeHashIdx: index('idx_quotes_route_hash')
      .on(table.routeHash)
      .where(sql`${table.routeHash} IS NOT NULL`),
  })
);

//order execs
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => intents.id),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    sourceChainId: integer('source_chain_id')
      .notNull()
      .references(() => chains.id),
    targetChainId: integer('target_chain_id')
      .notNull()
      .references(() => chains.id),
    sourceToken: varchar('source_token', { length: 255 }).notNull(),
    targetToken: varchar('target_token', { length: 255 }).notNull(),
    sourceAmount: decimal('source_amount', {
      precision: 78,
      scale: 0,
    }).notNull(),
    expectedOutput: decimal('expected_output', {
      precision: 78,
      scale: 0,
    }).notNull(),
    actualOutput: decimal('actual_output', { precision: 78, scale: 0 }),
    state: orderStateEnum('state').notNull().default('PENDING'),
    failureReason: text('failure_reason'),
    retryCount: integer('retry_count').notNull().default(0),
    maxRetries: integer('max_retries').notNull().default(3),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  table => ({
    userIdIdx: index('idx_orders_user_id').on(table.userId),
    stateIdx: index('idx_orders_state').on(table.state),
    createdAtIdx: index('idx_orders_created_at').on(table.createdAt),
    quoteIdIdx: index('idx_orders_quote_id').on(table.quoteId),
    uniqueIntentOrder: uniqueIndex('unique_intent_order').on(table.intentId),
  })
);

export const executions = pgTable(
  'executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    state: executionStateEnum('state').notNull().default('PENDING'),
    currentStepIndex: integer('current_step_index').notNull().default(0),
    totalSteps: integer('total_steps').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
  },
  table => ({
    orderIdIdx: index('idx_executions_order_id').on(table.orderId),
    stateIdx: index('idx_executions_state').on(table.state),
    uniqueOrderExecution: uniqueIndex('unique_order_execution').on(
      table.orderId
    ),
  })
);

export const executionSteps = pgTable(
  'execution_steps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    executionId: uuid('execution_id')
      .notNull()
      .references(() => executions.id, { onDelete: 'cascade' }),
    stepIndex: integer('step_index').notNull(),
    stepType: stepTypeEnum('step_type').notNull(),
    chainId: integer('chain_id')
      .notNull()
      .references(() => chains.id),
    protocol: varchar('protocol', { length: 100 }).notNull(),
    fromToken: varchar('from_token', { length: 255 }).notNull(),
    toToken: varchar('to_token', { length: 255 }).notNull(),
    fromAmount: decimal('from_amount', { precision: 78, scale: 0 }).notNull(),
    toAmount: decimal('to_amount', { precision: 78, scale: 0 }),
    dexAddress: varchar('dex_address', { length: 255 }),
    bridgeAddress: varchar('bridge_address', { length: 255 }),
    txHash: varchar('tx_hash', { length: 255 }),
    txState: stepStateEnum('tx_state').notNull().default('PENDING'),
    gasUsed: decimal('gas_used', { precision: 78, scale: 0 }),
    gasPrice: decimal('gas_price', { precision: 78, scale: 0 }),
    error: text('error'),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  table => ({
    executionIdIdx: index('idx_execution_steps_execution_id').on(
      table.executionId
    ),
    txHashIdx: index('idx_execution_steps_tx_hash')
      .on(table.txHash)
      .where(sql`${table.txHash} IS NOT NULL`),
    stateIdx: index('idx_execution_steps_state').on(table.txState),
    uniqueExecutionStep: uniqueIndex('unique_execution_step').on(
      table.executionId,
      table.stepIndex
    ),
  })
);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    executionStepId: uuid('execution_step_id').references(
      () => executionSteps.id
    ),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    chainId: integer('chain_id')
      .notNull()
      .references(() => chains.id),
    txHash: varchar('tx_hash', { length: 255 }).notNull(),
    blockNumber: bigint('block_number', { mode: 'number' }),
    blockTimestamp: timestamp('block_timestamp', { withTimezone: true }),
    fromAddress: varchar('from_address', { length: 255 }).notNull(),
    toAddress: varchar('to_address', { length: 255 }).notNull(),
    value: decimal('value', { precision: 78, scale: 0 }).notNull().default('0'),
    gasLimit: decimal('gas_limit', { precision: 78, scale: 0 }),
    gasUsed: decimal('gas_used', { precision: 78, scale: 0 }),
    gasPrice: decimal('gas_price', { precision: 78, scale: 0 }),
    maxFeePerGas: decimal('max_fee_per_gas', { precision: 78, scale: 0 }),
    maxPriorityFeePerGas: decimal('max_priority_fee_per_gas', {
      precision: 78,
      scale: 0,
    }),
    nonce: integer('nonce'),
    status: txStatusEnum('status').notNull().default('PENDING'),
    confirmationCount: integer('confirmation_count').notNull().default(0),
    requiredConfirmations: integer('required_confirmations')
      .notNull()
      .default(1),
    inputData: text('input_data'),
    logs: jsonb('logs'),
    error: text('error'),
    revertReason: text('revert_reason'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  },
  table => ({
    orderIdIdx: index('idx_transactions_order_id').on(table.orderId),
    txHashIdx: index('idx_transactions_tx_hash').on(table.txHash),
    statusIdx: index('idx_transactions_status').on(table.status),
    fromAddressIdx: index('idx_transactions_from_address').on(
      table.fromAddress
    ),
    uniqueChainTxHash: uniqueIndex('unique_chain_tx_hash').on(
      table.chainId,
      table.txHash
    ),
  })
);

//operational
export const executionLogs = pgTable(
  'execution_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    executionId: uuid('execution_id').references(() => executions.id),
    executionStepId: uuid('execution_step_id').references(
      () => executionSteps.id
    ),
    logLevel: varchar('log_level', { length: 20 }).notNull(),
    eventType: varchar('event_type', { length: 100 }).notNull(),
    message: text('message').notNull(),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({
    orderIdIdx: index('idx_execution_logs_order_id').on(table.orderId),
    createdAtIdx: index('idx_execution_logs_created_at').on(table.createdAt),
    logLevelIdx: index('idx_execution_logs_log_level').on(table.logLevel),
  })
);

export const feeBreakdowns = pgTable(
  'fee_breakdowns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    protocolFee: decimal('protocol_fee', { precision: 78, scale: 0 })
      .notNull()
      .default('0'),
    protocolFeeBps: integer('protocol_fee_bps').notNull(),
    gasFee: decimal('gas_fee', { precision: 78, scale: 0 }).notNull(),
    bridgeFee: decimal('bridge_fee', { precision: 78, scale: 0 })
      .notNull()
      .default('0'),
    dexFee: decimal('dex_fee', { precision: 78, scale: 0 })
      .notNull()
      .default('0'),
    totalFee: decimal('total_fee', { precision: 78, scale: 0 }).notNull(),
    feeToken: varchar('fee_token', { length: 255 }).notNull(),
    feeTokenUsdValue: decimal('fee_token_usd_value', {
      precision: 18,
      scale: 6,
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({
    orderIdIdx: index('idx_fee_breakdowns_order_id').on(table.orderId),
    uniqueOrderFee: uniqueIndex('unique_order_fee').on(table.orderId),
  })
);

export const balances = pgTable(
  'balances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chainId: integer('chain_id')
      .notNull()
      .references(() => chains.id),
    tokenAddress: varchar('token_address', { length: 255 }).notNull(),
    balance: decimal('balance', { precision: 78, scale: 0 }).notNull(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSyncedBlock: bigint('last_synced_block', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({
    userIdIdx: index('idx_balances_user_id').on(table.userId),
    lastSyncedIdx: index('idx_balances_last_synced').on(table.lastSyncedAt),
    uniqueUserChainToken: uniqueIndex('unique_user_chain_token').on(
      table.userId,
      table.chainId,
      table.tokenAddress
    ),
  })
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    telegramChatId: bigint('telegram_chat_id', { mode: 'number' }).notNull(),
    state: varchar('state', { length: 100 }).notNull().default('idle'),
    context: jsonb('context').default({}),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({
    userIdIdx: index('idx_sessions_user_id').on(table.userId),
    telegramChatIdIdx: index('idx_sessions_telegram_chat_id').on(
      table.telegramChatId
    ),
    expiresAtIdx: index('idx_sessions_expires_at').on(table.expiresAt),
  })
);

export const bridges = pgTable(
  'bridges',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull().unique(),
    protocolType: varchar('protocol_type', { length: 50 }).notNull(),
    supportedChains: integer('supported_chains').array().notNull(),
    contractAddresses: jsonb('contract_addresses').notNull(),
    feeBps: integer('fee_bps').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({
    isActiveIdx: index('idx_bridges_is_active')
      .on(table.isActive)
      .where(sql`${table.isActive} = true`),
  })
);

export const dexes = pgTable(
  'dexes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 100 }).notNull(),
    chainId: integer('chain_id')
      .notNull()
      .references(() => chains.id),
    protocolType: varchar('protocol_type', { length: 50 }).notNull(),
    routerAddress: varchar('router_address', { length: 255 }).notNull(),
    factoryAddress: varchar('factory_address', { length: 255 }),
    feeBps: integer('fee_bps').notNull().default(30),
    isActive: boolean('is_active').notNull().default(true),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({
    chainIdIdx: index('idx_dexes_chain_id').on(table.chainId),
    isActiveIdx: index('idx_dexes_is_active')
      .on(table.isActive)
      .where(sql`${table.isActive} = true`),
    uniqueChainDexRouter: uniqueIndex('unique_chain_dex_router').on(
      table.chainId,
      table.routerAddress
    ),
  })
);

export const routes = pgTable(
  'routes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sourceChainId: integer('source_chain_id')
      .notNull()
      .references(() => chains.id),
    targetChainId: integer('target_chain_id')
      .notNull()
      .references(() => chains.id),
    sourceToken: varchar('source_token', { length: 255 }).notNull(),
    targetToken: varchar('target_token', { length: 255 }).notNull(),
    routeSteps: jsonb('route_steps').notNull(),
    estimatedTimeSeconds: integer('estimated_time_seconds'),
    confidenceScore: decimal('confidence_score', { precision: 5, scale: 2 }),
    usageCount: integer('usage_count').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({
    sourceTargetIdx: index('idx_routes_source_target').on(
      table.sourceChainId,
      table.targetChainId
    ),
    isActiveIdx: index('idx_routes_is_active')
      .on(table.isActive)
      .where(sql`${table.isActive} = true`),
  })
);
