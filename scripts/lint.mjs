import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const files = [
  ...(await listFiles("src", ".ts")),
  ...(await listFiles("src", ".tsx")),
  ...(await listFiles("src", ".css")),
  ...(await listFiles("scripts", ".mjs")),
  ...(await listFiles("tests", ".ts")),
  ...(await listFiles("docs", ".md")),
  "README.md",
  ".env.example"
];

const failures = [];

for (const file of files) {
  const content = await readFile(file, "utf8");
  const lines = content.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (/[ \t]+$/.test(line)) {
      failures.push(`${file}:${index + 1}: trailing whitespace`);
    }
  }
  if (file.endsWith(".ts") && content.includes("client_id=replace_me")) {
    failures.push(`${file}: client_id must not be hardcoded`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Lint completed (${files.length} files checked)`);

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
