CREATE TYPE "public"."execution_state" AS ENUM('PENDING', 'SUBMITTED', 'CONFIRMING', 'CONFIRMED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."intent_state" AS ENUM('CREATED', 'PARSING', 'PARSED', 'QUOTED', 'ACCEPTED', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "chains" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"rpc_url" varchar(500) NOT NULL,
	"explorer_url" varchar(500),
	"native_token" varchar(50) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"block_time_seconds" integer DEFAULT 12 NOT NULL,
	"confirmation_blocks" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chains_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"user_address" varchar(255) NOT NULL,
	"tx_hash" varchar(255),
	"chain_id" integer NOT NULL,
	"state" "execution_state" DEFAULT 'PENDING' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone
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
	"state" "intent_state" DEFAULT 'CREATED' NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"intent_id" uuid NOT NULL,
	"route" jsonb NOT NULL,
	"estimated_output" numeric(78, 0) NOT NULL,
	"total_fee" numeric(78, 0) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"is_accepted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" integer NOT NULL,
	"address" varchar(255) NOT NULL,
	"symbol" varchar(50) NOT NULL,
	"decimals" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telegram_id" bigint NOT NULL,
	"telegram_username" varchar(255),
	"telegram_first_name" varchar(255),
	"auth_provider" varchar(50) DEFAULT 'telegram' NOT NULL,
	"auth_provider_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_telegram_id_unique" UNIQUE("telegram_id")
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"address" varchar(255) NOT NULL,
	"encrypted_private_key" text NOT NULL,
	"encryption_key_id" varchar(255) DEFAULT 'master-key-v1' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "wallets_address_unique" UNIQUE("address")
);
--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "executions" ADD CONSTRAINT "executions_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intents" ADD CONSTRAINT "intents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intents" ADD CONSTRAINT "intents_source_chain_id_chains_id_fk" FOREIGN KEY ("source_chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intents" ADD CONSTRAINT "intents_target_chain_id_chains_id_fk" FOREIGN KEY ("target_chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_intent_id_intents_id_fk" FOREIGN KEY ("intent_id") REFERENCES "public"."intents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tokens" ADD CONSTRAINT "tokens_chain_id_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_chains_is_active" ON "chains" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_executions_intent_id" ON "executions" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "idx_executions_user_id" ON "executions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_executions_tx_hash" ON "executions" USING btree ("tx_hash");--> statement-breakpoint
CREATE INDEX "idx_executions_state" ON "executions" USING btree ("state");--> statement-breakpoint
CREATE INDEX "idx_executions_created_at" ON "executions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_intent_execution" ON "executions" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "idx_intents_user_id" ON "intents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_intents_state" ON "intents" USING btree ("state");--> statement-breakpoint
CREATE INDEX "idx_intents_created_at" ON "intents" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_quotes_intent_id" ON "quotes" USING btree ("intent_id");--> statement-breakpoint
CREATE INDEX "idx_quotes_expires_at" ON "quotes" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_quotes_is_accepted" ON "quotes" USING btree ("is_accepted");--> statement-breakpoint
CREATE INDEX "idx_tokens_chain_id" ON "tokens" USING btree ("chain_id");--> statement-breakpoint
CREATE INDEX "idx_tokens_symbol" ON "tokens" USING btree ("symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_chain_token_address" ON "tokens" USING btree ("chain_id","address");--> statement-breakpoint
CREATE INDEX "idx_users_telegram_id" ON "users" USING btree ("telegram_id");--> statement-breakpoint
CREATE INDEX "idx_users_auth_provider" ON "users" USING btree ("auth_provider","auth_provider_id");--> statement-breakpoint
CREATE INDEX "idx_wallets_user_id" ON "wallets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_wallets_address" ON "wallets" USING btree ("address");