import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { AI_OFF_MESSAGE, aiAccess, aiRequestProblem, type AiAccess } from "./access";

// Current Sonnet unless ANTHROPIC_MODEL says otherwise (PLAN.md decision 2).
export const DEFAULT_MODEL = "claude-sonnet-5-5";

export function aiModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

/** The data mode is inlined at build time (next.config.ts), so it is read by name here, not from the env object. */
export function access(): AiAccess {
  return aiAccess({ ...process.env, CONSOLE_DATA_MODE: process.env.CONSOLE_DATA_MODE });
}

export function aiEnabled(): boolean {
  return access().enabled;
}

/** null without a key: every caller has a deterministic fallback. */
export function aiClient(): Anthropic | null {
  return aiEnabled() ? new Anthropic() : null;
}

/** The text of a plain (non-tool) response. */
export function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

export function aiOff() {
  const a = access();
  return Response.json({ error: AI_OFF_MESSAGE[a.enabled ? "no_key" : a.reason] }, { status: 503 });
}

/** Same origin and JSON, or the response that refuses the request. */
export function aiRequestRefused(request: Request): Response | null {
  const problem = aiRequestProblem(request);
  return problem ? Response.json({ error: problem.error }, { status: problem.status }) : null;
}

export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export function upstreamError(exc: unknown) {
  const message = exc instanceof Anthropic.APIError ? `Claude returned ${exc.status ?? "an error"}` : "Claude call failed";
  return Response.json({ error: message }, { status: 502 });
}
