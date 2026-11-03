import { test, expect } from "../support/fixtures";

// The browser is the real decoder, so a damaged image fails here.
test("the app icon decodes at every size with a transparent background", async ({
  page,
}) => {
  await page.goto("/");
  const images = await page.evaluate(async () => {
    async function inspect(blob: Blob) {
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
      const alphaAt = (x: number, y: number) =>
        data[(y * bitmap.width + x) * 4 + 3];
      const last = bitmap.width - 1;
      let softEdge = false;
      for (let index = 3; index < data.length && !softEdge; index += 4)
        softEdge = data[index] > 0 && data[index] < 255;
      return {
        width: bitmap.width,
        height: bitmap.height,
        corners: [
          alphaAt(0, 0),
          alphaAt(last, 0),
          alphaAt(0, last),
          alphaAt(last, last),
        ],
        centre: alphaAt(Math.floor(last / 2), Math.floor(last / 2)),
        softEdge,
      };
    }
    const source = await (await fetch("/exql.png")).blob();
    const ico = await (await fetch("/exql.ico")).arrayBuffer();
    const header = new DataView(ico);
    const frames = [];
    for (let index = 0; index < header.getUint16(4, true); index++) {
      const entry = 6 + index * 16;
      const size = header.getUint32(entry + 8, true);
      const offset = header.getUint32(entry + 12, true);
      frames.push(
        inspect(
          new Blob([ico.slice(offset, offset + size)], { type: "image/png" }),
        ),
      );
    }
    return { source: await inspect(source), frames: await Promise.all(frames) };
  });

  expect(images.source).toEqual({
    width: 1024,
    height: 1024,
    corners: [0, 0, 0, 0],
    centre: 255,
    softEdge: true,
  });
  expect(images.frames.map((frame) => frame.width)).toEqual([
    16, 20, 24, 32, 40, 48, 64, 128, 256,
  ]);
  for (const frame of images.frames) {
    expect(frame.height).toBe(frame.width);
    expect(frame.corners).toEqual([0, 0, 0, 0]);
    expect(frame.centre).toBe(255);
    expect(frame.softEdge).toBe(true);
  }
});
