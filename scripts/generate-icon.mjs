import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

// Resize the shared image into the sizes used by Windows Explorer and the taskbar.
const source = await readFile(new URL("../public/exql.png", import.meta.url));
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const browser = await chromium.launch({ channel: "msedge" });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.setContent(
    `<style>body{margin:0}img{display:block;width:100%;height:100%}</style><img src="data:image/png;base64,${source.toString("base64")}" alt="" />`,
  );
  await page.locator("img").evaluate((image) => image.decode());
  const images = [];
  for (const size of sizes) {
    await page.setViewportSize({ width: size, height: size });
    images.push(await page.screenshot({ omitBackground: true }));
  }
  const header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2); // ICO format.
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(images[index].length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += images[index].length;
  });
  await writeFile(
    new URL("../public/exql.ico", import.meta.url),
    Buffer.concat([header, ...images]),
  );
  console.log(
    `Generated public/exql.ico (${sizes.join(", ")} px) from public/exql.png`,
  );
} finally {
  await browser.close();
}
