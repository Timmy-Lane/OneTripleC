CREATE TYPE "public"."execution_state" AS ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."intent_state" AS ENUM('CREATED', 'PARSING', 'PARSED', 'QUOTE_REQUESTED', 'QUOTED', 'ACCEPTED', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."order_state" AS ENUM('PENDING', 'VALIDATED', 'ROUTING', 'EXECUTING', 'SETTLING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."step_state" AS ENUM('PENDING', 'BUILDING', 'BUILT', 'SUBMITTING', 'SUBMITTED', 'CONFIRMING', 'CONFIRMED', 'FAILED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."step_type" AS ENUM('SWAP', 'BRIDGE', 'TRANSFER', 'APPROVE');--> statement-breakpoint
CREATE TYPE "public"."tx_status" AS ENUM('PENDING', 'SUBMITTED', 'CONFIRMED', 'FAILED', 'DROPPED', 'REPLACED');--> statement-breakpoint
CREATE TABLE "balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"chain_id" integer NOT NULL,
	"token_address" varchar(255) NOT NULL,
	"balance" numeric(78, 0) NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_synced_block" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bridges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"protocol_type" varchar(50) NOT NULL,
	"supported_chains" integer[] NOT NULL,
	"contract_addresses" jsonb NOT NULL,
	"fee_bps" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bridges_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "chains" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"rpc_url" varchar(500) NOT NULL,
	"explorer_url" varchar(500),
	"native_token" varchar(50) NOT NULL,
	"is_testnet" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"block_time_seconds" integer DEFAULT 12 NOT NULL,
	"confirmation_blocks" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chains_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "dexes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"chain_id" integer NOT NULL,
	"protocol_type" varchar(50) NOT NULL,
	"router_address" varchar(255) NOT NULL,
	"factory_address" varchar(255),
	"fee_bps" integer DEFAULT 30 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"execution_id" uuid,
	"execution_step_id" uuid,
	"log_level" varchar(20) NOT NULL,
	"event_type" varchar(100) NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"step_type" "step_type" NOT NULL,
	"chain_id" integer NOT NULL,
	"protocol" varchar(100) NOT NULL,
	"from_token" varchar(255) NOT NULL,
	"to_token" varchar(255) NOT NULL,
	"from_amount" numeric(78, 0) NOT NULL,
	"to_amount" numeric(78, 0),
	"dex_address" varchar(255),
	"bridge_address" varchar(255),
	"tx_hash" varchar(255),
	"tx_state" "step_state" DEFAULT 'PENDING' NOT NULL,
	"gas_used" numeric(78, 0),
	"gas_price" numeric(78, 0),
	"error" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"state" "execution_state" DEFAULT 'PENDING' NOT NULL,
	"current_step_index" integer DEFAULT 0 NOT NULL,
	"total_steps" integer NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_reason" text
);
--> statement-breakpoint
CREATE TABLE "fee_breakdowns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"protocol_fee" numeric(78, 0) DEFAULT '0' NOT NULL,
	"protocol_fee_bps" integer NOT NULL,
	"gas_fee" numeric(78, 0) NOT NULL,
	"bridge_fee" numeric(78, 0) DEFAULT '0' NOT NULL,
	"dex_fee" numeric(78, 0) DEFAULT '0' NOT NULL,
	"total_fee" numeric(78, 0) NOT NULL,
	"fee_token" varchar(255) NOT NULL,
	"fee_token_usd_value" numeric(18, 6),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"raw_message" text NOT NULL,
	"source_chain_id" integer,
	"target_chain_id" integer,
	"source_token" varchar(255),
	"target_token" varchar(255),
	"source_amount" numeric(78, 0),
	"min_target_amount" numeric(78, 0),
	"slippage_bps" integer DEFAULT 50,
	"state" "intent_state" DEFAULT 'CREATED' NOT NULL,
	"parsing_confidence" numeric(5, 2),
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source_chain_id" integer NOT NULL,
	"target_chain_id" integer NOT NULL,
	"source_token" varchar(255) NOT NULL,
	"target_token" varchar(255) NOT NULL,
	"source_amount" numeric(78, 0) NOT NULL,
	"expected_output" numeric(78, 0) NOT NULL,
	"actual_output" numeric(78, 0),
	"state" "order_state" DEFAULT 'PENDING' NOT NULL,
	"failure_reason" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"estimated_output" numeric(78, 0) NOT NULL,
	"estimated_gas_cost" numeric(78, 0) NOT NULL,
	"protocol_fee" numeric(78, 0) DEFAULT '0' NOT NULL,
	"bridge_fee" numeric(78, 0) DEFAULT '0' NOT NULL,
	"total_fee" numeric(78, 0) NOT NULL,
	"route" jsonb NOT NULL,
	"route_hash" varchar(64),
	"provider" varchar(100),
	"provider_quote_id" varchar(255),
	"is_accepted" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "routes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_chain_id" integer NOT NULL,
	"target_chain_id" integer NOT NULL,
	"source_token" varchar(255) NOT NULL,
	"target_token" varchar(255) NOT NULL,
	"route_steps" jsonb NOT NULL,
	"estimated_time_seconds" integer,
	"confidence_score" numeric(5, 2),
	"usage_count" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"telegram_chat_id" bigint NOT NULL,
	"state" varchar(100) DEFAULT 'idle' NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"address" varchar(255) NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"name" varchar(255) NOT NULL,
	"decimals" integer NOT NULL,
	"is_native" boolean DEFAULT false NOT NULL,
	"logo_url" varchar(500),
	"coingecko_id" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_step_id" uuid,
	"order_id" uuid NOT NULL,
	"chain_id" integer NOT NULL,
	"tx_hash" varchar(255) NOT NULL,
	"block_number" bigint,
	"block_timestamp" timestamp with time zone,
	"from_address" varchar(255) NOT NULL,
	"to_address" varchar(255) NOT NULL,
	"value" numeric(78, 0) DEFAULT '0' NOT NULL,
	"gas_limit" numeric(78, 0),
	"gas_used" numeric(78, 0),
	"gas_price" numeric(78, 0),
	"max_fee_per_gas" numeric(78, 0),
	"max_priority_fee_per_gas" numeric(78, 0),
	"nonce" integer,
	"status" "tx_status" DEFAULT 'PENDING' NOT NULL,
	"confirmation_count" integer DEFAULT 0 NOT NULL,
	"required_confirmations" integer DEFAULT 1 NOT NULL,
	"input_data" text,
	"logs" jsonb,
	"error" text,
	"revert_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint NOT NULL,
	"telegram_username" varchar(255),
	"telegram_first_name" varchar(255),
	"telegram_last_name" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"preferences" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"chain_id" integer NOT NULL,
	"address" varchar(255) NOT NULL,
	"label" varchar(100),
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "balances" ADD CONSTRAINT "balances_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dexes" ADD CONSTRAINT "dexes_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_logs" ADD CONSTRAINT "execution_logs_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_logs" ADD CONSTRAINT "execution_logs_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_logs" ADD CONSTRAINT "execution_logs_execution_step_id_execution_steps_id_fk" FOREIGN KEY ("execution_step_id") REFERENCES "public"."execution_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_steps" ADD CONSTRAINT "execution_steps_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_steps" ADD CONSTRAINT "execution_steps_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_breakdowns" ADD CONSTRAINT "fee_breakdowns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intents" ADD CONSTRAINT "intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intents" ADD CONSTRAINT "intents_source_chain_id_chains_id_fk" FOREIGN KEY ("source_chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intents" ADD CONSTRAINT "intents_target_chain_id_chains_id_fk" FOREIGN KEY ("target_chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_source_chain_id_chains_id_fk" FOREIGN KEY ("source_chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_target_chain_id_chains_id_fk" FOREIGN KEY ("target_chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_source_chain_id_chains_id_fk" FOREIGN KEY ("source_chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routes" ADD CONSTRAINT "routes_target_chain_id_chains_id_fk" FOREIGN KEY ("target_chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_execution_step_id_execution_steps_id_fk" FOREIGN KEY ("execution_step_id") REFERENCES "public"."execution_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_balances_user_id" ON "balances" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_balances_last_synced" ON "balances" USING btree ("last_synced_at");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_user_chain_token" ON "balances" USING btree ("user_id","chain_id","token_address");--> statement-breakpoint
CREATE INDEX "idx_bridges_is_active" ON "bridges" USING btree ("is_active") WHERE "bridges"."is_active" = true;--> statement-breakpoint
CREATE INDEX "idx_chains_is_active" ON "chains" USING btree ("is_active") WHERE "chains"."is_active" = true;--> statement-breakpoint
CREATE INDEX "idx_dexes_chain_id" ON "dexes" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "idx_dexes_is_active" ON "dexes" USING btree ("is_active") WHERE "dexes"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_chain_dex_router" ON "dexes" USING btree ("chain_id","router_address");--> statement-breakpoint
CREATE INDEX "idx_execution_logs_order_id" ON "execution_logs" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_execution_logs_created_at" ON "execution_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_execution_logs_log_level" ON "execution_logs" USING btree ("log_level");--> statement-breakpoint
CREATE INDEX "idx_execution_steps_execution_id" ON "execution_steps" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "idx_execution_steps_tx_hash" ON "execution_steps" USING btree ("tx_hash") WHERE "execution_steps"."tx_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_execution_steps_state" ON "execution_steps" USING btree ("tx_state");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_execution_step" ON "execution_steps" USING btree ("execution_id","step_index");--> statement-breakpoint
CREATE INDEX "idx_executions_order_id" ON "executions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_executions_state" ON "executions" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_order_execution" ON "executions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_fee_breakdowns_order_id" ON "fee_breakdowns" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_order_fee" ON "fee_breakdowns" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_intents_user_id" ON "intents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_intents_state" ON "intents" USING btree ("state");--> statement-breakpoint
CREATE INDEX "idx_intents_created_at" ON "intents" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_intents_expires_at" ON "intents" USING btree ("expires_at") WHERE "intents"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_orders_user_id" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_orders_state" ON "orders" USING btree ("state");--> statement-breakpoint
CREATE INDEX "idx_orders_created_at" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_orders_quote_id" ON "orders" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_intent_order" ON "orders" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "idx_quotes_intent_id" ON "quotes" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "idx_quotes_expires_at" ON "quotes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_quotes_is_accepted" ON "quotes" USING btree ("is_accepted");--> statement-breakpoint
CREATE INDEX "idx_quotes_route_hash" ON "quotes" USING btree ("route_hash") WHERE "quotes"."route_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_routes_source_target" ON "routes" USING btree ("source_chain_id","target_chain_id");--> statement-breakpoint
CREATE INDEX "idx_routes_is_active" ON "routes" USING btree ("is_active") WHERE "routes"."is_active" = true;--> statement-breakpoint
CREATE INDEX "idx_sessions_user_id" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_telegram_chat_id" ON "sessions" USING btree ("telegram_chat_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires_at" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_tokens_chain_id" ON "tokens" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "idx_tokens_symbol" ON "tokens" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_tokens_is_active" ON "tokens" USING btree ("is_active") WHERE "tokens"."is_active" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_chain_token_address" ON "tokens" USING btree ("chain_id","address");--> statement-breakpoint
CREATE INDEX "idx_transactions_order_id" ON "transactions" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "idx_transactions_tx_hash" ON "transactions" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "idx_transactions_status" ON "transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_transactions_from_address" ON "transactions" USING btree ("from_address");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_chain_tx_hash" ON "transactions" USING btree ("chain_id","tx_hash");--> statement-breakpoint
CREATE INDEX "idx_users_telegram_id" ON "users" USING btree ("telegram_id");--> statement-breakpoint
CREATE INDEX "idx_users_is_active" ON "users" USING btree ("is_active") WHERE "users"."is_active" = true;--> statement-breakpoint
CREATE INDEX "idx_wallets_user_id" ON "wallets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_wallets_address" ON "wallets" USING btree ("address");--> statement-breakpoint
CREATE INDEX "idx_wallets_chain_id" ON "wallets" USING btree ("chain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_user_chain_address" ON "wallets" USING btree ("user_id","chain_id","address");