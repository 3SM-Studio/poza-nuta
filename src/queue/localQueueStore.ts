import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { QueueState } from "./types.ts";

export class MissingQueueStateError extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`Missing queue state: ${path}`);
    this.name = "MissingQueueStateError";
    this.path = path;
  }
}

const fileLocks = new Map<string, Promise<void>>();

export async function saveQueueState(filePath: string, state: QueueState): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = join(dirname(filePath), `.${randomUUID()}.tmp`);
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export async function updateQueueState(filePath: string, operation: (state: QueueState) => QueueState | Promise<QueueState>): Promise<QueueState> {
  return withFileLock(filePath, async () => {
    const current = await loadQueueState(filePath);
    const next = await operation(current);
    await saveQueueState(filePath, next);
    return next;
  });
}

export async function loadQueueState(filePath: string): Promise<QueueState> {
  let raw: string;

  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingFileError(error)) {
      throw new MissingQueueStateError(filePath);
    }
    throw error;
  }

  const parsed: unknown = JSON.parse(raw);
  if (!isQueueState(parsed)) {
    throw new Error(`Invalid queue state: ${filePath}`);
  }

  return parsed;
}

function isQueueState(value: unknown): value is QueueState {
  return (
    typeof value === "object" &&
    value !== null &&
    "event" in value &&
    "requests" in value &&
    Array.isArray(value.requests)
  );
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function withFileLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = fileLocks.get(filePath) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.then(() => current);
  fileLocks.set(filePath, queued);

  try {
    await previous;
    return await operation();
  } finally {
    release();
    if (fileLocks.get(filePath) === queued) {
      fileLocks.delete(filePath);
    }
  }
}
