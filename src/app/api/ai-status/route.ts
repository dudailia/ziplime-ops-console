import { connection } from "next/server";
import { aiEnabled, aiModel } from "@/lib/ai/server";

// Tells the client whether Claude is available. Never returns the key.
export async function GET() {
  await connection();
  const enabled = aiEnabled();
  return Response.json({ enabled, model: enabled ? aiModel() : null });
}
