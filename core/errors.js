export class DomainError extends Error {
  constructor(code, message, { details = null, status = 400, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "DomainError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}
