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

export const intentStateEnum = pgEnum('intent_state', [
  'CREATED',
  'PARSING',
  'PARSED',
  'QUOTED',
  'ACCEPTED',
  'EXECUTING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

export const executionStateEnum = pgEnum('execution_state', [
  'PENDING',
  'SUBMITTED',
  'CONFIRMING',
  'CONFIRMED',
  'FAILED',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
    telegramUsername: varchar('telegram_username', { length: 255 }),
    telegramFirstName: varchar('telegram_first_name', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({
    telegramIdIdx: index('idx_users_telegram_id').on(table.telegramId),
  })
);

export const chains = pgTable(
  'chains',
  {
    id: integer('id').primaryKey(),
    name: varchar('name', { length: 100 }).notNull().unique(),
    rpcUrl: varchar('rpc_url', { length: 500 }).notNull(),
    explorerUrl: varchar('explorer_url', { length: 500 }),
    nativeToken: varchar('native_token', { length: 50 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    blockTimeSeconds: integer('block_time_seconds').notNull().default(12),
    confirmationBlocks: integer('confirmation_blocks').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({
    isActiveIdx: index('idx_chains_is_active').on(table.isActive),
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
    decimals: integer('decimals').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({
    chainIdIdx: index('idx_tokens_chain_id').on(table.chainId),
    symbolIdx: index('idx_tokens_symbol').on(table.symbol),
    uniqueChainTokenAddress: uniqueIndex('unique_chain_token_address').on(
      table.chainId,
      table.address
    ),
  })
);

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
    state: intentStateEnum('state').notNull().default('CREATED'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({
    userIdIdx: index('idx_intents_user_id').on(table.userId),
    stateIdx: index('idx_intents_state').on(table.state),
    createdAtIdx: index('idx_intents_created_at').on(table.createdAt),
  })
);

export const quotes = pgTable(
  'quotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => intents.id, { onDelete: 'cascade' }),
    route: jsonb('route').notNull(),
    estimatedOutput: decimal('estimated_output', {
      precision: 78,
      scale: 0,
    }).notNull(),
    totalFee: decimal('total_fee', { precision: 78, scale: 0 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    isAccepted: boolean('is_accepted').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({
    intentIdIdx: index('idx_quotes_intent_id').on(table.intentId),
    expiresAtIdx: index('idx_quotes_expires_at').on(table.expiresAt),
    isAcceptedIdx: index('idx_quotes_is_accepted').on(table.isAccepted),
  })
);

export const executions = pgTable(
  'executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    intentId: uuid('intent_id')
      .notNull()
      .references(() => intents.id),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id),
    userAddress: varchar('user_address', { length: 255 }).notNull(),
    txHash: varchar('tx_hash', { length: 255 }),
    chainId: integer('chain_id')
      .notNull()
      .references(() => chains.id),
    state: executionStateEnum('state').notNull().default('PENDING'),
    errorMessage: text('error_message'),
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
    intentIdIdx: index('idx_executions_intent_id').on(table.intentId),
    txHashIdx: index('idx_executions_tx_hash').on(table.txHash),
    stateIdx: index('idx_executions_state').on(table.state),
    createdAtIdx: index('idx_executions_created_at').on(table.createdAt),
    uniqueIntentExecution: uniqueIndex('unique_intent_execution').on(
      table.intentId
    ),
  })
);
