/**
 * Host half of the alpha.4 spike. Presentation-only by design: the stock DSH
 * host already owns transport, runtime, static presentation, and authentication.
 */
export const name = "qq-ui-alpha4-spike";

/** No QQ service, endpoint, transport, cache, or presentation server is installed. */
export function apply() {}
