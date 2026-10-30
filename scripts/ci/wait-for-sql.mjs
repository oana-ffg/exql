import { expect } from "@playwright/test";
import { execute } from "../../tests/support/database.ts";

// Readiness polling is restricted to startup, never a retry of a failed journey.
await expect
  .poll(
    async () => {
      try {
        await execute("master", "SELECT 1;");
        return true;
      } catch (error) {
        console.error(`SQL not ready: ${error.message}`);
        return false;
      }
    },
    { timeout: 120_000, intervals: [250, 500, 1000, 2000] },
  )
  .toBe(true);
