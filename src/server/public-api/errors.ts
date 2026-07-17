export type PublicApiErrorStatus = 403 | 404 | 429;

export class PublicApiError extends Error {
  readonly status: PublicApiErrorStatus;
  readonly code: string;

  constructor(
    status: PublicApiErrorStatus,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "PublicApiError";
    this.status = status;
    this.code = code;
  }
}
