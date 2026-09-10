import { config } from "dotenv";

import {
  loadISingAdapterOptions,
  maximumISingBatchSize,
  runISingImportAdapter,
  type ISingImportOptions,
  type ISingImportSummary,
} from "./ising-import-adapter.ts";

config({ path: [".env.local", ".env"], quiet: true });

export function loadISingImportOptions(
  env: NodeJS.ProcessEnv,
  args: string[],
): ISingImportOptions {
  const cliOptions = parseCliOptions(args);
  if (!cliOptions.dryRun) {
    throw new Error(
      "Direct iSing writes are disabled. Enqueue the import job and run the import worker.",
    );
  }

  return loadISingAdapterOptions(env, "dry_run", {
    batchSize: cliOptions.batchSize ?? undefined,
    delayMs: cliOptions.delayMs ?? undefined,
    limit: cliOptions.limit,
    order: cliOptions.order ?? undefined,
    tag: cliOptions.tag ?? undefined,
  });
}

async function main() {
  const options = loadISingImportOptions(process.env, process.argv.slice(2));
  const outcome = await runISingImportAdapter(options);
  printSummary(outcome.summary);
  if (outcome.status !== "completed") {
    throw new Error("The iSing dry-run stopped before completion.");
  }
}

function printSummary(summary: ISingImportSummary) {
  console.log("iSing import summary");
  console.log(`mode=${summary.mode}`);
  console.log(`pages=${summary.pages}`);
  console.log(`processed=${summary.processed}`);
  console.log(`inserted=${summary.inserted}`);
  console.log(`updated=${summary.updated}`);
  console.log(`skipped=${summary.skipped}`);
  console.log(`errors=${summary.errors}`);
}

function parseCliOptions(args: string[]) {
  let dryRun = false;
  let limit: number | null = null;
  let batchSize: number | null = null;
  let delayMs: number | null = null;
  let tag: string | null = null;
  let order: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--limit") {
      limit = parseRequiredPositiveOption(args[index + 1], "--limit");
      index += 1;
      continue;
    }
    if (argument === "--batch-size") {
      batchSize = parseRequiredPositiveOption(args[index + 1], "--batch-size");
      if (batchSize > maximumISingBatchSize) {
        throw new Error(`--batch-size must be at most ${maximumISingBatchSize}.`);
      }
      index += 1;
      continue;
    }
    if (argument === "--delay-ms") {
      delayMs = parseRequiredNonNegativeOption(args[index + 1], "--delay-ms");
      index += 1;
      continue;
    }
    if (argument === "--tag") {
      tag = requireOptionValue(args[index + 1], "--tag");
      index += 1;
      continue;
    }
    if (argument === "--order") {
      order = requireOptionValue(args[index + 1], "--order");
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }

  return { dryRun, limit, batchSize, delayMs, tag, order };
}

function parseRequiredPositiveOption(value: string | undefined, name: string) {
  const optionValue = requireOptionValue(value, name);
  const parsed = Number(optionValue);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function parseRequiredNonNegativeOption(value: string | undefined, name: string) {
  const optionValue = requireOptionValue(value, name);
  const parsed = Number(optionValue);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  return parsed;
}

function requireOptionValue(value: string | undefined, name: string) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

if (process.argv[1]?.endsWith("import-ising.ts")) {
  main().catch(() => {
    console.error("The iSing dry-run failed safely.");
    process.exitCode = 1;
  });
}
