import { RAW } from "@/lib/seed/files";

// Each seed dry-run file as a static download, built once. Pages no longer
// carry the files in their bundle; WithFiles fetches the ones a page needs
// here, after the page has painted from its server HTML.

export async function generateStaticParams() {
  return Object.keys(RAW).map((id) => ({ file: `${id}.jsonl` }));
}

export async function GET(_request: Request, { params }: RouteContext<"/seed/dryruns/[file]">) {
  const { file } = await params;
  const text = file.endsWith(".jsonl") ? RAW[file.slice(0, -".jsonl".length)] : undefined;
  if (text === undefined) return new Response("Not found", { status: 404 });
  return new Response(text, { headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
}
