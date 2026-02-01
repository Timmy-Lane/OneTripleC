export abstract class DomainError extends Error {
   public readonly code: string;
   public readonly statusCode: number;
   public readonly details?: Record<string, unknown>;

   constructor(
      message: string,
      code: string,
      statusCode: number,
      details?: Record<string, unknown>
   ) {
      super(message);
      this.name = this.constructor.name;
      this.code = code;
      this.statusCode = statusCode;
      this.details = details;

      Error.captureStackTrace?.(this, this.constructor);
   }
}

export class IntentValidationError extends DomainError {
   constructor(message: string, details?: Record<string, unknown>) {
      super(message, 'INTENT_VALIDATION_ERROR', 400, details);
   }
}

export class QuoteExpiredError extends DomainError {
   constructor(message: string, details?: Record<string, unknown>) {
      super(message, 'QUOTE_EXPIRED', 410, details);
   }
}

export class InsufficientBalanceError extends DomainError {
   constructor(message: string, details?: Record<string, unknown>) {
      super(message, 'INSUFFICIENT_BALANCE', 400, details);
   }
}

export class InsufficientLiquidityError extends DomainError {
   constructor(message: string, details?: Record<string, unknown>) {
      super(message, 'INSUFFICIENT_LIQUIDITY', 400, details);
   }
}

export class ExecutionFailedError extends DomainError {
   constructor(message: string, details?: Record<string, unknown>) {
      super(message, 'EXECUTION_FAILED', 500, details);
   }
}

export class UnauthorizedError extends DomainError {
   constructor(message: string, details?: Record<string, unknown>) {
      super(message, 'UNAUTHORIZED', 401, details);
   }
}

export class WalletNotFoundError extends DomainError {
   constructor(message: string, details?: Record<string, unknown>) {
      super(message, 'WALLET_NOT_FOUND', 404, details);
   }
}

export class NotFoundError extends DomainError {
   constructor(message: string, details?: Record<string, unknown>) {
      super(message, 'NOT_FOUND', 404, details);
   }
}

export class ForbiddenError extends DomainError {
   constructor(message: string, details?: Record<string, unknown>) {
      super(message, 'FORBIDDEN', 403, details);
   }
}

export class InvalidStateError extends DomainError {
   constructor(message: string, details?: Record<string, unknown>) {
      super(message, 'INVALID_STATE', 400, details);
   }
}

export class ExternalServiceError extends DomainError {
   constructor(message: string, details?: Record<string, unknown>) {
      super(message, 'EXTERNAL_SERVICE_ERROR', 502, details);
   }
}

export class RateLimitError extends DomainError {
   constructor(message: string, details?: Record<string, unknown>) {
      super(message, 'RATE_LIMIT_EXCEEDED', 429, details);
   }
}
