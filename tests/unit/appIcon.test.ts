import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const pngSignature = "89504e470d0a1a0a";
const read = (name: string) =>
  readFileSync(new URL(`../../public/${name}`, import.meta.url));

it("has a square source image with an alpha channel", () => {
  const png = read("exql.png");
  expect(png.subarray(0, 8).toString("hex")).toBe(pngSignature);
  expect(png.readUInt32BE(16)).toBe(png.readUInt32BE(20));
  // Colour type 6 is RGBA: taskbars show the icon on light and dark backgrounds.
  expect(png[25]).toBe(6);
});

it("has every size Windows asks for, as PNG images inside the ICO", () => {
  const ico = read("exql.ico");
  const count = ico.readUInt16LE(4);
  const sizes = [];
  for (let index = 0; index < count; index++) {
    const entry = 6 + index * 16;
    // A stored width of 0 means 256 in the ICO format.
    sizes.push(ico[entry] || 256);
    const offset = ico.readUInt32LE(entry + 12);
    expect(ico.subarray(offset, offset + 8).toString("hex")).toBe(pngSignature);
  }
  expect(sizes).toEqual([16, 20, 24, 32, 40, 48, 64, 128, 256]);
});
