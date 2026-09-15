import { sql, type SQL } from "drizzle-orm";

import {
  DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  DATABASE_LOCK_TIMEOUT_MS,
  DATABASE_STATEMENT_TIMEOUT_MS,
} from "./db-client-options";

type TransactionTimeoutExecutor = {
  execute(query: SQL): PromiseLike<unknown>;
};

export async function setLocalDatabaseTimeouts(
  transaction: TransactionTimeoutExecutor,
) {
  // set_config(..., true) is PostgreSQL's parameterized SET LOCAL equivalent.
  await transaction.execute(sql`
    SELECT
      set_config('lock_timeout', ${`${DATABASE_LOCK_TIMEOUT_MS}ms`}, true),
      set_config('statement_timeout', ${`${DATABASE_STATEMENT_TIMEOUT_MS}ms`}, true),
      set_config(
        'idle_in_transaction_session_timeout',
        ${`${DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS}ms`},
        true
      )
  `);
}
