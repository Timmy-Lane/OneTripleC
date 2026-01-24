import { eq } from 'drizzle-orm';
import { db } from '../db.js';
import { intents } from '../models/schema.js';
import { IntentState } from '../../shared/types/index.js';

export type IntentRow = typeof intents.$inferSelect;
export type NewIntent = typeof intents.$inferInsert;

// Valid state transitions for intent lifecycle
const VALID_TRANSITIONS: Record<string, IntentState[]> = {
  [IntentState.CREATED]: [IntentState.PARSING, IntentState.FAILED, IntentState.CANCELLED],
  [IntentState.PARSING]: [IntentState.PARSED, IntentState.FAILED],
  [IntentState.PARSED]: [IntentState.QUOTE_REQUESTED, IntentState.FAILED, IntentState.CANCELLED],
  [IntentState.QUOTE_REQUESTED]: [IntentState.QUOTED, IntentState.FAILED, IntentState.EXPIRED],
  [IntentState.QUOTED]: [IntentState.ACCEPTED, IntentState.FAILED, IntentState.CANCELLED, IntentState.EXPIRED],
  [IntentState.ACCEPTED]: [IntentState.EXECUTING, IntentState.FAILED, IntentState.CANCELLED],
  [IntentState.EXECUTING]: [IntentState.COMPLETED, IntentState.FAILED],
  [IntentState.COMPLETED]: [],
  [IntentState.FAILED]: [],
  [IntentState.CANCELLED]: [],
  [IntentState.EXPIRED]: [],
};

export function isValidTransition(from: IntentState, to: IntentState): boolean {
  const validTargets = VALID_TRANSITIONS[from];
  return validTargets?.includes(to) ?? false;
}

export async function createIntent(data: {
  userId: string;
  rawMessage: string;
}): Promise<IntentRow> {
  const [intent] = await db
    .insert(intents)
    .values({
      userId: data.userId,
      rawMessage: data.rawMessage,
      state: 'CREATED',
    })
    .returning();

  return intent;
}

export async function findIntentById(id: string): Promise<IntentRow | null> {
  const [intent] = await db.select().from(intents).where(eq(intents.id, id));
  return intent ?? null;
}

export async function updateIntentState(
  id: string,
  newState: IntentState,
  additionalData?: Partial<{
    sourceChainId: number;
    targetChainId: number;
    sourceToken: string;
    targetToken: string;
    sourceAmount: string;
    minTargetAmount: string;
    slippageBps: number;
    parsingConfidence: string;
    errorMessage: string;
  }>
): Promise<IntentRow | null> {
  const [updated] = await db
    .update(intents)
    .set({
      state: newState,
      ...additionalData,
      updatedAt: new Date(),
    })
    .where(eq(intents.id, id))
    .returning();

  return updated ?? null;
}

export async function updateIntentWithValidation(
  id: string,
  currentState: IntentState,
  newState: IntentState,
  additionalData?: Partial<{
    sourceChainId: number;
    targetChainId: number;
    sourceToken: string;
    targetToken: string;
    sourceAmount: string;
    minTargetAmount: string;
    slippageBps: number;
    parsingConfidence: string;
    errorMessage: string;
  }>
): Promise<IntentRow | null> {
  if (!isValidTransition(currentState, newState)) {
    throw new Error(
      `Invalid state transition: ${currentState} -> ${newState}`
    );
  }

  return updateIntentState(id, newState, additionalData);
}
