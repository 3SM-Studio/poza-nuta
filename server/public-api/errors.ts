export type PublicApiErrorStatus = 403 | 404;

export class PublicApiError extends Error {
  constructor(
    readonly status: PublicApiErrorStatus,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "PublicApiError";
  }
}
