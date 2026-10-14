import { connection } from "next/server";
import { access, aiModel } from "@/lib/ai/server";

// Tells the client whether Claude is available. Never returns the key.
export async function GET() {
  await connection();
  const a = access();
  return Response.json(a.enabled ? { enabled: true, model: aiModel() } : { enabled: false, model: null, reason: a.reason });
}
