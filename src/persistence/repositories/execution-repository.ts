import { eq } from 'drizzle-orm';
import { db } from '../db.js';
import { executions } from '../models/schema.js';
import { ExecutionState } from '../../shared/types/index.js';

export type ExecutionRow = typeof executions.$inferSelect;
export type NewExecution = typeof executions.$inferInsert;

export async function createExecution(data: {
  intentId: string;
  quoteId: string;
  userId: string;
  userAddress: string;
  chainId: number;
}): Promise<ExecutionRow> {
  const [execution] = await db
    .insert(executions)
    .values({
      intentId: data.intentId,
      quoteId: data.quoteId,
      userId: data.userId,
      userAddress: data.userAddress,
      chainId: data.chainId,
      state: 'PENDING',
    })
    .returning();

  return execution;
}

export async function findExecutionById(id: string): Promise<ExecutionRow | null> {
  const [execution] = await db.select().from(executions).where(eq(executions.id, id));
  return execution ?? null;
}

export async function findExecutionByIntentId(intentId: string): Promise<ExecutionRow | null> {
  const [execution] = await db
    .select()
    .from(executions)
    .where(eq(executions.intentId, intentId));
  return execution ?? null;
}

export async function updateExecutionState(
  id: string,
  newState: ExecutionState,
  updates?: Partial<{
    txHash: string;
    errorMessage: string;
    submittedAt: Date;
    confirmedAt: Date;
  }>
): Promise<ExecutionRow | null> {
  const [updated] = await db
    .update(executions)
    .set({
      state: newState,
      ...updates,
      updatedAt: new Date(),
    })
    .where(eq(executions.id, id))
    .returning();

  return updated ?? null;
}
