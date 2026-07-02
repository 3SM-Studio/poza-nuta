export type OperatorApiErrorStatus = 400 | 401 | 403 | 404 | 409;

export class OperatorApiError extends Error {
  constructor(
    readonly status: OperatorApiErrorStatus,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OperatorApiError";
  }
}
