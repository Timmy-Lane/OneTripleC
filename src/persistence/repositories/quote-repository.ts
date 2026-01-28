import { eq } from 'drizzle-orm';
import { db } from '../db.js';
import { quotes } from '../models/schema.js';
import type { QuoteRoute } from '../../shared/types/quote.js';

export type QuoteRow = typeof quotes.$inferSelect;
export type NewQuote = typeof quotes.$inferInsert;

export async function createQuote(data: {
  intentId: string;
  route: QuoteRoute;
  estimatedOutput: string;
  totalFee: string;
  expiresAt: Date;
}): Promise<QuoteRow> {
  const [quote] = await db
    .insert(quotes)
    .values({
      intentId: data.intentId,
      route: data.route as any,
      estimatedOutput: data.estimatedOutput,
      totalFee: data.totalFee,
      expiresAt: data.expiresAt,
      isAccepted: false,
    })
    .returning();

  return quote;
}

export async function findQuotesByIntentId(intentId: string): Promise<QuoteRow[]> {
  return db.select().from(quotes).where(eq(quotes.intentId, intentId));
}

export async function findQuoteById(id: string): Promise<QuoteRow | null> {
  const [quote] = await db.select().from(quotes).where(eq(quotes.id, id));
  return quote ?? null;
}

export async function markQuoteAccepted(quoteId: string): Promise<QuoteRow | null> {
  const [updated] = await db
    .update(quotes)
    .set({ isAccepted: true })
    .where(eq(quotes.id, quoteId))
    .returning();

  return updated ?? null;
}
