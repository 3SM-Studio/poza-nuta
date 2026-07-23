import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SUPABASE_CLI_VERSION = "2.109.1";
const PROJECT_ID = "pozanuta-p3-e2e";
const APP_PORT = 3105;
const API_PORT = 55431;
const DB_PORT = 55432;
const SHADOW_DB_PORT = 55430;
const ANALYTICS_PORT = 55437;
const NEXT_DIST_DIRECTORY = ".next-p3-e2e";
const PLAYWRIGHT_OUTPUT_DIRECTORY = ".playwright-p3-e2e";
const LOCAL_ORIGIN = `http://localhost:${APP_PORT}`;
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;

const repoRoot = resolve(import.meta.dirname, "../..");
const projectRoot = await mkdtemp(join(tmpdir(), "pozanuta-p3-e2e-"));
const supabaseDirectory = join(projectRoot, "supabase");

try {
  await assertPortsAvailable([
    APP_PORT,
    API_PORT,
    DB_PORT,
    SHADOW_DB_PORT,
    ANALYTICS_PORT,
  ]);
  await mkdir(supabaseDirectory, { recursive: true });
  await writeFile(
    join(supabaseDirectory, "config.toml"),
    createLocalSupabaseConfig(),
    "utf8",
  );

  await runSupabaseHidden([
    "stop",
    "--project-id",
    PROJECT_ID,
    "--no-backup",
  ], true);

  console.log("[local-e2e] Starting isolated Supabase Auth and PostgreSQL 17.");
  await runSupabaseHidden([
    "start",
    "--exclude",
    "analytics,edge-runtime,functions,imgproxy,inbucket,meta,rest,storage,studio,vector",
  ]);

  const status = parseStatusEnvironment(
    await runSupabaseHidden(["status", "--output", "env"]),
  );
  const databaseUrl = requireStatusValue(status, "DB_URL");
  const publishableKey =
    status.PUBLISHABLE_KEY ?? status.ANON_KEY ?? null;
  const secretKey = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY ?? null;

  if (!publishableKey || !secretKey) {
    throw new Error("Local Supabase status did not expose required Auth keys.");
  }

  const localEnvironment = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    E2E_BASE_URL: LOCAL_ORIGIN,
    LOCAL_E2E_APP_PORT: String(APP_PORT),
    LOCAL_E2E_DATABASE_URL: databaseUrl,
    LOCAL_E2E_SUPABASE_SECRET_KEY: secretKey,
    NEXT_DIST_DIR: NEXT_DIST_DIRECTORY,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    NEXT_PUBLIC_SUPABASE_URL: API_ORIGIN,
    SITE_URL: LOCAL_ORIGIN,
  };

  console.log("[local-e2e] Applying repository migrations to the isolated database.");
  await runVisible("pnpm.cmd", ["db:migrate"], localEnvironment);

  console.log("[local-e2e] Running authenticated and public Playwright smoke.");
  await runVisible(
    "node_modules\\.bin\\playwright.cmd",
    [
      "test",
      "--config=playwright.local-supabase.config.ts",
      "--workers=1",
    ],
    localEnvironment,
  );
} finally {
  console.log("[local-e2e] Removing isolated Supabase containers and data.");
  await runSupabaseHidden(
    ["stop", "--project-id", PROJECT_ID, "--no-backup"],
    true,
  );
  await rm(join(repoRoot, NEXT_DIST_DIRECTORY), {
    recursive: true,
    force: true,
  });
  await rm(join(repoRoot, PLAYWRIGHT_OUTPUT_DIRECTORY), {
    recursive: true,
    force: true,
  });
  await rm(projectRoot, { recursive: true, force: true });
}

function createLocalSupabaseConfig() {
  return `project_id = "${PROJECT_ID}"

[api]
enabled = true
port = ${API_PORT}
schemas = ["public", "graphql_public"]
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = ${DB_PORT}
shadow_port = ${SHADOW_DB_PORT}
major_version = 17

[db.pooler]
enabled = false

[db.migrations]
enabled = false

[db.seed]
enabled = false

[realtime]
enabled = true

[studio]
enabled = false
port = 55433
api_url = "${API_ORIGIN}"

[local_smtp]
enabled = false
port = 55434

[storage]
enabled = false
file_size_limit = "50MiB"

[auth]
enabled = true
site_url = "${LOCAL_ORIGIN}"
additional_redirect_urls = ["${LOCAL_ORIGIN}/auth/callback"]
jwt_expiry = 3600
enable_refresh_token_rotation = true
refresh_token_reuse_interval = 10
enable_signup = true
enable_anonymous_sign_ins = false
minimum_password_length = 8

[auth.email]
enable_signup = true
double_confirm_changes = true
enable_confirmations = false
secure_password_change = false
max_frequency = "1s"
otp_length = 6
otp_expiry = 3600

[analytics]
enabled = false
port = ${ANALYTICS_PORT}

[edge_runtime]
enabled = false
`;
}

async function runSupabaseHidden(args: string[], allowFailure = false) {
  const result = await runCaptured(
    "pnpm.cmd",
    [
      "dlx",
      `supabase@${SUPABASE_CLI_VERSION}`,
      "--workdir",
      projectRoot,
      "--yes",
      ...args,
    ],
    process.env,
  );

  if (result.exitCode !== 0 && !allowFailure) {
    const diagnostic = sanitizeCommandFailure(
      `${result.stderr}\n${result.stdout}`,
    );
    throw new Error(
      `Local Supabase command failed at ${args[0]} with exit code ${result.exitCode}.${diagnostic ? ` ${diagnostic}` : ""}`,
    );
  }

  return result.stdout;
}

async function runVisible(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
) {
  const exitCode = await runProcess(command, args, environment, "inherit");

  if (exitCode !== 0) {
    throw new Error(`${command} failed with exit code ${exitCode}.`);
  }
}

async function runCaptured(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
) {
  let stdout = "";
  let stderr = "";
  const exitCode = await runProcess(command, args, environment, "pipe", {
    onStdout: (chunk) => {
      stdout += chunk;
    },
    onStderr: (chunk) => {
      stderr += chunk;
    },
  });

  return { exitCode, stdout, stderr };
}

function runProcess(
  command: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  stdio: "inherit" | "pipe",
  callbacks?: {
    onStdout(chunk: string): void;
    onStderr(chunk: string): void;
  },
) {
  return new Promise<number>((resolvePromise, reject) => {
    const child =
      process.platform === "win32"
        ? spawn(
            process.env.ComSpec ?? "cmd.exe",
            ["/d", "/s", "/c", formatWindowsCommand(command, args)],
            {
              cwd: repoRoot,
              env: environment,
              stdio,
              windowsHide: true,
            },
          )
        : spawn(command, args, {
            cwd: repoRoot,
            env: environment,
            stdio,
          });

    child.stdout?.on("data", (chunk: Buffer) => {
      callbacks?.onStdout(chunk.toString("utf8"));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      callbacks?.onStderr(chunk.toString("utf8"));
    });
    child.on("error", reject);
    child.on("exit", (code) => resolvePromise(code ?? 1));
  });
}

function formatWindowsCommand(command: string, args: string[]) {
  return [command, ...args].map(quoteWindowsArgument).join(" ");
}

function quoteWindowsArgument(value: string) {
  if (/^[A-Za-z0-9_./\\:@=,+-]+$/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}

function parseStatusEnvironment(output: string) {
  return Object.fromEntries(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => /^[A-Z0-9_]+=/.test(line))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator);
        const rawValue = line.slice(separator + 1);
        return [key, stripMatchingQuotes(rawValue)];
      }),
  );
}

function stripMatchingQuotes(value: string) {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function sanitizeCommandFailure(output: string) {
  const safeLines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/(?:key|token|secret|password|jwt|db_url|api_url|studio_url)/i.test(
          line,
        ),
    )
    .map((line) =>
      line.replace(
        /\b(?:https?|postgres(?:ql)?):\/\/\S+/gi,
        "[redacted-url]",
      ),
    );

  return safeLines.slice(-4).join(" ");
}

function requireStatusValue(
  values: Record<string, string>,
  key: string,
) {
  const value = values[key];

  if (!value) {
    throw new Error(`Local Supabase status is missing ${key}.`);
  }

  return value;
}

async function assertPortsAvailable(ports: number[]) {
  for (const port of ports) {
    await new Promise<void>((resolvePromise, reject) => {
      const server = createServer();
      server.unref();
      server.once("error", () => {
        reject(new Error(`Required local E2E port ${port} is unavailable.`));
      });
      server.listen(port, "127.0.0.1", () => {
        server.close(() => resolvePromise());
      });
    });
  }
}
