import { describe, expect, it } from "vitest";
import { moveById } from "../../src/reorder";

const items = ["a", "b", "c", "d"].map((id) => ({ id }));
const order = (...args: [string, string, "before" | "after"]) =>
  moveById(items, ...args)
    .map((item) => item.id)
    .join("");

describe("moveById", () => {
  it("moves an item to either side of the target, in both directions", () => {
    expect(order("a", "c", "before")).toBe("bacd");
    expect(order("a", "c", "after")).toBe("bcad");
    expect(order("d", "b", "before")).toBe("adbc");
    expect(order("d", "b", "after")).toBe("abdc");
  });

  it("keeps the order when there is nothing to move", () => {
    expect(order("a", "a", "after")).toBe("abcd");
    expect(order("missing", "a", "before")).toBe("abcd");
    expect(order("a", "missing", "before")).toBe("abcd");
    expect(order("a", "b", "before")).toBe("abcd");
  });
});
