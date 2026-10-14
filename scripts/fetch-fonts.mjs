// Downloads General Sans from Fontshare before a build or dev server starts.
//
// The ITF Free Font License lets us self-host the font on our own site but not
// make the files available through a public repository, so they are not in git
// (src/app/fonts/*.woff2 is ignored). Each build gets its own copy straight
// from Fontshare, which is what the licence asks of anyone else who builds
// this. Fails closed: a file whose SHA-256 doesn't match is never used.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "app", "fonts");

// From https://api.fontshare.com/v2/css?f[]=general-sans@600,700 on 14 Oct 2026.
const FILES = [
  {
    name: "GeneralSans-Semibold.woff2",
    url: "https://cdn.fontshare.com/wf/K46YRH762FH3QJ25IQM3VAXAKCHEXXW4/ISLWQPUZHZF33LRIOTBMFOJL57GBGQ4B/3ZLMEXZEQPLTEPMHTQDAUXP5ZZXCZAEN.woff2",
    sha256: "94a2a0e1ef59728eb65498ed7fe26e5af7e2858a3a4a278a89ac1f83a0544945",
  },
  {
    name: "GeneralSans-Bold.woff2",
    url: "https://cdn.fontshare.com/wf/KWXO5X3YW4X7OLUMPO4X24HQJGJU7E2Q/VOWUQZS3YLP66ZHPTXAFSH6YACY4WJHT/NIQ54PVBBIWVK3PFSOIOUJSXIJ5WTNDP.woff2",
    sha256: "a29eab9b114f3c631cb24d537400dfb8d0ceea8cc9fb514864a68c4ead960490",
  },
];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

mkdirSync(DIR, { recursive: true });
for (const f of FILES) {
  const path = join(DIR, f.name);
  if (existsSync(path) && sha256(readFileSync(path)) === f.sha256) continue;
  const res = await fetch(f.url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`fetch-fonts: ${f.name}: HTTP ${res.status} from Fontshare`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== f.sha256) {
    throw new Error(`fetch-fonts: ${f.name}: SHA-256 ${got} doesn't match the pinned ${f.sha256}. If Fontshare updated the font, check it and update the pin.`);
  }
  writeFileSync(path, buf);
  console.log(`fetch-fonts: ${f.name} (${buf.length} bytes)`);
}
