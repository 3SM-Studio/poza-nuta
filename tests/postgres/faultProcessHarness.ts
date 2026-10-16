import { spawn, execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Do not intercept uncaughtException/unhandledRejection. Only the OS process
// boundary can establish that the actual runtime survived a driver fault.
export function runFaultProcess(input: {
  args: string[]; env?: Partial<NodeJS.ProcessEnv>; timeoutMs: number; artifact: string;
}) {
  return new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; timedOut: boolean; output: string }>((resolveResult, reject) => {
    const child = spawn(process.execPath, input.args, {
      cwd: process.cwd(), env: { ...process.env, ...input.env }, windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "", timedOut = false;
    const capture = (chunk: Buffer) => { if (output.length < 128_000) output += chunk.toString("utf8"); };
    child.stdout.on("data", capture); child.stderr.on("data", capture);
    const timer = setTimeout(() => {
      timedOut = true;
      if (process.platform === "win32" && child.pid) {
        execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, error => { if (error && child.exitCode === null) child.kill(); });
      } else child.kill("SIGKILL");
    }, input.timeoutMs);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", async (exitCode, signal) => {
      clearTimeout(timer);
      // Child diagnostics must never expose connection URLs or test credentials.
      const safe = output.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi, "[database URL redacted]")
        .replace(/[A-Za-z0-9_-]{43,}/g, "[long value redacted]");
      try {
        await mkdir(resolve(".artifacts"), { recursive: true });
        await writeFile(resolve(".artifacts", input.artifact), safe, "utf8");
        resolveResult({ exitCode, signal, timedOut, output: safe });
      } catch (error) { reject(error); }
    });
  });
}
