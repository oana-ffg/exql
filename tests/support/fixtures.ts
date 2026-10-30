import { test as base, expect } from "@playwright/test";
import { databaseName, DisposableDatabase } from "./database";

export { expect };
export const test = base.extend<{ isolatedDatabase: void }>({
  isolatedDatabase: [
    async ({ request }, use) => {
      const database = await new DisposableDatabase(databaseName).create();
      try {
        for (const key of ["scratch", "library"]) {
          const response = await request.post(`/api/workspace/${key}`, {
            data: null,
          });
          expect(response.ok(), await response.text()).toBe(true);
        }
        await use();
      } finally {
        try {
          const profiles = await request.get("/api/profiles");
          expect(profiles.ok(), await profiles.text()).toBe(true);
          for (const { id } of await profiles.json()) {
            const response = await request.delete(`/api/profiles/${id}`);
            expect(response.ok(), await response.text()).toBe(true);
          }
        } finally {
          await database.dispose();
        }
      }
    },
    { auto: true },
  ],
});
