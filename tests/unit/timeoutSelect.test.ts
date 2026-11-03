import { expect, it } from "vitest";
import { formatTimeout, parseTimeoutMinutes } from "../../src/TimeoutSelect";

it("describes timeouts in the largest whole unit", () => {
  expect(formatTimeout(0)).toBe("No limit");
  expect(formatTimeout(90)).toBe("90 sec");
  expect(formatTimeout(120)).toBe("2 min");
  expect(formatTimeout(3600)).toBe("1 hour");
  expect(formatTimeout(7200)).toBe("2 hours");
});

it("accepts custom minutes up to the server's 24-hour limit", () => {
  expect(parseTimeoutMinutes(" 45 ")).toBe(2700);
  expect(parseTimeoutMinutes("0.5")).toBe(30);
  expect(parseTimeoutMinutes("1440")).toBe(86400);
});

it.each(["", "abc", "0", "-5", "1441", "0.001", "Infinity"])(
  "rejects %j as a custom timeout",
  (text) => {
    expect(parseTimeoutMinutes(text)).toBeNull();
  },
);
