import type { FastifyBaseLogger } from 'fastify';
import { IntentState, type Intent } from '../../shared/types/index.js';
import {
  createIntent as createIntentInDb,
  findIntentById,
  updateIntentWithValidation,
  type IntentRow,
} from '../../persistence/repositories/intent-repository.js';
import { enqueueParseIntent, enqueueFetchQuotes } from '../../services/queue.js';

// Simple logger interface that works with both Fastify logger and console
interface Logger {
  info(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

const consoleLogger: Logger = {
  info: (obj, msg) => console.log(msg || '', obj),
  error: (obj, msg) => console.error(msg || '', obj),
};

let logger: Logger = consoleLogger;

export function setIntentServiceLogger(loggerInstance: FastifyBaseLogger): void {
  logger = loggerInstance as unknown as Logger;
}

// Convert DB row to Intent interface
function rowToIntent(row: IntentRow): Intent {
  return {
    id: row.id,
    userId: row.userId,
    rawMessage: row.rawMessage,
    sourceChainId: row.sourceChainId,
    targetChainId: row.targetChainId,
    sourceToken: row.sourceToken,
    targetToken: row.targetToken,
    sourceAmount: row.sourceAmount,
    minTargetAmount: row.minTargetAmount,
    slippageBps: row.slippageBps,
    parsingConfidence: row.parsingConfidence,
    state: row.state as IntentState,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Stubbed parsing result
export interface ParsedIntent {
  sourceChainId: number;
  targetChainId: number;
  sourceToken: string;
  targetToken: string;
  sourceAmount: string;
}

/**
 * Core business logic for intent processing.
 * This service orchestrates the intent lifecycle:
 * 1. Creation (CREATED)
 * 2. Parsing (PARSING -> PARSED)
 * 3. Quote fetching (future: QUOTE_REQUESTED -> QUOTED)
 * 4. Execution (future: ACCEPTED -> EXECUTING -> COMPLETED)
 */
export class IntentService {
  /**
   * Create a new intent from raw user message.
   * Intent is created in CREATED state.
   * A parse-intent job is enqueued for async processing.
   */
  async createIntent(params: {
    userId: string;
    rawMessage: string;
  }): Promise<Intent> {
    logger.info({ userId: params.userId }, 'Creating new intent');

    const intent = await createIntentInDb({
      userId: params.userId,
      rawMessage: params.rawMessage,
    });

    logger.info(
      { intentId: intent.id, state: intent.state },
      'Intent created with state CREATED'
    );

    // Enqueue parse job
    await enqueueParseIntent(intent.id);

    return rowToIntent(intent);
  }

  /**
   * Retrieve an intent by ID.
   */
  async getIntentById(intentId: string): Promise<Intent | null> {
    const intent = await findIntentById(intentId);
    return intent ? rowToIntent(intent) : null;
  }

  /**
   * Transition intent to PARSING state.
   * Called by worker when starting to parse.
   */
  async markParsing(intentId: string): Promise<Intent> {
    logger.info({ intentId }, 'Transitioning intent to PARSING');

    const intent = await findIntentById(intentId);
    if (!intent) {
      throw new Error(`Intent not found: ${intentId}`);
    }

    const updated = await updateIntentWithValidation(
      intentId,
      intent.state as IntentState,
      IntentState.PARSING
    );

    if (!updated) {
      throw new Error(`Failed to update intent: ${intentId}`);
    }

    logger.info(
      { intentId, fromState: intent.state, toState: IntentState.PARSING },
      'Intent state transitioned'
    );

    return rowToIntent(updated);
  }

  /**
   * Transition intent to PARSED state with parsed data.
   * Called by worker after successful parsing.
   */
  async markParsed(intentId: string, parsedData: ParsedIntent): Promise<Intent> {
    logger.info({ intentId }, 'Transitioning intent to PARSED');

    const intent = await findIntentById(intentId);
    if (!intent) {
      throw new Error(`Intent not found: ${intentId}`);
    }

    const updated = await updateIntentWithValidation(
      intentId,
      intent.state as IntentState,
      IntentState.PARSED,
      {
        sourceChainId: parsedData.sourceChainId,
        targetChainId: parsedData.targetChainId,
        sourceToken: parsedData.sourceToken,
        targetToken: parsedData.targetToken,
        sourceAmount: parsedData.sourceAmount,
      }
    );

    if (!updated) {
      throw new Error(`Failed to update intent: ${intentId}`);
    }

    logger.info(
      { intentId, fromState: intent.state, toState: IntentState.PARSED },
      'Intent state transitioned to PARSED'
    );

    // Enqueue next step: fetch-quotes
    await enqueueFetchQuotes(intentId);

    return rowToIntent(updated);
  }

  /**
   * Transition intent to FAILED state with error reason.
   * Called when any step fails.
   */
  async markFailed(intentId: string, reason: string): Promise<Intent> {
    logger.info({ intentId, reason }, 'Transitioning intent to FAILED');

    const intent = await findIntentById(intentId);
    if (!intent) {
      throw new Error(`Intent not found: ${intentId}`);
    }

    const updated = await updateIntentWithValidation(
      intentId,
      intent.state as IntentState,
      IntentState.FAILED,
      {
        errorMessage: reason,
      }
    );

    if (!updated) {
      throw new Error(`Failed to update intent: ${intentId}`);
    }

    logger.error(
      { intentId, fromState: intent.state, toState: IntentState.FAILED, reason },
      'Intent state transitioned to FAILED'
    );

    return rowToIntent(updated);
  }

  /**
   * STUBBED: Parse raw message to extract intent fields.
   * In real implementation, this would use NLP or structured parsing.
   *
   * This stub simulates:
   * - Success: if rawMessage contains "swap"
   * - Failure: if rawMessage contains "fail"
   * - Random failure: 10% chance otherwise
   */
  parseRawMessage(rawMessage: string): ParsedIntent | null {
    // Simulate failure case
    if (rawMessage.toLowerCase().includes('fail')) {
      return null;
    }

    // Simulate random failure (10% chance)
    if (Math.random() < 0.1 && !rawMessage.toLowerCase().includes('swap')) {
      return null;
    }

    // Stubbed parsing - extract dummy fields
    // In reality, this would use NLP to understand:
    // "swap 100 USDC on Ethereum to ETH on Base"
    return {
      sourceChainId: 1, // Ethereum
      targetChainId: 8453, // Base
      sourceToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC on Ethereum
      targetToken: '0x0000000000000000000000000000000000000000', // Native ETH
      sourceAmount: '100000000', // 100 USDC (6 decimals)
    };
  }

  /**
   * Full parsing flow: CREATED -> PARSING -> PARSED or FAILED.
   * Called by the parse-intent worker.
   */
  async parseIntent(intentId: string): Promise<Intent> {
    // First, mark as PARSING
    await this.markParsing(intentId);

    // Get the intent to access rawMessage
    const intent = await findIntentById(intentId);
    if (!intent) {
      throw new Error(`Intent not found: ${intentId}`);
    }

    // Attempt to parse
    const parsed = this.parseRawMessage(intent.rawMessage);

    if (parsed) {
      // Success path: mark as PARSED
      return this.markParsed(intentId, parsed);
    } else {
      // Failure path: mark as FAILED
      return this.markFailed(intentId, 'Failed to parse intent from raw message');
    }
  }
}

// Export singleton instance
export const intentService = new IntentService();
