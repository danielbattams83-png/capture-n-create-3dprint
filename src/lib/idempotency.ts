import { createHash } from "node:crypto";

function stableValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableValue(item)).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableValue(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function createIdempotencyKey(parts: Record<string, unknown>): string {
  return createHash("sha256").update(stableValue(parts)).digest("hex");
}

export function readIdempotencyNonce(value: unknown): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string" || !/^[\w-]{8,80}$/.test(value)) {
    throw new Error("The idempotency nonce is invalid.");
  }
  return value;
}
