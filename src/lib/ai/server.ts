import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Current Sonnet unless ANTHROPIC_MODEL says otherwise (PLAN.md decision 2).
export const DEFAULT_MODEL = "claude-sonnet-5-5";

export function aiModel(): string {
  return process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL;
}

export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
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
  return Response.json({ error: "AI drafting is off: ANTHROPIC_API_KEY is not set." }, { status: 503 });
}

export function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export function upstreamError(exc: unknown) {
  const message = exc instanceof Anthropic.APIError ? `Claude returned ${exc.status ?? "an error"}` : "Claude call failed";
  return Response.json({ error: message }, { status: 502 });
}
