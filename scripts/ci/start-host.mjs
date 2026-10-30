import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

const log = createWriteStream("artifacts/devhost.log", { flags: "a" });
const child = spawn(
  "dotnet",
  [
    "run",
    "--project",
    "devhost",
    "--no-launch-profile",
    "--",
    "--DataDirectory",
    process.env.EXQL_TEST_DATA_DIRECTORY,
  ],
  { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
);
child.stdout.pipe(log, { end: false });
child.stderr.pipe(log, { end: false });
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  log.end();
  process.exitCode = code ?? 1;
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
