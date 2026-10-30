import { cp, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { FullConfig } from "@playwright/test";

export default async function cleanup(config: FullConfig) {
  const directory = resolve(config.metadata.dataDirectory as string);
  if (
    dirname(directory) !== resolve(tmpdir()) ||
    !/^exql-host-/.test(basename(directory))
  )
    throw new Error(
      `Refusing to clean an unexpected host directory: ${directory}`,
    );
  await cp(directory, "artifacts/host-state", { recursive: true });
  await rm(directory, { recursive: true });
}
