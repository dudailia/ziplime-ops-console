import { RAW } from "@/lib/seed/files";

// Every seed dry-run file in one static response, for the pages that read all
// of them (front page, accounts, automations): one request instead of 14.
export async function GET() {
  return Response.json(RAW);
}
