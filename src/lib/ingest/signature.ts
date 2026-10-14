// Webhook signatures: HMAC-SHA256 over "<timestamp>.<raw body bytes>" with the
// deployment's 32-byte secret, sent as "v1=<64 hex>". The timestamp is
// signed too, so a captured request can't be replayed with a fresh one.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { LIMITS } from "./types";

const SIGNATURE = /^v1=([0-9a-f]{64})$/;
const TIMESTAMP = /^\d{10}$/;
const SECRET = /^[0-9a-f]{64}$/;

/** A new secret: 32 random bytes, shown to a person as 64 hex characters. */
export function newSecret(): Buffer {
  return randomBytes(32);
}

export function secretToText(secret: Uint8Array): string {
  return Buffer.from(secret).toString("hex");
}

/** Parses a secret as a person pastes it. Null unless it is exactly 64 hex characters. */
export function secretFromText(text: string): Buffer | null {
  const t = text.trim().toLowerCase();
  return SECRET.test(t) ? Buffer.from(t, "hex") : null;
}

function mac(secret: Uint8Array, timestamp: string, body: Uint8Array): Buffer {
  return createHmac("sha256", secret).update(timestamp, "ascii").update(".", "ascii").update(body).digest();
}

/** The header value a sender puts in X-Ziplime-Signature. */
export function sign(secret: Uint8Array, timestamp: string, body: Uint8Array): string {
  return `v1=${mac(secret, timestamp, body).toString("hex")}`;
}

export type Headers = { timestamp: string | null; signature: string | null };

/** Both headers in their exact shape, or null. Nothing loose gets near the comparison. */
export function parseHeaders(h: Headers): { timestamp: string; digest: Buffer } | null {
  if (!h.timestamp || !h.signature || !TIMESTAMP.test(h.timestamp)) return null;
  const m = SIGNATURE.exec(h.signature);
  return m ? { timestamp: h.timestamp, digest: Buffer.from(m[1], "hex") } : null;
}

/** Constant time over two 32-byte digests. */
export function signatureMatches(secret: Uint8Array, timestamp: string, body: Uint8Array, digest: Buffer): boolean {
  const expected = mac(secret, timestamp, body);
  return digest.length === expected.length && timingSafeEqual(digest, expected);
}

export function timestampFresh(timestamp: string, now: Date): boolean {
  return Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp)) <= LIMITS.clockSkew;
}

/** A key that matches nothing, so an unknown deployment costs the same HMAC as a real one. */
export const DUMMY_SECRET = randomBytes(32);

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}
