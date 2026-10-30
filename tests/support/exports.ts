// Node's source-aware JSON reviver preserves every numeric digit while still
// distinguishing JSON numbers, booleans, strings, and null in export assertions.
export function exactJson(
  text: string,
): Record<string, string | boolean | { number: string } | null>[] {
  const parse = JSON.parse as (
    text: string,
    reviver: (
      key: string,
      value: unknown,
      context: { source?: string },
    ) => unknown,
  ) => ReturnType<typeof exactJson>;
  return parse(text, (_key, value, context) => {
    if (typeof value !== "number") return value;
    if (!context.source)
      throw new Error("This Node version lacks source-aware JSON parsing.");
    return { number: context.source };
  });
}

export function csvForRows(rows: Record<string, unknown>[]) {
  const quote = (value: unknown) =>
    value === null ? "" : `"${String(value).replaceAll('"', '""')}"`;
  return (
    [
      Object.keys(rows[0]).map(quote).join(","),
      ...rows.map((row) => Object.values(row).map(quote).join(",")),
    ].join("\n") + "\n"
  );
}

export function normalizeCsv(text: string) {
  return text.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
}
