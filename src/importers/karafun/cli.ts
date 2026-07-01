import { resolve } from "node:path";
import { parseAppEnv, readEnvFile } from "../../config/env.ts";
import { importKaraFunCsv } from "./importKaraFunCsv.ts";
import type { KaraFunImporterConfig } from "./types.ts";

try {
  const env = { ...(await readEnvFile(".env")), ...process.env };
  const config = loadKaraFunImporterConfig(process.argv.slice(2), env);
  const report = await importKaraFunCsv(config);

  console.log("KaraFun import completed");
  console.log(`Rows: ${report.totalRows}`);
  console.log(`Imported: ${report.importedCount}`);
  console.log(`Skipped: ${report.skippedCount}`);
  console.log(`Output: ${config.outputSongsPath}`);
} catch (error) {
  console.error("KaraFun import failed");
  console.error(`Reason: ${error instanceof Error ? error.message : "Unknown error"}`);
  process.exitCode = 1;
}

export function loadKaraFunImporterConfig(args: string[], env = process.env): KaraFunImporterConfig {
  const flags = parseFlags(args);
  const appEnv = parseAppEnv(env);
  const inputCsvPath = valueFromFlagOrEnv(flags, "input", appEnv.karafunCsvPath);

  return {
    inputCsvPath: resolve(inputCsvPath),
    outputSongsPath: resolve(valueFromFlagOrEnv(flags, "output", appEnv.songIndexPath)),
    outputReportPath: resolve(valueFromFlagOrEnv(flags, "report", appEnv.karafunImportReportPath))
  };
}

function parseFlags(args: string[]): Map<string, string | boolean> {
  const flags = new Map<string, string | boolean>();

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) {
      continue;
    }

    const flagName = value.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(flagName, true);
    } else {
      flags.set(flagName, next);
      index += 1;
    }
  }

  return flags;
}

function valueFromFlagOrEnv(flags: Map<string, string | boolean>, name: string, envValue: string): string {
  const flagValue = flags.get(name);
  if (typeof flagValue === "string" && flagValue.trim()) {
    return flagValue.trim();
  }
  return envValue;
}
