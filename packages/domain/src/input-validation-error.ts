export class InputValidationError extends Error {
  readonly code = "request_rejected";
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "InputValidationError";
  }
}
