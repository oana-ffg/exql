import type { CSSProperties } from "react";
import palette from "../shared/connectionColors.json" with { type: "json" };

export { palette as connectionColors };

export function nextConnectionColor(
  used: readonly (string | null | undefined)[],
) {
  return palette.reduce((best, candidate) =>
    used.filter((color) => color?.toLowerCase() === candidate.value).length <
    used.filter((color) => color?.toLowerCase() === best.value).length
      ? candidate
      : best,
  ).value;
}

export function connectionColorStyle(color?: string | null): CSSProperties {
  return { "--connection-color": color } as CSSProperties;
}
