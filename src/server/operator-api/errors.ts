export type OperatorApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 429 | 503;

export class OperatorApiError extends Error {
  readonly status: OperatorApiErrorStatus;
  readonly code: string;

  constructor(
    status: OperatorApiErrorStatus,
    code: string,
    message: string,
  ) {
    super(message);
    this.name = "OperatorApiError";
    this.status = status;
    this.code = code;
  }
}
