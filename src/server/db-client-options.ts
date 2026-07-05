export const DATABASE_CONNECT_TIMEOUT_SECONDS = 5;
export const DATABASE_IDLE_TIMEOUT_SECONDS = 20;
export const DATABASE_MAX_CONNECTIONS = 1;
export const DATABASE_STATEMENT_TIMEOUT_MS = 9_000;

export const databaseClientOptions = {
  connect_timeout: DATABASE_CONNECT_TIMEOUT_SECONDS,
  idle_timeout: DATABASE_IDLE_TIMEOUT_SECONDS,
  max: DATABASE_MAX_CONNECTIONS,
  prepare: false,
  connection: {
    idle_in_transaction_session_timeout: DATABASE_STATEMENT_TIMEOUT_MS,
    statement_timeout: DATABASE_STATEMENT_TIMEOUT_MS,
  },
} as const;
