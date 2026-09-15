import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";

import { classifyDatabaseError } from "./runtime-diagnostics.ts";

type Context = { requestId: string; route: string };
const context = new AsyncLocalStorage<Context>();
const runtimeGlobal = globalThis as typeof globalThis & { pozaNutaRuntimeId?: string };
runtimeGlobal.pozaNutaRuntimeId ??= randomUUID();
const runtimeId = runtimeGlobal.pozaNutaRuntimeId;

// Only internally defined semantic names and validated runtime metadata reach logs.
const commit = /^[a-f0-9]{7,40}$/i.test(process.env.VERCEL_GIT_COMMIT_SHA ?? "")
  ? process.env.VERCEL_GIT_COMMIT_SHA
  : undefined;
const region = /^[a-z0-9-]{2,32}$/i.test(process.env.VERCEL_REGION ?? "")
  ? process.env.VERCEL_REGION
  : undefined;

export function runWithDbTelemetry<T>(route: string, action: () => T): T {
  if (context.getStore()) return action();
  return context.run({ requestId: randomUUID(), route }, action);
}

export function getDbTelemetryCorrelation(route: string) {
  const current = context.getStore();
  return {
    request_id: current?.requestId ?? randomUUID(),
    runtime_id: runtimeId,
    route: current?.route ?? route,
    ...(commit ? { commit } : {}),
    ...(region ? { region } : {}),
  };
}

function emit(fields: Record<string, string | number | boolean | undefined>) {
  console.info(JSON.stringify({ event: "db_telemetry", ...fields }));
}

export async function traceDbOperation<T>(
  route: string,
  operation: string,
  action: () => Promise<T>,
): Promise<T> {
  return runWithDbTelemetry(route, async () => {
    const correlation = getDbTelemetryCorrelation(route);
    const started = performance.now();
    emit({ ...correlation, operation, phase: "start" });
    try {
      const result = await action();
      emit({ ...correlation, operation, phase: "success", operation_duration_ms: performance.now() - started });
      return result;
    } catch (error) {
      emit({ ...correlation, operation, phase: "failure", operation_duration_ms: performance.now() - started, error_class: classifyDatabaseError(error) });
      throw error;
    }
  });
}

export async function traceDbTransaction<T>(
  route: string,
  operation: string,
  action: (onStarted: () => void) => Promise<T>,
): Promise<T> {
  return runWithDbTelemetry(route, async () => {
    const correlation = getDbTelemetryCorrelation(route);
    const attemptStarted = performance.now();
    let transactionStarted: number | undefined;
    emit({ ...correlation, operation, phase: "transaction_attempt_start" });
    const onStarted = () => {
      transactionStarted = performance.now();
      emit({ ...correlation, operation, phase: "transaction_start" });
    };
    try {
      const result = await action(onStarted);
      emit({ ...correlation, operation, phase: "commit", transaction_duration_ms: transactionStarted === undefined ? undefined : performance.now() - transactionStarted, transaction_attempt_duration_ms: performance.now() - attemptStarted });
      return result;
    } catch (error) {
      emit({ ...correlation, operation, phase: transactionStarted === undefined ? "transaction_attempt_failure" : "rollback", transaction_duration_ms: transactionStarted === undefined ? undefined : performance.now() - transactionStarted, transaction_attempt_duration_ms: performance.now() - attemptStarted, error_class: classifyDatabaseError(error) });
      throw error;
    }
  });
}

export async function traceForUpdateSelect<T extends readonly unknown[]>(
  route: string,
  operation: string,
  resource: string,
  action: () => Promise<T>,
): Promise<T> {
  return runWithDbTelemetry(route, async () => {
    const correlation = getDbTelemetryCorrelation(route);
    const started = performance.now();
    emit({ ...correlation, operation, resource, phase: "for_update_select_start" });
    try {
      const rows = await action();
      emit({ ...correlation, operation, resource, phase: rows.length ? "lock_acquired" : "for_update_select_empty", for_update_select_ms: performance.now() - started });
      return rows;
    } catch (error) {
      emit({ ...correlation, operation, resource, phase: "for_update_select_failure", for_update_select_ms: performance.now() - started, error_class: classifyDatabaseError(error) });
      throw error;
    }
  });
}

export function startForUpdateSelect(route: string, operation: string, resource: string) {
  const correlation = getDbTelemetryCorrelation(route);
  const started = performance.now();
  emit({ ...correlation, operation, resource, phase: "for_update_select_start" });
  return {
    complete<T extends readonly unknown[]>(rows: T): T {
      emit({ ...correlation, operation, resource, phase: rows.length ? "lock_acquired" : "for_update_select_empty", for_update_select_ms: performance.now() - started });
      return rows;
    },
    fail(error: unknown): never {
      emit({ ...correlation, operation, resource, phase: "for_update_select_failure", for_update_select_ms: performance.now() - started, error_class: classifyDatabaseError(error) });
      throw error;
    },
  };
}
