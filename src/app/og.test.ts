// The link preview must render with the network off: every glyph it draws has
// to be in the bundled fonts, or next/og fetches it from Google Fonts.
import { existsSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import OpenGraphImage from "./opengraph-image";

// General Sans is downloaded before dev and build, never committed. Without
// it, JetBrains Mono Bold stands in. That can't hide a fetch: the image loads
// JetBrains Mono Bold anyway, so the stand-in adds no glyph.
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  const readFile = (path: string) =>
    fs.readFile(path.endsWith("GeneralSans-Bold.woff") && !existsSync(path) ? path.replace("fonts/GeneralSans-Bold.woff", "og/JetBrainsMono-Bold.woff") : path);
  return { ...fs, default: { ...fs, readFile }, readFile };
});

afterEach(() => vi.unstubAllGlobals());

it("renders the link preview with the network off", async () => {
  const real = globalThis.fetch;
  const blocked: string[] = [];
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    // next/og loads its own wasm from data: URLs; that isn't the network.
    if (url.startsWith("data:")) return real(input, init);
    blocked.push(url);
    throw new Error(`network is off: ${url}`);
  });
  const png = Buffer.from(await (await OpenGraphImage()).arrayBuffer());
  expect(png.subarray(1, 4).toString()).toBe("PNG");
  expect(blocked).toEqual([]);
});
