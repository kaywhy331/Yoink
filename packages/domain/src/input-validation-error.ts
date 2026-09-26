import { DomainRequestError } from "./domain-request-error.js";

export class InputValidationError extends DomainRequestError {
  constructor(message: string, details: Record<string, unknown> | null = null) {
    super("request_rejected", 400, message, details);
    this.name = "InputValidationError";
  }
}
