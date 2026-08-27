// qq-ui answerer for DSH `approval/request`.
//
// Missing answerers fail closed. Child chairs (`origin: subagent` / a parent
// session) are rejected immediately so nested work cannot pop Allow/Reject.
// Root operator chairs claim an ask only when the session log already has a
// matching unmatched `approval/asked` (same pairing the host apiproxy uses).
// Operator POST may grant `allowed-once` or reject; abort and plugin dispose
// settle `cancelled`. Grants apply only to the requested action.

function isRootOperatorAgent(agent) {
  const session = agent?.session;
  if (!/^session-[0-9a-f-]{36}$/i.test(session?.id ?? "")) return false;
  const header = session.header ?? {};
  if (header.parentSession || header.parentId || header.parent || header.parent_session) return false;
  if (header.origin === "subagent" || String(session.id).includes("/")) return false;
  return true;
}

const OPERATOR_OUTCOMES = new Set(["allowed-once", "rejected"]);

/** Pair this ask with the newest unmatched `approval/asked` in the log. */
export function matchAskedId(events, req, claimedIds = []) {
  if (!Array.isArray(events)) return undefined;
  const claimed = new Set(claimedIds);
  const decided = new Set();
  const callId = req?.callId ?? null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (event?.type === "approval/decided") {
      const id = event.data?.id;
      if (typeof id === "string" && id) decided.add(id);
      continue;
    }
    if (event?.type !== "approval/asked") continue;
    const id = event.data?.id;
    if (typeof id !== "string" || !id) continue;
    if (decided.has(id) || claimed.has(id)) continue;
    if ((event.data?.callId ?? null) !== callId) continue;
    return id;
  }
  return undefined;
}

function publicView(entry) {
  return {
    id: entry.approvalId,
    toolName: entry.toolName,
    ...(entry.callId === undefined ? {} : { callId: entry.callId }),
    ...(entry.reason === undefined ? {} : { reason: entry.reason }),
  };
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/** In-process pending table plus the waterfall listener. */
export function createApprovalAnswerer() {
  const pending = new Map();

  function settleEntry(entry, outcome) {
    if (!pending.delete(entry.approvalId)) return false;
    entry.signal?.removeEventListener("abort", entry.onAbort);
    entry.resolve(outcome);
    return true;
  }

  function listFor(sessionId) {
    return [...pending.values()]
      .filter((entry) => entry.sessionId === sessionId)
      .map(publicView);
  }

  function pendingFor(sessionId) {
    return listFor(sessionId)[0] ?? null;
  }

  function handleRequest(req, next) {
    if (req?.signal?.aborted === true) return Promise.resolve("cancelled");
    if (!isRootOperatorAgent(req?.agent)) return Promise.resolve("rejected");
    const session = req?.agent?.session;
    const claimed = [...pending.values()].map((entry) => entry.approvalId);
    const approvalId = matchAskedId(session?.events, req, claimed);
    if (approvalId === undefined) return next();
    return new Promise((resolve) => {
      const entry = {
        approvalId,
        sessionId: session.id,
        toolName: req.toolName,
        callId: req.callId,
        reason: req.reason,
        signal: req.signal,
        resolve,
        onAbort() {
          settleEntry(entry, "cancelled");
        },
      };
      pending.set(approvalId, entry);
      req.signal?.addEventListener("abort", entry.onAbort, { once: true });
    });
  }

  function decide(sessionId, approvalId, outcome) {
    if (!OPERATOR_OUTCOMES.has(outcome)) {
      throw fail(422, "approval outcome must be allowed-once or rejected");
    }
    const entry = pending.get(approvalId);
    if (!entry || entry.sessionId !== sessionId) {
      throw fail(404, "approval request is not pending");
    }
    settleEntry(entry, outcome);
    return { status: "ok", outcome };
  }

  function dispose() {
    for (const entry of [...pending.values()]) settleEntry(entry, "cancelled");
  }

  return Object.freeze({
    listFor,
    pendingFor,
    handleRequest,
    decide,
    dispose,
  });
}
