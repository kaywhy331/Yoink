/**
 * The one typed base for errors that a request handler should answer with a
 * 4xx status and a plain message instead of a masked 500. Repositories and
 * engines throw it (or a subclass) whenever the caller can act on the reason:
 * bad input, a conflicting mapping, a blocked state change. `api-error.ts`
 * maps every instance with a single `instanceof` branch; anything that is not
 * a DomainRequestError stays a genuine internal error.
 */
export interface DomainRequestErrorDetails {
  [key: string]: unknown;
}

export class DomainRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: DomainRequestErrorDetails | null;

  constructor(code: string, status: number, message: string, details: DomainRequestErrorDetails | null = null) {
    super(message);
    this.name = "DomainRequestError";
    this.code = /^[a-z][a-z0-9_]{1,79}$/.test(code) ? code : "request_rejected";
    this.status = Number.isInteger(status) && status >= 400 && status <= 499 ? status : 400;
    this.details = details && typeof details === "object" ? details : null;
  }
}

/** A conflict with existing state (409): the request was well-formed but cannot apply as-is. */
export class DomainConflictError extends DomainRequestError {
  constructor(code: string, message: string, details: DomainRequestErrorDetails | null = null) {
    super(code, 409, message, details);
    this.name = "DomainConflictError";
  }
}

/** The addressed record does not exist or is not visible to the caller (404). */
export class DomainNotFoundError extends DomainRequestError {
  constructor(code: string, message: string, details: DomainRequestErrorDetails | null = null) {
    super(code, 404, message, details);
    this.name = "DomainNotFoundError";
  }
}

export function isDomainRequestError(error: unknown): error is DomainRequestError {
  return error instanceof DomainRequestError;
}
