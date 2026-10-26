import { describe, expect, it } from "vitest";
import {
  connectionColors,
  nextConnectionColor,
} from "../../src/connectionColors";

describe("connection colors", () => {
  it("assigns distinct defaults until the palette is used", () => {
    const used: string[] = [];
    for (const _option of connectionColors)
      used.push(nextConnectionColor(used));
    expect(new Set(used).size).toBe(connectionColors.length);
  });

  it("compares custom colors without case sensitivity and reuses the least used preset", () => {
    const used = connectionColors.map((option) => option.value.toUpperCase());
    used.push(connectionColors[0].value);
    expect(nextConnectionColor(used)).toBe(connectionColors[1].value);
    expect(nextConnectionColor(["#123456", null, undefined])).toBe(
      connectionColors[0].value,
    );
  });
});
