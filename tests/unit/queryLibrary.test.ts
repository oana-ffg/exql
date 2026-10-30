import { expect, it } from "vitest";
import { folderPath } from "../../src/queryLibrary";

it("builds saved query folder paths and stops at cycles", () => {
  const library = {
    folders: [
      { id: "a", name: "Scripts", parentId: "" },
      { id: "b", name: "Reports", parentId: "a" },
    ],
    queries: [],
  };
  expect(folderPath(library, "b")).toBe("Scripts / Reports");
  expect(folderPath(library, "missing")).toBe("");
  library.folders[0].parentId = "b";
  expect(folderPath(library, "b")).toBe("Scripts / Reports");
});
