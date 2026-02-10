ALTER TABLE "wallets" DROP CONSTRAINT "wallets_user_id_unique";--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;