import type { FastifyBaseLogger } from 'fastify';
import { IntentState, type Intent } from '../../shared/types/index.js';
import {
  createIntent as createIntentInDb,
  findIntentById,
  updateIntentWithValidation,
  type IntentRow,
} from '../../persistence/repositories/intent-repository.js';
import {
  enqueueParseIntent,
  enqueueFetchQuotes,
  enqueueExecuteIntent,
} from '../../services/queue.js';
import { quoteService } from '../routing/quote-service.js';
import { createQuote, findQuoteById, markQuoteAccepted } from '../../persistence/repositories/quote-repository.js';
import { createExecution } from '../../persistence/repositories/execution-repository.js';

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
   * Parse raw message to extract intent fields.
   * Supports structured JSON from Telegram bot.
   *
   * Expected JSON format:
   * {
   *   "action": "swap",
   *   "chainId": 1,
   *   "sourceToken": "0x...",
   *   "targetToken": "0x...",
   *   "amount": "1000000000000000000"
   * }
   */
  parseRawMessage(rawMessage: string): ParsedIntent | null {
    try {
      const data = JSON.parse(rawMessage);

      // Validate required fields
      if (!data.action || data.action !== 'swap') {
        logger.error({ data }, 'Invalid action - only "swap" is supported');
        return null;
      }

      if (!data.chainId || typeof data.chainId !== 'number') {
        logger.error({ data }, 'Missing or invalid chainId');
        return null;
      }

      if (!data.sourceToken || typeof data.sourceToken !== 'string') {
        logger.error({ data }, 'Missing or invalid sourceToken');
        return null;
      }

      if (!data.targetToken || typeof data.targetToken !== 'string') {
        logger.error({ data }, 'Missing or invalid targetToken');
        return null;
      }

      if (!data.amount || typeof data.amount !== 'string') {
        logger.error({ data }, 'Missing or invalid amount');
        return null;
      }

      // Validate token addresses (basic checksum format check)
      const addressRegex = /^0x[a-fA-F0-9]{40}$/;
      if (!addressRegex.test(data.sourceToken)) {
        logger.error({ sourceToken: data.sourceToken }, 'Invalid sourceToken address format');
        return null;
      }

      if (!addressRegex.test(data.targetToken)) {
        logger.error({ targetToken: data.targetToken }, 'Invalid targetToken address format');
        return null;
      }

      // Same-chain swaps: sourceChainId = targetChainId
      return {
        sourceChainId: data.chainId,
        targetChainId: data.chainId, // V1: same-chain only
        sourceToken: data.sourceToken,
        targetToken: data.targetToken,
        sourceAmount: data.amount,
      };
    } catch (error) {
      // Not valid JSON - could be natural language (future: use NLP)
      logger.error({ rawMessage, error }, 'Failed to parse raw message as JSON');
      return null;
    }
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

  async fetchQuotesForIntent(intentId: string): Promise<{
    quotesCreated: number;
    state: IntentState;
  }> {
    logger.info({ intentId }, 'Fetching quotes for intent');

    const intent = await findIntentById(intentId);
    if (!intent) {
      throw new Error(`Intent not found: ${intentId}`);
    }

    if (intent.state !== 'PARSED') {
      throw new Error(`Intent must be in PARSED state to fetch quotes, current: ${intent.state}`);
    }

    if (!intent.sourceChainId || !intent.targetChainId || !intent.sourceToken || !intent.targetToken || !intent.sourceAmount) {
      throw new Error('Intent missing required fields for quote fetching');
    }

    try {
      const quoteResults = await quoteService.fetchQuotes({
        sourceChainId: intent.sourceChainId,
        targetChainId: intent.targetChainId,
        sourceToken: intent.sourceToken,
        targetToken: intent.targetToken,
        sourceAmount: intent.sourceAmount,
        slippageBps: 50,
      });

      logger.info({ intentId, quotesCount: quoteResults.length }, 'Quotes fetched successfully');

      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

      for (const quoteResult of quoteResults) {
        await createQuote({
          intentId,
          route: quoteResult.route,
          estimatedOutput: quoteResult.estimatedOutput,
          totalFee: quoteResult.totalFee,
          expiresAt,
        });
      }

      await updateIntentWithValidation(
        intentId,
        intent.state as IntentState,
        IntentState.QUOTED
      );

      logger.info({ intentId, quotesCreated: quoteResults.length }, 'Intent transitioned to QUOTED');

      return {
        quotesCreated: quoteResults.length,
        state: IntentState.QUOTED,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ intentId, error: errorMessage }, 'Failed to fetch quotes');

      await this.markFailed(intentId, `Quote fetching failed: ${errorMessage}`);

      return {
        quotesCreated: 0,
        state: IntentState.FAILED,
      };
    }
  }

  async acceptIntent(
    intentId: string,
    quoteId: string
  ): Promise<{ intentId: string; state: IntentState; executionId: string }> {
    logger.info({ intentId, quoteId }, 'Accepting intent');

    const intent = await findIntentById(intentId);
    if (!intent) {
      throw new Error(`Intent not found: ${intentId}`);
    }

    if (intent.state !== 'QUOTED') {
      throw new Error(
        `Invalid state for acceptance: ${intent.state}. Intent must be in QUOTED state.`
      );
    }

    const quote = await findQuoteById(quoteId);
    if (!quote) {
      throw new Error(`Quote not found: ${quoteId}`);
    }

    if (quote.intentId !== intentId) {
      throw new Error(`Quote ${quoteId} does not belong to intent ${intentId}`);
    }

    const now = new Date();
    if (new Date(quote.expiresAt) < now) {
      throw new Error(`Quote ${quoteId} has expired`);
    }

    await markQuoteAccepted(quoteId);

    await updateIntentWithValidation(
      intentId,
      intent.state as IntentState,
      IntentState.ACCEPTED
    );

    const execution = await createExecution({
      intentId,
      quoteId,
      userId: intent.userId,
      userAddress: '0x0000000000000000000000000000000000000000',
      chainId: intent.sourceChainId!,
    });

    // Enqueue execution job
    await enqueueExecuteIntent(execution.id);

    logger.info(
      { intentId, quoteId, executionId: execution.id },
      'Intent accepted, execution job enqueued'
    );

    return {
      intentId,
      state: IntentState.ACCEPTED,
      executionId: execution.id,
    };
  }
}

// Export singleton instance
export const intentService = new IntentService();
