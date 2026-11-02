import { test as base, expect } from "@playwright/test";
import { databaseName, DisposableDatabase } from "./database";

export { expect };
export const test = base.extend<{ isolatedDatabase: void }>({
  page: async ({ page, request }, use) => {
    const sessions = new Set<string>();
    const responses: Promise<void>[] = [];
    page.on("response", (response) => {
      if (
        response.ok() &&
        /\/api\/(connect|profiles\/[^/]+\/connect)$/.test(response.url())
      )
        responses.push(
          response.json().then(
            ({ id }) => {
              sessions.add(id);
            },
            (error: Error) => {
              // A reload discards the bodies of responses it interrupted.
              if (!error.message.includes("No resource with given identifier"))
                throw error;
            },
          ),
        );
    });
    await use(page);
    // The body of a response interrupted by a reload may never arrive. The server
    // retires that session when the next page load connects, so stop waiting.
    await Promise.race([
      Promise.all(responses),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    // Aborting a failed journey's query also releases its per-session gate.
    const cancel = page.locator(".cancel-button:visible");
    if (!page.isClosed() && (await cancel.count())) await cancel.click();
    for (const id of sessions) {
      const response = await request.delete(`/api/sessions/${id}`);
      expect([204, 404], await response.text()).toContain(response.status());
    }
  },
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
          const folders = await request.get("/api/script-folders");
          expect(folders.ok(), await folders.text()).toBe(true);
          for (const { id } of await folders.json()) {
            const response = await request.delete(`/api/script-folders/${id}`);
            expect(response.ok(), await response.text()).toBe(true);
          }
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
