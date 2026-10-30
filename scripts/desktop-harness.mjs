import { execFileSync, spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

export async function assertFreePort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}

export async function attachDesktop(port, version) {
  const endpoint = `http://127.0.0.1:${port}`;
  await expect
    .poll(
      async () => {
        try {
          const response = await fetch(`${endpoint}/json/list`, {
            signal: AbortSignal.timeout(1500),
          });
          return (
            response.ok &&
            (await response.json()).some((target) =>
              target.url?.startsWith("http://127.0.0.1:"),
            )
          );
        } catch (error) {
          console.log(`Waiting for desktop CDP: ${error.message}`);
          return false;
        }
      },
      { timeout: 45_000 },
    )
    .toBe(true);
  const browser = await chromium.connectOverCDP(endpoint);
  let page;
  await expect
    .poll(
      () => {
        page = browser
          .contexts()
          .flatMap((context) => context.pages())
          .find((page) => page.url().startsWith("http://127.0.0.1:"));
        return !!page;
      },
      {
        timeout: 30_000,
        message: "Wait for the native WebView to navigate to ExQL",
      },
    )
    .toBe(true);
  const context = page.context();
  await page.waitForFunction(() => window.exqlWorkspaceReady);
  if (version)
    await expect(page.locator(".update-version")).toHaveText(`ExQL ${version}`);
  return { browser, context, page };
}

export async function launchDesktop(root, port, extra = []) {
  await assertFreePort(port);
  const log = createWriteStream(join(root, "app.log"), { flags: "a" });
  const child = spawn(
    join(root, "app", "ExQL.exe"),
    [
      "--automation-port",
      String(port),
      "--data-directory",
      join(root, "state"),
      ...extra,
    ],
    { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  child.on("error", (error) => log.write(`${error.stack}\n`));
  child.on("exit", (code) => {
    log.end(`Launcher exited: ${code}\n`);
  });
  return attachDesktop(port);
}

export function closeDesktop(root) {
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-File",
      fileURLToPath(
        new URL("../tests/support/close-desktop.ps1", import.meta.url),
      ),
      "-Executable",
      resolve(root, "app", "current", "ExQL.exe"),
    ],
    { windowsHide: true, stdio: "inherit" },
  );
}

export async function deleteDesktopProfiles(page) {
  if (!page || page.isClosed())
    throw new Error(
      "Cannot clean saved test credentials: desktop page is closed.",
    );
  await page.evaluate(async () => {
    const headers = { "X-Exql-Client": "1" };
    const response = await fetch("/api/profiles", { headers });
    if (!response.ok) throw new Error(`Read test profiles: ${response.status}`);
    for (const { id } of await response.json()) {
      const deleted = await fetch(`/api/profiles/${id}`, {
        method: "DELETE",
        headers,
      });
      if (!deleted.ok)
        throw new Error(`Delete test profile ${id}: ${deleted.status}`);
    }
  });
}
