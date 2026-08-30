/**
 * Fixed prompt/conversation message identity admitted across the HTTP/DOM boundary.
 * Keep this deliberately narrower than an arbitrary backend string: it must be safe
 * in a response header and a DOM attribute without encoding or truncation.
 */
export const MESSAGE_ID_MAX_LENGTH = 128;
export const MESSAGE_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export function safeMessageId(value) {
  return typeof value === "string"
    && value.length <= MESSAGE_ID_MAX_LENGTH
    && MESSAGE_ID_PATTERN.test(value)
    ? value
    : "";
}
