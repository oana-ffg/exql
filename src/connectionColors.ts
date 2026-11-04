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

const relativeLuminance = (color: string) => {
  const [red, green, blue] = [1, 3, 5].map((start) => {
    const channel = parseInt(color.slice(start, start + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};
const darkInk = "#10151c";
const lightInk = "#ffffff";

/** Whichever text color has the higher WCAG contrast on a solid connection color. */
export function connectionInk(color: string) {
  const luminance = relativeLuminance(color);
  return (luminance + 0.05) / (relativeLuminance(darkInk) + 0.05) >
    1.05 / (luminance + 0.05)
    ? darkInk
    : lightInk;
}

export function connectionColorStyle(color?: string | null): CSSProperties {
  return {
    "--connection-color": color,
    "--connection-ink": color ? connectionInk(color) : undefined,
  } as CSSProperties;
}
