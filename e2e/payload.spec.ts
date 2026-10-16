import { expect, test } from "@playwright/test";

// What a first visit downloads (15 Oct 2026). Every page used to ship all 14
// dry-run files in a shared JavaScript chunk, and three pages sent only a
// skeleton, painting their content after the scripts ran. Lighthouse's
// simulated phone charged both to the largest paint. Now a page gets the files
// it reads in its own payload (WithFiles), and none in any script.

const PAGES = ["/", "/portal", "/ops", "/ops/accounts/wen-li", "/ops/intake", "/ops/inbox", "/ops/automations", "/about"];
// A raw engine line, as the file has it ("recorded_at": "2026-..."), plain or
// escaped inside a JSON string. The parser's own code names the keys, so a key
// alone would match the bundle; a key with a value only matches data.
const RAW_LINE = /recorded_at\\?": \\?"20\d\d-/;

// Pages that read no dry-run file must not receive one at all.
const NO_FILES = new Set(["/ops/intake", "/about"]);

test("no script carries the dry-run files, and pages that read none don't receive them", async ({ request, isMobile }) => {
  test.skip(isMobile, "the same bytes on both sizes");
  const found: string[] = [];
  for (const path of PAGES) {
    const html = await (await request.get(path)).text();
    if (NO_FILES.has(path) && RAW_LINE.test(html)) found.push(`${path}: HTML`);
    const chunks = [...new Set(html.match(/\/_next\/static\/[\w/.-]+\.js/g) ?? [])];
    for (const c of chunks) {
      if (RAW_LINE.test(await (await request.get(c)).text())) found.push(`${path}: ${c}`);
    }
  }
  expect(found).toEqual([]);
});

test("the pages driven by the address render their content on the server, not only a skeleton", async ({ request, isMobile }) => {
  test.skip(isMobile, "the same HTML on both sizes");
  const cases: [string, string][] = [
    ["/portal", "Growth rotation"],
    ["/ops/inbox", "Half the mean-reversion orders refused"],
    ["/ops/intake", "kate.obrien@example.com"],
  ];
  for (const [path, content] of cases) {
    const html = await (await request.get(path)).text();
    expect(html, path).toContain("data-default-view");
    expect(html, path).toContain(content);
  }
});
