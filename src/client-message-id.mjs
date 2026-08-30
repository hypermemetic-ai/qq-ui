/**
 * Browser-owned correlation identity for one prompt admission. This is metadata,
 * never an authoritative qq-core message ID, authorization token, or idempotency
 * key. randomUUID() produces canonical RFC 4122 version-4 values; accepting only
 * that fixed shape keeps the HTTP/DOM boundary unambiguous and safely bounded.
 */
export const CLIENT_MESSAGE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function safeClientMessageId(value) {
  return typeof value === "string" && CLIENT_MESSAGE_ID_PATTERN.test(value)
    ? value.toLowerCase()
    : "";
}

/** Read both the coordinated explicit projection and pending's retained source metadata. */
export function projectedClientMessageId(value) {
  if (!value || typeof value !== "object") return "";
  const candidates = [
    value.clientMessageId,
    value.source?.clientMessageId,
    value.message?.clientMessageId,
    value.message?.source?.clientMessageId,
  ];
  for (const candidate of candidates) {
    const safe = safeClientMessageId(candidate);
    if (safe) return safe;
  }
  return "";
}
