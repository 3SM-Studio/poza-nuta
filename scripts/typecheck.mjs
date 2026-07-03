import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

const roots = ["src", "tests"];
const tsFiles = [];

for (const root of roots) {
  tsFiles.push(...(await listFiles(root, ".ts")));
}

const failures = [];

for (const file of tsFiles) {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--check", file], {
    encoding: "utf8",
    stdio: "pipe"
  });

  if (result.status !== 0) {
    failures.push([file, result.stderr || result.stdout].join("\n"));
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n\n"));
  process.exit(1);
}

console.log(`Typecheck completed (${tsFiles.length} TypeScript files checked)`);

async function listFiles(dir, extension) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path, extension)));
    } else if (entry.isFile() && path.endsWith(extension)) {
      files.push(path);
    }
  }

  return files;
}
