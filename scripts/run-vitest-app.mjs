import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const sanitizedArgs = args.filter((arg) => arg !== "--");
const vitestBin = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../node_modules/vitest/vitest.mjs",
);

const child = spawn(process.execPath, [vitestBin, ...sanitizedArgs], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
