(() => {
  "use strict";

  /* qq-latency-factory:start */
  const createQQLatencyStudy = (host, options = {}) => {
    const document = host.document;
    const performance = host.performance;
    const storageKey = "qq:latency";
    const configuredLimits = options.limits ?? {};
    const positiveLimit = (value, fallback) => Number.isInteger(value) && value > 0 ? value : fallback;
    const limits = Object.freeze({
      origins: positiveLimit(configuredLimits.origins, 500),
      stages: positiveLimit(configuredLimits.stages, 1000),
      visuals: positiveLimit(configuredLimits.visuals, 2000),
    });
    const now = () => {
      const value = Number(performance?.now?.());
      return Number.isFinite(value) ? value : 0;
    };
    const round = (value) => value === null || value === undefined
      ? null
      : Math.round(value * 1000) / 1000;
    const timeOrigin = Number.isFinite(Number(performance?.timeOrigin))
      ? Number(performance.timeOrigin)
      : Date.now() - now();
    const safeToken = (value, maximum = 48) => String(value ?? "")
      .replace(/[^a-zA-Z0-9_:.@/-]+/g, "_")
      .slice(0, maximum);
    const script = options.script ?? document?.currentScript
      ?? document?.querySelector?.("script[data-latency-endpoint]");
    const normalizeEndpoint = (value) => {
      if (!value) return "";
      try {
        const URLConstructor = host.URL ?? URL;
        const base = new URLConstructor(host.location?.href ?? "http://qq.invalid/");
        const parsed = new URLConstructor(String(value), base);
        return parsed.origin === base.origin ? `${parsed.pathname}${parsed.search}` : "";
      } catch { return ""; }
    };
    const uploadEndpoint = normalizeEndpoint(options.endpoint ?? script?.dataset?.latencyEndpoint ?? "");
    const uploadDebounceMs = Number.isInteger(options.uploadDebounceMs) && options.uploadDebounceMs >= 0
      ? options.uploadDebounceMs
      : 12_000;
    // Mirrors LATENCY_BATCH_LIMITS/MAX_LATENCY_VISUAL_SOURCES in latency-store.mjs.
    // The aggregate body is independently packed below the server's 256 KiB cap.
    const batchLimits = Object.freeze({ origins: 128, stages: 128, visuals: 128 });
    const browserWireBudgetBytes = 220 * 1024;
    // sendBeacon and keepalive fetch share an approximately 64 KiB in-flight
    // quota in major browsers. Leave headroom for other page teardown traffic.
    const unloadWireBudgetBytes = 60 * 1024;
    const maximumVisualSources = 22;
    const makeRunId = () => {
      try {
        const uuid = host.crypto?.randomUUID?.();
        if (uuid) return `page-${safeToken(uuid, 96)}`;
      } catch {}
      try {
        const values = new Uint32Array(4);
        host.crypto?.getRandomValues?.(values);
        if (values.some((value) => value !== 0)) return `page-${[...values].map((value) => value.toString(16)).join("-")}`;
      } catch {}
      return `page-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
    };
    const runId = safeToken(options.runId ?? makeRunId(), 128) || makeRunId();
    const navigationIntentStorageKey = "qq:latency-navigation-intent";
    const navigationIntentValidityMs = 60_000;
    const navigationIntentInterceptCheckMs = 0;
    const navigationTypes = new Set(["navigate", "reload", "back_forward", "prerender"]);
    const sseChannels = new Set([
      "switch-meta", "chrome", "usage", "transcript-reset", "transcript", "live", "queue", "children",
      "popups", "case", "composer-shell", "switch-ready", "ui", "live-append", "live-tool-append",
    ]);
    const sessionSwitchServerTimingFields = [
      "serverViewMs", "serverReadMs", "serverSessionsMs", "serverSheetsMs",
      "serverRenderLoadMs", "serverSurfaceMs", "serverLiveStateMs", "serverFingerprintsMs",
      "serverChromeRenderMs", "serverTranscriptRenderMs", "serverLiveRenderMs", "serverQueueRenderMs",
      "serverPopupsRenderMs", "serverComposerRenderMs", "serverCriticalRenderMs",
    ];
    const maximumSessionSwitchServerTimingMs = 600_000;
    const normalizeSessionSwitchServerTimings = (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).length !== sessionSwitchServerTimingFields.length
        || Object.keys(value).some((field) => !sessionSwitchServerTimingFields.includes(field))) return null;
      const result = {};
      for (const field of sessionSwitchServerTimingFields) {
        const duration = value[field];
        if (typeof duration !== "number" || !Number.isFinite(duration)
          || duration < 0 || duration > maximumSessionSwitchServerTimingMs) return null;
        result[field] = round(duration);
      }
      return result;
    };
    const timingFields = [
      "startTime", "redirectStart", "redirectEnd", "workerStart", "fetchStart", "domainLookupStart",
      "domainLookupEnd", "connectStart", "secureConnectionStart", "connectEnd", "requestStart", "responseStart",
      "responseEnd", "domInteractive", "domContentLoadedEventStart", "domContentLoadedEventEnd", "domComplete",
      "loadEventStart", "loadEventEnd", "duration",
    ];
    const nonZeroTimingFields = new Set(timingFields.filter((field) => !["startTime", "fetchStart"].includes(field)));
    const boundedTiming = (value, { integer = false, allowZero = true } = {}) => {
      const result = Number(value);
      if (!Number.isFinite(result) || result < 0 || result > 1_000_000_000_000
        || (integer && !Number.isSafeInteger(result)) || (!allowZero && result === 0)) return null;
      return round(result);
    };
    const navigationMetadata = () => {
      let entry;
      try { entry = performance?.getEntriesByType?.("navigation")?.[0]; } catch {}
      if (!entry || !navigationTypes.has(entry.type)) return null;
      const result = { type: entry.type };
      for (const field of timingFields) {
        result[field] = boundedTiming(entry[field], { allowZero: !nonZeroTimingFields.has(field) });
      }
      for (const field of ["transferSize", "encodedBodySize", "decodedBodySize"]) {
        result[field] = boundedTiming(entry[field], { integer: true });
      }
      const serverTiming = new Map();
      try {
        for (const timing of Array.from(entry.serverTiming ?? [])) {
          if ((timing?.name === "qq-view" || timing?.name === "qq-render") && !serverTiming.has(timing.name)) {
            const duration = boundedTiming(timing.duration);
            if (duration !== null) serverTiming.set(timing.name, duration);
          }
        }
      } catch {}
      result.serverViewDuration = serverTiming.get("qq-view") ?? null;
      result.serverRenderDuration = serverTiming.get("qq-render") ?? null;
      return result;
    };
    const paintMetadata = () => {
      const result = { firstPaint: null, firstContentfulPaint: null };
      try {
        for (const entry of Array.from(performance?.getEntriesByType?.("paint") ?? [])) {
          const field = entry?.name === "first-paint" ? "firstPaint"
            : entry?.name === "first-contentful-paint" ? "firstContentfulPaint" : null;
          const at = boundedTiming(entry?.startTime, { allowZero: false });
          if (field && at !== null && (result[field] === null || at < result[field])) result[field] = at;
        }
      } catch {}
      return result;
    };
    const safeHandoffId = (value, maximum) => typeof value === "string" && value.length > 0 && value.length <= maximum
      && /^[a-zA-Z0-9_.:@/-]+$/.test(value) ? value : "";
    const consumeNavigationIntent = () => {
      let raw = null;
      try {
        raw = host.sessionStorage?.getItem(navigationIntentStorageKey) ?? null;
        host.sessionStorage?.removeItem(navigationIntentStorageKey);
      } catch {}
      if (!raw) return null;
      let value;
      try { value = JSON.parse(raw); } catch { return null; }
      if (!value || typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).some((key) => !["id", "sourceRunId", "action", "target", "at"].includes(key))) return null;
      const id = safeHandoffId(value.id, 80);
      const sourceRunId = safeHandoffId(value.sourceRunId, 128);
      const action = typeof value.action === "string" && /^NAVIGATE \/[a-zA-Z0-9_:.@/-]*$/.test(value.action)
        ? value.action : "";
      const target = value.target === null || (typeof value.target === "string" && value.target.length <= 180
        && /^[a-zA-Z0-9_:@/-]+(?:#[a-zA-Z0-9_:.@/-]+)?(?:\.[a-zA-Z0-9_:.@/-]+){0,3}$/.test(value.target))
        ? value.target : undefined;
      const at = Number(value.at);
      const intentToNavigationMs = timeOrigin - at;
      const intentToCollectorMs = timeOrigin + now() - at;
      if (!id || !sourceRunId || !action || target === undefined || !Number.isFinite(at) || at < 0
        || intentToNavigationMs < 0 || intentToCollectorMs < intentToNavigationMs
        || intentToCollectorMs > navigationIntentValidityMs) return null;
      return {
        id, sourceRunId, action, target, at: round(at),
        intentToNavigationMs: round(intentToNavigationMs),
        intentToCollectorMs: round(intentToCollectorMs),
      };
    };
    const navigationIntent = consumeNavigationIntent();
    const elementFor = (node) => {
      if (node?.nodeType === 3) return node.parentElement ?? null;
      return node?.nodeType === 1 || typeof node?.tagName === "string" ? node : null;
    };
    const safeTargetLabel = (node) => {
      const element = elementFor(node);
      if (!element) return null;
      const tag = safeToken(String(element.tagName ?? "element").toLowerCase(), 24) || "element";
      const id = safeToken(element.id ?? element.getAttribute?.("id") ?? "");
      let classes = [];
      try {
        classes = Array.from(element.classList ?? String(element.className ?? "").split(/\s+/));
      } catch {}
      const classSuffix = classes.map((entry) => safeToken(entry, 40)).filter(Boolean).slice(0, 3)
        .map((entry) => `.${entry}`).join("");
      return `${tag}${id ? `#${id}` : ""}${classSuffix}`.slice(0, 180);
    };
    const attribute = (element, name) => {
      try { return element?.getAttribute?.(name) ?? null; } catch { return null; }
    };
    const normalizeRoutePath = (value) => {
      const segments = String(value ?? "").split("/");
      for (let index = 0; index < segments.length; index += 1) {
        if (segments[index] === "project" && index + 1 < segments.length) {
          segments[index + 1] = ":project";
          if (index + 2 < segments.length && segments[index + 2] !== "session") {
            segments[index + 2] = ":folder";
          }
        }
        if (segments[index] === "session" && index + 1 < segments.length) segments[index + 1] = ":id";
      }
      return segments.join("/");
    };
    const safePath = (value) => {
      if (!value) return "";
      try {
        const URLConstructor = host.URL ?? URL;
        const parsed = new URLConstructor(String(value), host.location?.href ?? "http://qq.invalid/");
        return safeToken(normalizeRoutePath(parsed.pathname), 160);
      } catch {
        return safeToken(normalizeRoutePath(String(value).split(/[?#]/, 1)[0]), 160);
      }
    };
    const actionForElement = (element) => {
      if (!element) return "";
      for (const verb of ["get", "post", "put", "patch", "delete"]) {
        const path = attribute(element, `hx-${verb}`) ?? attribute(element, `data-hx-${verb}`);
        if (path) return `${verb.toUpperCase()} ${safePath(path)}`;
      }
      const form = String(element.tagName ?? "").toLowerCase() === "form" ? element : element.form;
      const formAction = attribute(element, "formaction") ?? attribute(form, "action");
      if (formAction) {
        const method = safeToken(attribute(element, "formmethod") ?? attribute(form, "method") ?? "get", 12).toUpperCase();
        return `${method || "GET"} ${safePath(formAction)}`;
      }
      const href = attribute(element, "href");
      if (href) return `NAVIGATE ${safePath(href)}`;
      const type = safeToken(attribute(element, "type") ?? "", 24);
      return type ? `control:${type.toLowerCase()}` : "";
    };
    const keyAction = (key) => {
      const named = {
        Enter: "enter", Escape: "escape", Tab: "tab", Backspace: "edit", Delete: "edit",
        ArrowUp: "navigation", ArrowDown: "navigation", ArrowLeft: "navigation", ArrowRight: "navigation",
        PageUp: "navigation", PageDown: "navigation", Home: "navigation", End: "navigation",
        " ": "space", Spacebar: "space",
      };
      if (named[key]) return `key:${named[key]}`;
      return String(key ?? "").length === 1 ? "key:text" : "key:control";
    };
    const interactionControl = (node) => {
      const element = elementFor(node);
      if (!element) return null;
      try {
        return element.closest?.("button, a, input, select, textarea, summary, form, [role=button], [role=link], [tabindex]") ?? element;
      } catch { return element; }
    };
    const relatedTargets = (left, right) => {
      if (!left || !right) return false;
      if (left === right || left.form === right || right.form === left || (left.form && left.form === right.form)) return true;
      try { if (left.contains?.(right) || right.contains?.(left)) return true; } catch {}
      return false;
    };

    let active = false;
    let startedAt = null;
    let startedAtISO = null;
    let origins = [];
    let stages = [];
    let visuals = [];
    let dropped = { origins: 0, stages: 0, visuals: 0 };
    const cumulativeRingBufferDrops = { origins: 0, stages: 0, visuals: 0 };
    const entrySequences = { origins: 0, stages: 0, visuals: 0 };
    const acknowledged = { origins: 0, stages: 0, visuals: 0 };
    const uploadDropped = { origins: 0, stages: 0, visuals: 0 };
    const uploadCounters = {
      attempts: 0,
      successes: 0,
      failures: 0,
      quarantinedBatches: 0,
      unloadAttempts: 0,
      beaconsQueued: 0,
    };
    let uploadTimer = 0;
    let uploadInFlight = false;
    let retryBatch = null;
    let batchSequence = 0;
    let lastUploadAttemptAt = null;
    let lastUploadSuccessAt = null;
    let lastUploadError = null;
    let originSequence = 0;
    let requestSequence = 0;
    let latestInteraction = null;
    let recentGesture = null;
    let activeRequest = null;
    const maximumAdmissionCandidates = 32;
    // Conversation sequence numbers are scoped to one session. Retain enough
    // identities to survive settled-window eviction/replacement without
    // allowing a long-lived console tab to grow this set without bound.
    const maximumKnownUserSequences = 4096;
    let admissionCandidates = [];
    let knownUserSequences = new Set();
    let sessionSwitchSequence = 0;
    let activeSessionSwitch = null;
    let navigationIntentTimer = 0;
    let navigationIntentInterceptTimer = 0;
    let writtenNavigationIntentId = "";
    let originByEvent = new WeakMap();
    let originByTarget = new WeakMap();
    let requestByXhr = new WeakMap();
    let observer = null;
    let frameRequest = 0;
    let pendingVisual = null;
    let lastExplicitKey = null;
    let lastExplicitSample = null;
    const cleanups = [];

    const appendBounded = (kind, entry) => {
      const list = kind === "origins" ? origins : kind === "stages" ? stages : visuals;
      entry.sequence = ++entrySequences[kind];
      if (list.length >= limits[kind]) {
        const evicted = list.shift();
        dropped[kind] += 1;
        cumulativeRingBufferDrops[kind] += 1;
        const retainedForRetry = retryBatch?.payload?.[kind]?.some((candidate) => candidate.sequence === evicted.sequence);
        if (evicted.sequence > acknowledged[kind] && !retainedForRetry) uploadDropped[kind] += 1;
      }
      list.push(entry);
      scheduleUpload();
      return entry;
    };
    const addTarget = (target) => {
      const label = safeTargetLabel(target);
      if (label && pendingVisual.targets.size < 12) pendingVisual.targets.add(label);
    };
    const requestContextFor = (request) => request ? {
      id: request.id,
      originId: request.origin?.id ?? null,
      originAt: request.origin?.at ?? null,
      dispatchAt: request.dispatchAt,
    } : null;
    const captureRequestContext = () => requestContextFor(activeRequest);
    const ensurePending = () => {
      if (!pendingVisual) pendingVisual = {
        sources: new Set(),
        mutationCount: 0,
        targets: new Set(),
        // Capture this when the DOM signal occurs. afterRequest may clear the
        // global request before the pending aggregate reaches its rAF flush.
        requestContext: captureRequestContext(),
        requestPrimed: false,
        admissionPrimed: false,
        sessionSwitchId: activeSessionSwitch?.id ?? null,
      };
      return pendingVisual;
    };
    const addSignal = (source, target, mutationCount = 0) => {
      ensurePending();
      // A pre-dispatch input signal can share a frame with a post-dispatch
      // response mutation. Upgrade null/older context when request evidence is
      // present, but never let a later null signal erase captured evidence.
      if (activeRequest && !pendingVisual.requestPrimed) pendingVisual.requestContext = captureRequestContext();
      if (!pendingVisual.sessionSwitchId && activeSessionSwitch) pendingVisual.sessionSwitchId = activeSessionSwitch.id;
      if (pendingVisual.sources.has(source) || pendingVisual.sources.size < maximumVisualSources) {
        pendingVisual.sources.add(source);
      }
      pendingVisual.mutationCount += mutationCount;
      addTarget(target);
    };
    const latestInteractionAt = (at) => ({
      latestInteractionId: latestInteraction?.id ?? null,
      latestInteractionLatencyMs: latestInteraction ? round(at - latestInteraction.at) : null,
    });
    const requestCorrelationAt = (at, request = null) => ({
      activeRequestId: request?.id ?? null,
      activeRequestOriginId: request?.originId ?? null,
      activeRequestLatencyMs: request?.originAt !== null && request?.originAt !== undefined
        ? round(at - request.originAt)
        : null,
      networkDispatchLatencyMs: request?.dispatchAt !== null && request?.dispatchAt !== undefined
        ? round(at - request.dispatchAt)
        : null,
    });
    const makeVisual = (at) => ({
      at: round(at),
      sources: [...pendingVisual.sources].sort(),
      mutationCount: pendingVisual.mutationCount,
      targets: [...pendingVisual.targets].sort(),
      ...latestInteractionAt(at),
      ...requestCorrelationAt(at, pendingVisual.requestContext),
      sessionSwitchId: pendingVisual.sessionSwitchId,
    });
    const mergePendingInto = (sample, at) => {
      sample.at = round(at);
      sample.sources = [...new Set([...sample.sources, ...pendingVisual.sources])].sort();
      sample.mutationCount += pendingVisual.mutationCount;
      sample.targets = [...new Set([...sample.targets, ...pendingVisual.targets])].sort().slice(0, 12);
      Object.assign(sample, latestInteractionAt(at));
      // Never erase an initial response association merely because a later
      // same-opportunity signal arrived after request completion.
      if (!sample.activeRequestId) Object.assign(sample, requestCorrelationAt(at, pendingVisual.requestContext));
      if (!sample.sessionSwitchId) sample.sessionSwitchId = pendingVisual.sessionSwitchId;
    };
    const finishPresentedSessionSwitch = (sample) => {
      if (activeSessionSwitch?.baselineCommitted
        && activeSessionSwitch?.readyAt !== null && activeSessionSwitch?.readyAt !== undefined
        && sample?.sessionSwitchId === activeSessionSwitch.id && sample.at >= activeSessionSwitch.readyAt) {
        activeSessionSwitch = null;
      }
    };
    const flushVisual = () => {
      frameRequest = 0;
      if (!pendingVisual) return null;
      const sample = makeVisual(now());
      pendingVisual = null;
      lastExplicitKey = null;
      lastExplicitSample = null;
      const result = appendBounded("visuals", sample);
      finishPresentedSessionSwitch(result);
      return result;
    };
    const scheduleVisual = () => {
      if (frameRequest || typeof host.requestAnimationFrame !== "function") return;
      frameRequest = host.requestAnimationFrame(flushVisual);
    };
    const signalVisual = (source, target) => {
      if (!active) return;
      addSignal(source, target);
      scheduleVisual();
    };
    const conversationSequenceFor = (node) => {
      let raw = null;
      try { raw = node?.getAttribute?.("data-seq") ?? node?.dataset?.seq ?? null; } catch {}
      const value = typeof raw === "string" && /^[1-9][0-9]*$/.test(raw) ? Number(raw) : NaN;
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    };
    const fixedMessageId = (value) => typeof value === "string"
      && value.length <= 128
      && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)
      ? value
      : "";
    const conversationMessageIdFor = (node) => {
      try { return fixedMessageId(node?.getAttribute?.("data-message-id") ?? node?.dataset?.messageId ?? ""); } catch { return ""; }
    };
    const responseMessageIdFor = (event) => {
      try { return fixedMessageId(event?.detail?.xhr?.getResponseHeader?.("X-QQ-Message-Id")); } catch { return ""; }
    };
    const isUserConversationNode = (node) => {
      try { return node?.matches?.(".message-user[data-seq]") === true; } catch { return false; }
    };
    const userNodesWithin = (node) => {
      const result = [];
      if (isUserConversationNode(node)) result.push(node);
      try { result.push(...Array.from(node?.querySelectorAll?.(".message-user[data-seq]") ?? [])); } catch {}
      return result;
    };
    const rememberUserSequence = (sequence) => {
      if (sequence === null || knownUserSequences.has(sequence)) return;
      knownUserSequences.add(sequence);
      while (knownUserSequences.size > maximumKnownUserSequences) {
        knownUserSequences.delete(knownUserSequences.values().next().value);
      }
    };
    const rememberExistingUserNodes = () => {
      try {
        for (const node of Array.from(document?.querySelectorAll?.(".message-user[data-seq]") ?? [])) {
          rememberUserSequence(conversationSequenceFor(node));
        }
      } catch {}
    };
    const recommissionUserSequenceBaseline = () => {
      knownUserSequences = new Set();
      rememberExistingUserNodes();
    };
    const appendAdmissionStage = (kind, request, { conversationSequence = null, at = now(), target = null } = {}) => {
      const completedAt = request?.completedAt ?? null;
      return appendBounded("stages", {
        at: round(at),
        event: "qq:promptAdmission",
        kind,
        requestId: request?.id ?? null,
        originId: request?.origin?.id ?? null,
        originLatencyMs: request?.origin ? round(at - request.origin.at) : null,
        dispatchLatencyMs: request?.dispatchAt !== null && request?.dispatchAt !== undefined
          ? round(at - request.dispatchAt) : null,
        requestCompleteLatencyMs: completedAt !== null ? round(at - completedAt) : null,
        conversationSequence,
        channel: null,
        sessionSwitchId: null,
        target: safeTargetLabel(target) ?? request?.target ?? null,
        action: request?.action ?? "",
      });
    };
    const detectPromptAdmissions = (records) => {
      // Incoming bootstrap nodes belong to the new session's existing body.
      // Ignore even already-delivered MutationObserver records until the
      // validated switch-ready/adopt boundary snapshots the complete body.
      if (activeSessionSwitch && !activeSessionSwitch.baselineCommitted) return;
      const discovered = new Map();
      for (const record of records ?? []) {
        if (record?.type !== "childList") continue;
        for (const added of Array.from(record?.addedNodes ?? [])) {
          for (const node of userNodesWithin(added)) {
            const sequence = conversationSequenceFor(node);
            if (sequence !== null && !knownUserSequences.has(sequence)) discovered.set(sequence, node);
          }
        }
      }
      for (const [sequence, node] of [...discovered.entries()].sort((left, right) => left[0] - right[0])) {
        if (knownUserSequences.has(sequence)) continue;
        rememberUserSequence(sequence);
        const messageId = conversationMessageIdFor(node);
        let request = null;
        if (messageId) {
          const exactIndex = admissionCandidates.findIndex((candidate) => candidate.messageId === messageId);
          if (exactIndex >= 0) [request] = admissionCandidates.splice(exactIndex, 1);
        } else {
          // Explicitly retained/proven compatibility heuristic for legacy pairs
          // where neither the response nor authoritative node has identity.
          // Identity-bearing external nodes categorically never enter this FIFO.
          request = admissionCandidates.find((candidate) => !candidate.messageId) ?? null;
          if (request) admissionCandidates.splice(admissionCandidates.indexOf(request), 1);
        }
        const at = now();
        appendAdmissionStage(request ? "prompt-admitted" : "prompt-admission-unmatched", request, {
          conversationSequence: sequence,
          at,
        });
        if (request) {
          const pending = ensurePending();
          if (!pending.admissionPrimed) {
            pending.requestContext = requestContextFor(request);
            pending.requestPrimed = true;
            pending.admissionPrimed = true;
          }
          addTarget(node);
        }
      }
    };
    const mergeMutations = (records, { schedule = true } = {}) => {
      if (!active || !records?.length) return;
      detectPromptAdmissions(records);
      for (const record of records) {
        const type = record?.type === "childList" || record?.type === "characterData" || record?.type === "attributes"
          ? record.type
          : "other";
        addSignal(`mutation:${type}`, record?.target, 1);
      }
      if (schedule) scheduleVisual();
    };
    const markStreamPaint = (target, opportunity = null) => {
      if (!active) return null;
      mergeMutations(observer?.takeRecords?.() ?? [], { schedule: false });
      addSignal("stream-paint", target);
      if (frameRequest) {
        host.cancelAnimationFrame?.(frameRequest);
        frameRequest = 0;
      }
      const at = now();
      if (opportunity !== null && opportunity === lastExplicitKey
        && lastExplicitSample && visuals[visuals.length - 1] === lastExplicitSample) {
        mergePendingInto(lastExplicitSample, at);
        pendingVisual = null;
        finishPresentedSessionSwitch(lastExplicitSample);
        return lastExplicitSample;
      }
      const sample = makeVisual(at);
      pendingVisual = null;
      appendBounded("visuals", sample);
      finishPresentedSessionSwitch(sample);
      lastExplicitKey = opportunity;
      lastExplicitSample = sample;
      return sample;
    };

    const rememberOriginFor = (event, target, origin) => {
      if (event && typeof event === "object") originByEvent.set(event, origin);
      const control = interactionControl(target);
      if (control && typeof control === "object") originByTarget.set(control, origin);
      const form = control?.form ?? (String(control?.tagName ?? "").toLowerCase() === "form" ? control : null);
      if (form && typeof form === "object") originByTarget.set(form, origin);
    };
    const canDedupe = (type, target, at) => {
      if (!recentGesture || at - recentGesture.at > 1500 || !relatedTargets(recentGesture.target, target)) return false;
      if (recentGesture.type === "pointerdown") return type === "click" || type === "submit" || type === "change" || type === "beforeinput";
      if (recentGesture.type === "keydown") return type === "click" || type === "submit" || type === "change" || type === "beforeinput" || type === "keydown-repeat";
      return recentGesture.type === "click" && (type === "submit" || type === "change");
    };
    const captureInteraction = (event) => {
      if (!active || event?.isTrusted !== true) return;
      const eventType = event.type;
      if ((eventType === "pointerdown" || eventType === "click") && event.button !== undefined && event.button !== 0) return;
      if (eventType === "keydown" && (event.isComposing || ["Shift", "Control", "Alt", "Meta"].includes(event.key))) return;
      if (!["pointerdown", "click", "keydown", "beforeinput", "submit", "change"].includes(eventType)) return;
      const target = interactionControl(event.submitter ?? event.target);
      if (!target) return;
      const at = now();
      const dedupeType = eventType === "keydown" && event.repeat ? "keydown-repeat" : eventType;
      if (canDedupe(dedupeType, target, at)) {
        rememberOriginFor(event, target, recentGesture.origin);
        return;
      }
      const elementAction = actionForElement(target);
      const action = eventType === "keydown" ? keyAction(event.key)
        : eventType === "beforeinput" ? `input:${safeToken(event.inputType ?? "edit", 32) || "edit"}`
          : eventType === "submit" ? (elementAction || "submit")
            : elementAction || eventType;
      const origin = appendBounded("origins", {
        id: `interaction-${++originSequence}`,
        at: round(at),
        type: eventType,
        action,
        target: safeTargetLabel(target),
      });
      latestInteraction = origin;
      recentGesture = { type: eventType, at, target, origin };
      rememberOriginFor(event, target, origin);
    };
    const requestOrigin = (event) => {
      const trigger = event?.detail?.requestConfig?.triggeringEvent;
      const triggerTarget = interactionControl(trigger?.submitter ?? trigger?.target);
      const exact = trigger && originByEvent.get(trigger);
      if (exact) return exact;
      const mappedTarget = triggerTarget && originByTarget.get(triggerTarget);
      if (mappedTarget && now() - mappedTarget.at <= 2000) return mappedTarget;
      return latestInteraction && now() - latestInteraction.at <= 2000 ? latestInteraction : null;
    };
    const requestAction = (event) => {
      const config = event?.detail?.requestConfig;
      const verb = safeToken(config?.verb ?? "", 12).toUpperCase();
      const path = safePath(config?.path ?? event?.detail?.pathInfo?.requestPath ?? "");
      if (verb || path) return `${verb || "REQUEST"}${path ? ` ${path}` : ""}`;
      return actionForElement(event?.detail?.elt ?? event?.target);
    };
    const requestFor = (event, { create = false } = {}) => {
      const xhr = event?.detail?.xhr;
      if (xhr && typeof xhr === "object") {
        const known = requestByXhr.get(xhr);
        if (known) return known;
      }
      if (!create) return null;
      const request = {
        id: `request-${++requestSequence}`,
        origin: requestOrigin(event),
        preparedAt: now(),
        dispatchAt: null,
        target: safeTargetLabel(event?.detail?.elt ?? event?.target),
        action: requestAction(event),
      };
      if (xhr && typeof xhr === "object") requestByXhr.set(xhr, request);
      return request;
    };
    const sseChannelFor = (eventName, event) => {
      if (!eventName.startsWith("htmx:sse")) return null;
      const channel = event?.detail?.type;
      return sseChannels.has(channel) ? channel : null;
    };
    const appendStage = (eventName, kind, event, request, extra = {}) => {
      const at = now();
      const channel = extra.channel ?? sseChannelFor(eventName, event);
      const sessionSwitch = activeSessionSwitch;
      const stage = appendBounded("stages", {
        at: round(at),
        event: eventName,
        kind,
        requestId: request?.id ?? null,
        originId: request?.origin?.id ?? null,
        originLatencyMs: request?.origin ? round(at - request.origin.at) : null,
        dispatchLatencyMs: request?.dispatchAt !== null && request?.dispatchAt !== undefined
          ? round(at - request.dispatchAt)
          : null,
        requestCompleteLatencyMs: null,
        conversationSequence: null,
        channel,
        sessionSwitchId: sessionSwitch?.id ?? null,
        target: request?.target ?? safeTargetLabel(event?.detail?.elt ?? event?.target),
        action: request?.action ?? requestAction(event),
        ...extra,
      });
      return stage;
    };
    const onBeforeRequest = (event) => {
      const request = requestFor(event, { create: true });
      appendStage("htmx:beforeRequest", "request-prepared", event, request);
    };
    const onBeforeSend = (event) => {
      const request = requestFor(event, { create: true });
      activeRequest = request;
      if (request.dispatchAt === null) request.dispatchAt = now();
      appendStage("htmx:beforeSend", "network-dispatch", event, request);
    };
    const isComposerPromptRequest = (request, event) => {
      if (!request || request.dispatchAt === null || request.dispatchAt === undefined
        || !/\/prompt$/.test(request.action ?? "")) return false;
      const element = event?.detail?.elt ?? event?.target;
      try { return element?.matches?.("form#composer, #composer") === true || element?.id === "composer"; } catch { return false; }
    };
    const requestSucceeded = (event) => {
      if (event?.detail?.successful === true) return true;
      if (event?.detail?.failed === true || event?.detail?.successful === false) return false;
      const status = Number(event?.detail?.xhr?.status);
      return Number.isInteger(status) && status >= 200 && status < 400;
    };
    const onRequestStage = (eventName, kind) => (event) => {
      // SSE events only inherit a request when their own XHR identifies one;
      // a completed prompt is not evidence that a later stream update is its.
      const request = requestFor(event);
      appendStage(eventName, kind, event, request);
      if (eventName === "htmx:afterSwap" && request) {
        const pending = ensurePending();
        pending.requestContext = requestContextFor(request);
        pending.requestPrimed = true;
      }
      if (eventName === "htmx:afterRequest" && request && !request.admissionCompleted
        && isComposerPromptRequest(request, event)) {
        request.admissionCompleted = true;
        request.completedAt = now();
        if (requestSucceeded(event)) {
          request.messageId = responseMessageIdFor(event);
          appendAdmissionStage("prompt-admission-pending", request, { at: request.completedAt });
          admissionCandidates.push(request);
          while (admissionCandidates.length > maximumAdmissionCandidates) admissionCandidates.shift();
        } else {
          appendAdmissionStage("prompt-admission-failed", request, { at: request.completedAt });
          admissionCandidates = admissionCandidates.filter((candidate) => candidate !== request);
        }
      }
      if (eventName === "htmx:afterRequest" && activeRequest === request) {
        activeRequest = null;
        const primed = pendingVisual;
        if (primed && primed.sources.size === 0) {
          const enqueue = host.queueMicrotask ?? (typeof queueMicrotask === "function" ? queueMicrotask : null);
          enqueue?.(() => {
            if (pendingVisual === primed && pendingVisual.sources.size === 0) pendingVisual = null;
          });
        }
      }
    };
    const markPromptLocalEcho = (xhr, target = null) => {
      if (!active || !xhr || (typeof xhr !== "object" && typeof xhr !== "function")) return false;
      const request = requestByXhr.get(xhr);
      if (!request || request.localEchoMarked) return false;
      request.localEchoMarked = true;
      appendAdmissionStage("prompt-local-echo", request, { target });
      return true;
    };
    const clearWrittenNavigationIntent = (id = writtenNavigationIntentId) => {
      if (!id) return;
      try {
        const raw = host.sessionStorage?.getItem(navigationIntentStorageKey);
        const value = raw ? JSON.parse(raw) : null;
        if (value?.id === id) host.sessionStorage?.removeItem(navigationIntentStorageKey);
      } catch {}
      if (writtenNavigationIntentId === id) {
        writtenNavigationIntentId = "";
        if (navigationIntentTimer) host.clearTimeout?.(navigationIntentTimer);
        if (navigationIntentInterceptTimer) host.clearTimeout?.(navigationIntentInterceptTimer);
        navigationIntentTimer = 0;
        navigationIntentInterceptTimer = 0;
      }
    };
    const markNavigationIntent = (value, target = null, sessionSwitchId = null, interceptedEvent = null) => {
      if (!active) return null;
      let destination;
      let current;
      try {
        const URLConstructor = host.URL ?? URL;
        current = new URLConstructor(host.location?.href ?? "http://qq.invalid/");
        destination = new URLConstructor(String(value ?? ""), current);
      } catch { return null; }
      if (destination.origin !== current.origin || !/^https?:$/.test(destination.protocol)
        || (destination.pathname === current.pathname && destination.search === current.search)) return null;
      let random = "";
      try { random = host.crypto?.randomUUID?.() ?? ""; } catch {}
      const id = `intent-${safeToken(random || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, 64)}`;
      const switchAt = sessionSwitchId && activeSessionSwitch?.id === sessionSwitchId
        ? activeSessionSwitch.at : now();
      const handoff = {
        id,
        sourceRunId: runId,
        action: `NAVIGATE ${safePath(destination.href)}`,
        target: safeTargetLabel(target),
        at: round(timeOrigin + switchAt),
      };
      try { host.sessionStorage?.setItem(navigationIntentStorageKey, JSON.stringify(handoff)); } catch { return null; }
      writtenNavigationIntentId = id;
      if (navigationIntentTimer) host.clearTimeout?.(navigationIntentTimer);
      if (navigationIntentInterceptTimer) host.clearTimeout?.(navigationIntentInterceptTimer);
      if (typeof host.setTimeout === "function") {
        // Check after event propagation so an in-document router/HTMX handler
        // has had a chance to prevent the native navigation. A fixed short
        // expiry would erase precisely the multi-second pre-script handoffs we
        // need to retain while the old document waits for the next response.
        if (interceptedEvent) {
          navigationIntentInterceptTimer = host.setTimeout(() => {
            navigationIntentInterceptTimer = 0;
            if (interceptedEvent.defaultPrevented) clearWrittenNavigationIntent(id);
          }, navigationIntentInterceptCheckMs);
        }
        navigationIntentTimer = host.setTimeout(() => clearWrittenNavigationIntent(id), navigationIntentValidityMs);
      }
      return id;
    };
    const captureNavigationIntent = (event) => {
      if (!active || event?.isTrusted !== true || event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      let link;
      try { link = elementFor(event.target)?.closest?.("a[href]"); } catch {}
      if (!link || attribute(link, "download") !== null) return;
      const target = attribute(link, "target");
      if (target && target.toLowerCase() !== "_self") return;
      markNavigationIntent(attribute(link, "href") ?? link.href, link, null, event);
    };
    const listen = (target, type, listener, options) => {
      if (!target?.addEventListener) return;
      target.addEventListener(type, listener, options);
      cleanups.push(() => target.removeEventListener(type, listener, options));
    };
    const install = () => {
      rememberExistingUserNodes();
      for (const type of ["pointerdown", "click", "keydown", "beforeinput", "submit", "change"]) {
        listen(document, type, captureInteraction, true);
      }
      listen(document, "click", captureNavigationIntent, true);
      for (const type of ["beforeinput", "input", "change", "toggle", "focusin", "focusout", "scroll", "selectionchange", "invalid"]) {
        listen(document, type, (event) => signalVisual(type, event.target), { capture: true, passive: type === "scroll" });
      }
      for (const type of ["resize", "scroll", "orientationchange", "pageshow", "popstate", "hashchange"]) {
        listen(host, type, (event) => signalVisual(`window:${type}`, event.target), { capture: true, passive: type === "scroll" });
      }
      for (const type of ["resize", "scroll"]) {
        listen(host.visualViewport, type, (event) => signalVisual(`visualViewport:${type}`, event.target), { passive: true });
      }
      listen(host, "pagehide", flushUploadOnHide, true);
      listen(document, "htmx:beforeRequest", onBeforeRequest, true);
      listen(document, "htmx:beforeSend", onBeforeSend, true);
      for (const [eventName, kind] of [
        ["htmx:beforeSwap", "response-before-swap"],
        ["htmx:afterSwap", "response-after-swap"],
        ["htmx:afterSettle", "response-after-settle"],
        ["htmx:afterRequest", "request-complete"],
        ["htmx:sseOpen", "sse-open"],
        ["htmx:sseBeforeMessage", "sse-message-before"],
        ["htmx:sseMessage", "sse-message-after"],
      ]) listen(document, eventName, onRequestStage(eventName, kind), true);
      if (typeof host.MutationObserver === "function") {
        observer = new host.MutationObserver((records) => mergeMutations(records));
        const root = document?.documentElement ?? document;
        if (root) observer.observe(root, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
      }
    };
    const setStored = (value) => {
      try { host.sessionStorage?.setItem(storageKey, value); } catch {}
    };
    const start = () => {
      if (active) return api;
      active = true;
      if (startedAt === null) {
        startedAt = now();
        try { startedAtISO = new Date(timeOrigin + startedAt).toISOString(); } catch { startedAtISO = null; }
      }
      setStored("1");
      install();
      scheduleUpload();
      return api;
    };
    const stop = () => {
      if (active) {
        active = false;
        while (cleanups.length) cleanups.pop()();
        observer?.disconnect?.();
        observer = null;
        if (frameRequest) host.cancelAnimationFrame?.(frameRequest);
        frameRequest = 0;
        pendingVisual = null;
        lastExplicitKey = null;
        lastExplicitSample = null;
        if (uploadTimer) host.clearTimeout?.(uploadTimer);
        uploadTimer = 0;
        if (navigationIntentTimer) host.clearTimeout?.(navigationIntentTimer);
        if (navigationIntentInterceptTimer) host.clearTimeout?.(navigationIntentInterceptTimer);
        clearWrittenNavigationIntent();
        admissionCandidates = [];
        activeSessionSwitch = null;
      }
      setStored("0");
      return api;
    };
    const clear = () => {
      for (const [kind, list] of [["origins", origins], ["stages", stages], ["visuals", visuals]]) {
        uploadDropped[kind] += list.filter((entry) => entry.sequence > acknowledged[kind]).length;
        acknowledged[kind] = entrySequences[kind];
      }
      retryBatch = null;
      if (uploadTimer) host.clearTimeout?.(uploadTimer);
      uploadTimer = 0;
      origins = [];
      stages = [];
      visuals = [];
      dropped = { origins: 0, stages: 0, visuals: 0 };
      latestInteraction = null;
      recentGesture = null;
      activeRequest = null;
      admissionCandidates = [];
      recommissionUserSequenceBaseline();
      activeSessionSwitch = null;
      originByEvent = new WeakMap();
      originByTarget = new WeakMap();
      requestByXhr = new WeakMap();
      if (frameRequest) host.cancelAnimationFrame?.(frameRequest);
      frameRequest = 0;
      pendingVisual = null;
      observer?.takeRecords?.();
      lastExplicitKey = null;
      lastExplicitSample = null;
      startedAt = active ? now() : null;
      try { startedAtISO = active ? new Date(timeOrigin + startedAt).toISOString() : null; } catch { startedAtISO = null; }
      return api;
    };
    const uiMetadata = () => {
      const marker = document?.querySelector?.("#ui-generation");
      return {
        generation: safeToken(script?.dataset?.uiGeneration ?? "", 120) || null,
        revision: safeToken(marker?.dataset?.uiRevision ?? script?.dataset?.uiRevision ?? "", 120) || null,
      };
    };
    const viewportMetadata = () => {
      const visual = host.visualViewport;
      return {
        width: Number(host.innerWidth) || null,
        height: Number(host.innerHeight) || null,
        devicePixelRatio: Number(host.devicePixelRatio) || null,
        visual: visual ? {
          width: Number(visual.width) || null,
          height: Number(visual.height) || null,
          scale: Number(visual.scale) || null,
        } : null,
      };
    };
    const pendingUploadCounts = () => ({
      origins: origins.filter((entry) => entry.sequence > acknowledged.origins).length,
      stages: stages.filter((entry) => entry.sequence > acknowledged.stages).length,
      visuals: visuals.filter((entry) => entry.sequence > acknowledged.visuals).length,
    });
    const hasPendingUploads = () => {
      const pending = pendingUploadCounts();
      return pending.origins + pending.stages + pending.visuals > 0;
    };
    const pageMetadata = () => ({
      timeOrigin,
      startedAt: startedAt === null ? null : round(startedAt),
      startedAtISO,
      navigation: navigationMetadata(),
      ...paintMetadata(),
      navigationIntent,
      ui: uiMetadata(),
      viewport: viewportMetadata(),
      userAgent: String(host.navigator?.userAgent ?? "").slice(0, 512),
    });
    const healthMetadata = () => ({
      generated: { ...entrySequences },
      acknowledged: { ...acknowledged },
      ringBufferDrops: { ...cumulativeRingBufferDrops },
      uploadDrops: { ...uploadDropped },
      quarantineCount: uploadCounters.quarantinedBatches,
    });
    const utf8Bytes = (body) => {
      const Encoder = host.TextEncoder ?? (typeof TextEncoder === "function" ? TextEncoder : null);
      if (Encoder) {
        try { return new Encoder().encode(body).byteLength; } catch {}
      }
      const BlobConstructor = host.Blob ?? (typeof Blob === "function" ? Blob : null);
      if (BlobConstructor) {
        try { return new BlobConstructor([body]).size; } catch {}
      }
      // Conservative dependency-free UTF-8 fallback. Unpaired surrogates use
      // the replacement character's three bytes; valid pairs use four.
      let bytes = 0;
      for (let index = 0; index < body.length; index += 1) {
        const code = body.charCodeAt(index);
        if (code <= 0x7f) bytes += 1;
        else if (code <= 0x7ff) bytes += 2;
        else if (code >= 0xd800 && code <= 0xdbff
          && index + 1 < body.length
          && body.charCodeAt(index + 1) >= 0xdc00 && body.charCodeAt(index + 1) <= 0xdfff) {
          bytes += 4;
          index += 1;
        } else bytes += 3;
      }
      return bytes;
    };
    const encodePayload = (payload) => {
      const frozenPayload = JSON.parse(JSON.stringify(payload));
      const body = JSON.stringify(frozenPayload);
      return { payload: frozenPayload, body, bytes: utf8Bytes(body) };
    };
    const createUploadBatch = (wireBudgetBytes = browserWireBudgetBytes, preferredPayload = null) => {
      const availableEntries = { origins, stages, visuals };
      const candidates = {};
      for (const kind of ["origins", "stages", "visuals"]) {
        // A transient retry can outlive entries evicted from the live ring. Seed
        // unload packing from its frozen payload, then fill with newer entries.
        const entriesBySequence = new Map();
        for (const entry of preferredPayload?.[kind] ?? []) {
          if (entry.sequence > acknowledged[kind]) entriesBySequence.set(entry.sequence, entry);
        }
        for (const entry of availableEntries[kind]) {
          if (entry.sequence > acknowledged[kind] && !entriesBySequence.has(entry.sequence)) {
            entriesBySequence.set(entry.sequence, entry);
          }
        }
        candidates[kind] = [...entriesBySequence.values()]
          .sort((left, right) => left.sequence - right.sequence)
          .slice(0, batchLimits[kind]);
      }
      if (candidates.origins.length + candidates.stages.length + candidates.visuals.length === 0) return null;
      const payload = {
        schema: "qq.visual-latency-batch/v1",
        runId,
        batchId: `${runId}-${batchSequence + 1}`,
        page: pageMetadata(),
        health: healthMetadata(),
        origins: candidates.origins,
        stages: candidates.stages,
        visuals: candidates.visuals,
      };
      let encoded = encodePayload(payload);
      // Visuals are normally the volume source. If removing all of them is not
      // enough, apply the same monotonic prefix search to stages and origins.
      for (const kind of ["visuals", "stages", "origins"]) {
        if (encoded.bytes <= wireBudgetBytes) break;
        let lower = 0;
        let upper = payload[kind].length;
        let fitting = -1;
        while (lower <= upper) {
          const middle = Math.floor((lower + upper) / 2);
          const trial = { ...payload, [kind]: candidates[kind].slice(0, middle) };
          const trialEncoded = encodePayload(trial);
          if (trialEncoded.bytes <= wireBudgetBytes) {
            fitting = middle;
            lower = middle + 1;
          } else {
            upper = middle - 1;
          }
        }
        payload[kind] = candidates[kind].slice(0, Math.max(0, fitting));
        encoded = encodePayload(payload);
      }
      const entryCount = encoded.payload.origins.length + encoded.payload.stages.length + encoded.payload.visuals.length;
      if (entryCount === 0 || encoded.bytes > wireBudgetBytes) return null;
      batchSequence += 1;
      return {
        ...encoded,
        maxima: {
          origins: encoded.payload.origins.reduce((value, entry) => Math.max(value, entry.sequence), 0),
          stages: encoded.payload.stages.reduce((value, entry) => Math.max(value, entry.sequence), 0),
          visuals: encoded.payload.visuals.reduce((value, entry) => Math.max(value, entry.sequence), 0),
        },
      };
    };
    const acceptAcknowledgement = (body, batch) => {
      if (body?.schema !== "qq.visual-latency-ack/v1" || body.accepted !== true
        || body.runId !== runId || body.batchId !== batch.payload.batchId) {
        throw new Error("invalid latency acknowledgement");
      }
      for (const kind of ["origins", "stages", "visuals"]) {
        const cursor = Number(body.cursors?.[kind]);
        if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > batch.maxima[kind]) {
          throw new Error("invalid latency acknowledgement cursor");
        }
        acknowledged[kind] = Math.max(acknowledged[kind], cursor);
      }
      uploadCounters.successes += 1;
      lastUploadSuccessAt = round(now());
      lastUploadError = null;
      if (retryBatch?.payload.batchId === batch.payload.batchId) retryBatch = null;
      if (!hasPendingUploads() && uploadTimer) {
        host.clearTimeout?.(uploadTimer);
        uploadTimer = 0;
      }
    };
    const recordUploadFailure = (error) => {
      uploadCounters.failures += 1;
      lastUploadError = String(error?.message ?? error ?? "upload failed").slice(0, 160);
    };
    const nonRetryableClientStatus = (status) => Number.isInteger(status)
      && status >= 400 && status < 500 && status !== 408 && status !== 429;
    const quarantineRejectedBatch = (batch, status) => {
      recordUploadFailure(new Error(`latency endpoint rejected batch with ${status}`));
      for (const kind of ["origins", "stages", "visuals"]) {
        uploadDropped[kind] += batch.payload[kind]
          .filter((entry) => entry.sequence > acknowledged[kind] && entry.sequence <= batch.maxima[kind]).length;
        acknowledged[kind] = Math.max(acknowledged[kind], batch.maxima[kind]);
      }
      uploadCounters.quarantinedBatches += 1;
      if (retryBatch?.payload.batchId === batch.payload.batchId) retryBatch = null;
    };
    const handleUploadResponse = async (response, batch) => {
      if (!response?.ok) {
        const status = Number(response?.status);
        if (nonRetryableClientStatus(status)) {
          quarantineRejectedBatch(batch, status);
          return "quarantined";
        }
        throw new Error(`latency endpoint returned ${response?.status ?? "no response"}`);
      }
      acceptAcknowledgement(await response.json(), batch);
      return "acknowledged";
    };
    const attemptUpload = async ({ keepalive = false, preparedBatch = null } = {}) => {
      if (!active || !uploadEndpoint || uploadInFlight || typeof host.fetch !== "function") return false;
      if (uploadTimer) host.clearTimeout?.(uploadTimer);
      uploadTimer = 0;
      const batch = preparedBatch ?? retryBatch ?? createUploadBatch();
      if (!batch) return false;
      // An explicit unload prefix must not replace a larger byte-identical retry.
      if (!retryBatch) retryBatch = batch;
      uploadInFlight = true;
      uploadCounters.attempts += 1;
      if (keepalive) uploadCounters.unloadAttempts += 1;
      lastUploadAttemptAt = round(now());
      let outcome = "transient-failure";
      try {
        const response = await host.fetch(uploadEndpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: batch.body,
          credentials: "omit",
          keepalive,
        });
        outcome = await handleUploadResponse(response, batch);
        return outcome === "acknowledged";
      } catch (error) {
        recordUploadFailure(error);
        return false;
      } finally {
        uploadInFlight = false;
        if (!keepalive && active && hasPendingUploads()) {
          scheduleUpload(outcome === "acknowledged" || outcome === "quarantined" ? 0 : uploadDebounceMs, {
            replace: outcome === "acknowledged" || outcome === "quarantined",
          });
        }
      }
    };
    const scheduleUpload = (delay = uploadDebounceMs, { replace = false } = {}) => {
      if (!active || !uploadEndpoint || typeof host.setTimeout !== "function" || !hasPendingUploads()) return;
      if (uploadTimer) {
        if (!replace) return;
        host.clearTimeout?.(uploadTimer);
        uploadTimer = 0;
      }
      uploadTimer = host.setTimeout(() => {
        uploadTimer = 0;
        void attemptUpload();
      }, delay);
    };
    const flushUploadOnHide = () => {
      // An in-flight fetch is already the page's bounded best effort; do not
      // duplicate it with a beacon during teardown.
      if (!active || !uploadEndpoint || uploadInFlight) return;
      if (uploadTimer) host.clearTimeout?.(uploadTimer);
      uploadTimer = 0;
      const retainedRetry = retryBatch;
      const batch = createUploadBatch(unloadWireBudgetBytes, retainedRetry?.payload);
      if (!batch) return;
      // Keep a normal retry byte-identical. If there was none, retain this
      // unload-sized batch so a page restored from bfcache can retry it safely.
      if (!retryBatch) retryBatch = batch;
      const sendBeacon = host.navigator?.sendBeacon;
      const BlobConstructor = host.Blob ?? (typeof Blob === "function" ? Blob : null);
      if (typeof sendBeacon === "function" && BlobConstructor) {
        uploadCounters.attempts += 1;
        uploadCounters.unloadAttempts += 1;
        lastUploadAttemptAt = round(now());
        try {
          if (sendBeacon.call(host.navigator, uploadEndpoint, new BlobConstructor([batch.body], { type: "application/json" }))) {
            uploadCounters.beaconsQueued += 1;
            return;
          }
        } catch {}
      }
      if (!uploadInFlight) void attemptUpload({ keepalive: true, preparedBatch: batch });
    };

    const markSessionSwitch = (value, target = null) => {
      if (!active) return null;
      const at = now();
      const sessionSwitch = {
        id: `switch-${++sessionSwitchSequence}`,
        at,
        action: `NAVIGATE ${safePath(value)}`,
        target: safeTargetLabel(target),
        origin: latestInteraction && at - latestInteraction.at <= 2_000 ? latestInteraction : null,
        readyAt: null,
        baselineCommitted: false,
        serverTimings: null,
      };
      // A pending prompt from the outgoing transcript cannot safely be matched
      // against historical nodes in the incoming session.
      admissionCandidates = [];
      activeSessionSwitch = sessionSwitch;
      appendBounded("stages", {
        at: round(at),
        event: "qq:sessionSwitch",
        kind: "session-switch-start",
        requestId: null,
        originId: sessionSwitch.origin?.id ?? null,
        originLatencyMs: sessionSwitch.origin ? round(at - sessionSwitch.origin.at) : null,
        dispatchLatencyMs: null,
        requestCompleteLatencyMs: null,
        conversationSequence: null,
        channel: null,
        sessionSwitchId: sessionSwitch.id,
        target: sessionSwitch.target,
        action: sessionSwitch.action,
      });
      return sessionSwitch.id;
    };
    const markSessionSwitchServerTimings = (sessionSwitchId, value) => {
      if (!active || !sessionSwitchId || activeSessionSwitch?.id !== sessionSwitchId
        || activeSessionSwitch.baselineCommitted) return false;
      activeSessionSwitch.serverTimings = normalizeSessionSwitchServerTimings(value);
      return activeSessionSwitch.serverTimings !== null;
    };
    const markSessionSwitchMilestone = (sessionSwitchId, kind, target = null, serverTimings = null) => {
      if (!active || !sessionSwitchId || activeSessionSwitch?.id !== sessionSwitchId
        || !["session-switch-response", "session-switch-ready"].includes(kind)
        || (kind === "session-switch-ready" && activeSessionSwitch.baselineCommitted)) return false;
      const at = now();
      const acceptedServerTimings = kind === "session-switch-ready"
        ? normalizeSessionSwitchServerTimings(serverTimings ?? activeSessionSwitch.serverTimings)
        : null;
      appendBounded("stages", {
        at: round(at),
        event: "qq:sessionSwitch",
        kind,
        requestId: null,
        originId: activeSessionSwitch.origin?.id ?? null,
        originLatencyMs: activeSessionSwitch.origin ? round(at - activeSessionSwitch.origin.at) : null,
        dispatchLatencyMs: null,
        requestCompleteLatencyMs: null,
        conversationSequence: null,
        channel: null,
        sessionSwitchId,
        target: safeTargetLabel(target) ?? activeSessionSwitch.target,
        action: activeSessionSwitch.action,
        ...(acceptedServerTimings ?? {}),
      });
      if (kind === "session-switch-ready") {
        activeSessionSwitch.readyAt = at;
        // This is the only session-namespace reset. Both full-body adoption and
        // validated live bootstrap call this after settled and live transcript
        // frames are present, but before queued replacement mutations run.
        admissionCandidates = [];
        recommissionUserSequenceBaseline();
        activeSessionSwitch.baselineCommitted = true;
        addSignal("mutation:childList", target, 1);
        scheduleVisual();
      }
      return true;
    };
    const snapshot = () => {
      const result = {
        schema: "qq.visual-latency/v1",
        measurement: "visual-ready/presentation-opportunity",
        precision: "normally plus or minus one frame; not exact compositor pixel timing",
        active,
        upload: {
          enabled: Boolean(uploadEndpoint),
          endpoint: uploadEndpoint || null,
          runId,
          debounceMs: uploadDebounceMs,
          wireBudgetBytes: browserWireBudgetBytes,
          unloadWireBudgetBytes,
          scheduled: Boolean(uploadTimer),
          inFlight: uploadInFlight,
          retrying: Boolean(retryBatch),
          acknowledged: { ...acknowledged },
          pending: pendingUploadCounts(),
          dropped: { ...uploadDropped, total: uploadDropped.origins + uploadDropped.stages + uploadDropped.visuals },
          ...uploadCounters,
          lastAttemptAt: lastUploadAttemptAt,
          lastSuccessAt: lastUploadSuccessAt,
          lastError: lastUploadError,
        },
        startedAt: startedAt === null ? null : round(startedAt),
        startedAtISO,
        capturedAt: round(now()),
        timeOrigin,
        navigation: navigationMetadata(),
        ...paintMetadata(),
        navigationIntent,
        ui: uiMetadata(),
        viewport: viewportMetadata(),
        userAgent: String(host.navigator?.userAgent ?? "").slice(0, 512),
        limits: { ...limits },
        latestInteractionId: latestInteraction?.id ?? null,
        pendingAdmissions: admissionCandidates.length,
        activeSessionSwitch: activeSessionSwitch?.id ?? null,
        activeRequest: activeRequest ? {
          id: activeRequest.id,
          originId: activeRequest.origin?.id ?? null,
          preparedAt: round(activeRequest.preparedAt),
          dispatchAt: round(activeRequest.dispatchAt),
          target: activeRequest.target,
          action: activeRequest.action,
        } : null,
        origins,
        stages,
        visuals,
        dropped: { ...dropped, total: dropped.origins + dropped.stages + dropped.visuals },
      };
      return JSON.parse(JSON.stringify(result));
    };
    const summary = () => {
      const firstStages = new Map();
      for (const stage of stages) {
        if (!stage.requestId) continue;
        const key = `${stage.requestId}\u0000${stage.kind}`;
        if (!firstStages.has(key)) firstStages.set(key, stage);
      }
      const seenRequests = new Set();
      const rows = [];
      for (const visual of visuals) {
        if (!visual.activeRequestId || seenRequests.has(visual.activeRequestId)) continue;
        seenRequests.add(visual.activeRequestId);
        const stage = (kind) => firstStages.get(`${visual.activeRequestId}\u0000${kind}`) ?? null;
        const dispatch = stage("network-dispatch");
        rows.push({
          requestId: visual.activeRequestId,
          originId: visual.activeRequestOriginId,
          action: dispatch?.action ?? "",
          firstPresentationSamples: 1,
          interactionToDispatchMs: dispatch?.originLatencyMs ?? null,
          dispatchToInitialResponseMs: stage("response-before-swap")?.dispatchLatencyMs ?? null,
          dispatchToSwapMs: stage("response-after-swap")?.dispatchLatencyMs ?? null,
          dispatchToSettleMs: stage("response-after-settle")?.dispatchLatencyMs ?? null,
          interactionToFirstPresentationMs: visual.activeRequestLatencyMs,
          dispatchToFirstPresentationMs: visual.networkDispatchLatencyMs,
          firstPresentationSources: [...visual.sources],
        });
      }
      return rows;
    };
    const report = () => {
      const rows = summary();
      host.console?.table?.(rows);
      return rows;
    };
    const api = Object.freeze({
      start, stop, clear, snapshot, summary, report, markStreamPaint, markPromptLocalEcho, markNavigationIntent, markSessionSwitch,
      markSessionSwitchResponse: (sessionSwitchId, target) =>
        markSessionSwitchMilestone(sessionSwitchId, "session-switch-response", target),
      markSessionSwitchReady: (sessionSwitchId, target, serverTimings = null) =>
        markSessionSwitchMilestone(sessionSwitchId, "session-switch-ready", target, serverTimings),
      normalizeSessionSwitchServerTimings, markSessionSwitchServerTimings,
    });

    let querySetting = null;
    try {
      const SearchParams = host.URLSearchParams ?? URLSearchParams;
      const requested = new SearchParams(host.location?.search ?? "").get("qq-latency");
      if (requested === "1" || requested === "0") {
        querySetting = requested;
        setStored(requested);
      }
    } catch {}
    if (querySetting === null) {
      try { querySetting = host.sessionStorage?.getItem(storageKey); } catch {}
    }
    if (querySetting !== "0") start();
    return api;
  };
  /* qq-latency-factory:end */

  /* qq-prompt-echo-factory:start */
  const createQQPromptEchoController = (host, options = {}) => {
    const document = host.document;
    const messageIdHeader = "X-QQ-Message-Id";
    const promptOutcomeHeader = "X-QQ-Prompt-Outcome";
    const maximumEchoes = Number.isInteger(options.maximumEchoes) && options.maximumEchoes > 0
      ? options.maximumEchoes
      : 32;
    const maximumAuthoritativeIds = 4096;
    const records = new Set();
    const recordsByXhr = new WeakMap();
    // htmx:configRequest's detail object is the same requestConfig object later
    // exposed by htmx:beforeRequest. Keep the generated identity on that exact
    // in-memory object so rapid/identical submissions cannot cross-bind.
    const configuredClientMessageIds = new WeakMap();
    const recordsByClientMessageId = new Map();
    const recordsByMessageId = new Map();
    const authoritativeClientMessageIds = new Set();
    const authoritativeMessageIds = new Set();
    let commissionedSessionId = "";
    let observer = null;
    let localSequence = 0;
    let disposed = false;

    const safeClientMessageId = (value) => typeof value === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
      ? value.toLowerCase()
      : "";
    const safeMessageId = (value) => typeof value === "string"
      && value.length <= 128
      && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)
      ? value
      : "";
    const isObjectKey = (value) => value !== null
      && (typeof value === "object" || typeof value === "function");
    const hasClass = (node, name) => {
      try { return node?.classList?.contains?.(name) === true; } catch { return false; }
    };
    const setState = (record, state, statusText) => {
      record.state = state;
      record.echo.setAttribute("data-prompt-echo-state", state);
      record.status.textContent = statusText;
    };
    const echoContainer = () => document?.querySelector?.("#prompt-echoes") ?? null;
    const activeContainer = (sessionId = commissionedSessionId) => {
      const container = echoContainer();
      return container && String(container.dataset?.sessionId ?? "") === sessionId
        ? container
        : null;
    };
    const currentSessionId = () => String(options.currentSessionId?.() ?? commissionedSessionId ?? "");
    const removeRecord = (record) => {
      if (!record || !records.has(record)) return false;
      records.delete(record);
      if (isObjectKey(record.xhr)) recordsByXhr.delete(record.xhr);
      for (const [identity, index] of [
        [record.clientMessageId, recordsByClientMessageId],
        [record.messageId, recordsByMessageId],
      ]) {
        if (!identity) continue;
        const matching = index.get(identity);
        matching?.delete(record);
        if (matching?.size === 0) index.delete(identity);
      }
      record.echo?.remove?.();
      return true;
    };
    const clearRecords = () => {
      for (const record of [...records]) removeRecord(record);
      recordsByClientMessageId.clear();
      recordsByMessageId.clear();
    };
    const trimRecords = () => {
      while (records.size > maximumEchoes) removeRecord(records.values().next().value);
    };
    const rememberAuthoritativeId = (index, identity) => {
      if (!identity || index.has(identity)) return;
      index.add(identity);
      while (index.size > maximumAuthoritativeIds) index.delete(index.values().next().value);
    };
    // Either server-owned representation supersedes the local object. Both
    // namespaces are exact metadata; no content, queue order, or DOM position
    // participates. Correlation is available at admission, while message ID is
    // retained as the durable fallback for older core projections.
    const authoritativeSelector = [
      ".message-user[data-client-message-id]", ".queue-item[data-client-message-id]",
      ".message-user[data-message-id]", ".queue-item[data-message-id]",
    ].join(", ");
    const authoritativeIdentity = (node) => {
      if (!node || (!hasClass(node, "message-user") && !hasClass(node, "queue-item"))) return null;
      try {
        if (node.getAttribute?.("data-prompt-echo-state") !== null) return null;
      } catch { return null; }
      const transcript = document?.querySelector?.("#transcript");
      try {
        if (!transcript || (node !== transcript && transcript.contains?.(node) !== true)) return null;
      } catch { return null; }
      let clientMessageId = "";
      let messageId = "";
      try {
        clientMessageId = safeClientMessageId(
          node.getAttribute?.("data-client-message-id") ?? node.dataset?.clientMessageId ?? "",
        );
        messageId = safeMessageId(node.getAttribute?.("data-message-id") ?? node.dataset?.messageId ?? "");
      } catch {}
      return clientMessageId || messageId ? { clientMessageId, messageId } : null;
    };
    const identitiesMatch = (left, right) => {
      if (left?.clientMessageId && right?.clientMessageId) {
        return left.clientMessageId === right.clientMessageId;
      }
      return Boolean(left?.messageId && left.messageId === right?.messageId);
    };
    const retireSupersededQueueRows = (node, identity) => {
      const transcript = document?.querySelector?.("#transcript");
      if (!transcript) return false;
      const user = hasClass(node, "message-user");
      const queue = hasClass(node, "queue-item");
      let changed = false;
      try {
        if (user) {
          for (const candidate of transcript.querySelectorAll?.(".queue-item[data-client-message-id], .queue-item[data-message-id]") ?? []) {
            const candidateIdentity = authoritativeIdentity(candidate);
            if (candidateIdentity && identitiesMatch(identity, candidateIdentity)) {
              candidate.remove?.();
              changed = true;
            }
          }
        } else if (queue) {
          for (const candidate of transcript.querySelectorAll?.(".message-user[data-client-message-id], .message-user[data-message-id]") ?? []) {
            const candidateIdentity = authoritativeIdentity(candidate);
            if (candidateIdentity && identitiesMatch(identity, candidateIdentity)) {
              node.remove?.();
              changed = true;
              break;
            }
          }
        }
      } catch {}
      return changed;
    };
    const reconcileNode = (node) => {
      const identity = authoritativeIdentity(node);
      if (!identity) return false;
      rememberAuthoritativeId(authoritativeClientMessageIds, identity.clientMessageId);
      rememberAuthoritativeId(authoritativeMessageIds, identity.messageId);
      let changed = retireSupersededQueueRows(node, identity);
      const matching = new Set([
        ...(recordsByClientMessageId.get(identity.clientMessageId) ?? []),
        ...(recordsByMessageId.get(identity.messageId) ?? []),
      ]);
      for (const record of matching) {
        removeRecord(record);
        changed = true;
      }
      return changed;
    };
    const reconcile = (root = document) => {
      if (!commissionedSessionId || currentSessionId() !== commissionedSessionId) return false;
      let changed = reconcileNode(root);
      try {
        for (const node of root?.querySelectorAll?.(authoritativeSelector) ?? []) {
          if (reconcileNode(node)) changed = true;
        }
      } catch {}
      return changed;
    };
    // MutationObserver delivery runs at the microtask checkpoint, so a queue or
    // user insert and exact echo removal complete before the browser can paint.
    const onMutations = (mutations) => {
      if (!commissionedSessionId || currentSessionId() !== commissionedSessionId) return;
      for (const mutation of mutations ?? []) {
        if (mutation?.type === "attributes") reconcileNode(mutation.target);
        if (mutation?.type !== "childList") continue;
        for (const node of mutation.addedNodes ?? []) reconcile(node);
      }
    };
    const capturedPrompt = (event, input) => {
      const parameters = event?.detail?.requestConfig?.parameters;
      try {
        if (parameters && typeof parameters.get === "function") {
          const value = parameters.get("prompt");
          if (typeof value === "string") return value;
        }
      } catch {}
      if (parameters && typeof parameters === "object") {
        const value = parameters.prompt;
        if (typeof value === "string") return value;
        if (Array.isArray(value) && typeof value[0] === "string") return value[0];
      }
      return typeof input?.value === "string" ? input.value : "";
    };
    const createClientMessageId = () => {
      try { return safeClientMessageId(host.crypto?.randomUUID?.()); } catch { return ""; }
    };
    const parameterValue = (parameters, name) => {
      try {
        if (parameters && typeof parameters.get === "function") {
          const value = parameters.get(name);
          return typeof value === "string" ? value : "";
        }
      } catch {}
      if (parameters && typeof parameters === "object") {
        const value = parameters[name];
        if (typeof value === "string") return value;
        if (Array.isArray(value) && typeof value[0] === "string") return value[0];
      }
      return "";
    };
    const writeClientMessageId = (parameters, clientMessageId) => {
      if (!clientMessageId) return false;
      try {
        if (parameters && typeof parameters.set === "function") {
          parameters.set("clientMessageId", clientMessageId);
          return parameterValue(parameters, "clientMessageId") === clientMessageId;
        }
        if (parameters && typeof parameters === "object") {
          parameters.clientMessageId = clientMessageId;
          return parameters.clientMessageId === clientMessageId;
        }
      } catch {}
      return false;
    };
    const composerInput = (form) => {
      try {
        const input = form?.querySelector?.("textarea[name='prompt']");
        if (input) return input;
      } catch {}
      return options.composer?.() ?? null;
    };
    const genuineComposerConfiguration = (event) => {
      const requestConfig = event?.detail;
      const form = requestConfig?.elt;
      if (!form || String(form.tagName ?? "").toUpperCase() !== "FORM" || form.id !== "composer") return null;
      const sessionId = String(form.dataset?.sessionId ?? "");
      if (!sessionId || sessionId !== commissionedSessionId || sessionId !== currentSessionId()) return null;
      const container = activeContainer(sessionId);
      const input = composerInput(form);
      if (!container || !input || String(input.tagName ?? "").toUpperCase() !== "TEXTAREA") return null;
      return { requestConfig, form, sessionId, container, input };
    };
    const genuineComposerRequest = (event) => {
      const configuration = genuineComposerConfiguration({ detail: event?.detail?.requestConfig });
      const xhr = event?.detail?.xhr;
      if (!configuration || !isObjectKey(xhr)) return null;
      return { ...configuration, xhr };
    };
    const createEcho = (prompt, request, clientMessageId) => {
      // A direct prompt first appears authoritatively in pending/queue. Use that
      // row's geometry and transcript location from birth; controls stay disabled
      // until the server-owned row replaces this browser-owned object.
      const echo = document.createElement("li");
      echo.className = "queue-item message-queued";
      echo.setAttribute("data-prompt-echo-state", "pending");
      if (clientMessageId) echo.setAttribute("data-client-message-id", clientMessageId);
      echo.setAttribute("data-placement", "queued");
      echo.setAttribute("aria-label", "Queued message");

      const mark = document.createElement("span");
      mark.className = "queue-mark";
      mark.setAttribute("aria-hidden", "true");
      mark.textContent = "◦";

      const content = document.createElement("p");
      content.className = "queue-preview";
      content.textContent = prompt;

      const control = document.createElement("span");
      control.className = "queue-remove";
      const remove = document.createElement("button");
      remove.setAttribute("type", "button");
      remove.setAttribute("disabled", "");
      remove.setAttribute("aria-label", "Message pending admission");
      remove.setAttribute("title", "Pending admission");
      remove.textContent = "×";
      control.append(remove);

      const status = document.createElement("span");
      status.className = "prompt-echo-status";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      status.setAttribute("aria-atomic", "true");
      status.textContent = "Message pending admission";
      echo.append(mark, content, control, status);

      const record = {
        sequence: ++localSequence,
        xhr: request.xhr,
        sessionId: request.sessionId,
        prompt,
        echo,
        status,
        clientMessageId,
        messageId: "",
        state: "pending",
      };
      records.add(record);
      recordsByXhr.set(request.xhr, record);
      if (clientMessageId) {
        const matching = recordsByClientMessageId.get(clientMessageId) ?? new Set();
        matching.add(record);
        recordsByClientMessageId.set(clientMessageId, matching);
      }
      request.container.append(echo);
      trimRecords();
      options.markLocalEcho?.(request.xhr, echo);
      // This also covers an unusual authority-before-observer ordering.
      if (authoritativeClientMessageIds.has(clientMessageId)) removeRecord(record);
      else reconcile(document);
      return record;
    };
    const configRequest = (event) => {
      if (disposed) return false;
      const request = genuineComposerConfiguration(event);
      if (!request || !isObjectKey(request.requestConfig)) return false;
      const clientMessageId = createClientMessageId();
      // HTMX 2.0 copies requestConfig.parameters into the transport FormData
      // immediately after this event. Correlation must therefore be written here,
      // never in beforeRequest, to put identity on the wire from birth.
      if (!writeClientMessageId(request.requestConfig.parameters, clientMessageId)) return false;
      configuredClientMessageIds.set(request.requestConfig, clientMessageId);
      return true;
    };
    const beforeRequest = (event) => {
      if (disposed) return false;
      const request = genuineComposerRequest(event);
      if (!request || recordsByXhr.has(request.xhr)) return false;
      const prompt = capturedPrompt(event, request.input);
      const configuredClientMessageId = configuredClientMessageIds.get(request.requestConfig) ?? "";
      configuredClientMessageIds.delete(request.requestConfig);
      const transportedClientMessageId = safeClientMessageId(
        parameterValue(request.requestConfig.parameters, "clientMessageId"),
      );
      // Only bind identity generated for this exact request configuration. If a
      // legacy HTMX integration omits configRequest (or parameters were altered),
      // retain the durable message-ID fallback without trusting foreign metadata.
      const clientMessageId = configuredClientMessageId === transportedClientMessageId
        ? configuredClientMessageId
        : "";
      createEcho(prompt, request, clientMessageId);
      // HTMX has already captured request parameters. Clearing now cannot alter
      // the admitted bytes and leaves the composer ready for the next draft.
      request.input.value = "";
      options.clearComposerDraft?.(request.sessionId);
      options.fitComposer?.(request.input);
      request.input.blur?.();
      options.anchorTranscript?.();
      return true;
    };
    const requestFailed = (event) => {
      if (event?.detail?.successful === false || event?.detail?.failed === true) return true;
      try {
        if (event?.detail?.xhr?.getResponseHeader?.(promptOutcomeHeader) === "failed") return true;
      } catch {}
      if (event?.detail?.successful === true) return false;
      const status = Number(event?.detail?.xhr?.status);
      return !Number.isInteger(status) || status < 200 || status >= 400;
    };
    const acceptedMessageId = (xhr) => {
      try { return safeMessageId(xhr?.getResponseHeader?.(messageIdHeader)); } catch { return ""; }
    };
    const restoreFailedDraft = (record) => {
      if (record.sessionId !== commissionedSessionId || currentSessionId() !== record.sessionId) return;
      const input = options.composer?.();
      if (!input || String(input.tagName ?? "").toUpperCase() !== "TEXTAREA" || input.value) return;
      input.value = record.prompt;
      options.persistComposerDraft?.(input, record.sessionId);
      options.fitComposer?.(input, { shrink: false });
    };
    const markAccepted = (record, messageId) => {
      if (messageId) {
        record.messageId = messageId;
        record.echo.setAttribute("data-message-id", messageId);
        const matching = recordsByMessageId.get(messageId) ?? new Set();
        matching.add(record);
        recordsByMessageId.set(messageId, matching);
        setState(record, "accepted", "Message accepted");
        // Covers both event orders and old core projections that omit the
        // correlation token but return the durable identity in the POST.
        if (authoritativeMessageIds.has(messageId)) removeRecord(record);
        else reconcile(document);
        return;
      }
      // Successful slash/find/navigation-style prompt routes can intentionally
      // admit no core message. Without authoritative identity there is nothing
      // safe to reconcile, so completion is terminal for the provisional.
      removeRecord(record);
    };
    const afterRequest = (event) => {
      if (disposed) return false;
      const xhr = event?.detail?.xhr;
      if (!isObjectKey(xhr)) return false;
      const record = recordsByXhr.get(xhr);
      if (!record) return false;
      if (requestFailed(event)) {
        removeRecord(record);
        restoreFailedDraft(record);
        return true;
      }
      if (record.sessionId !== commissionedSessionId || currentSessionId() !== record.sessionId) {
        removeRecord(record);
        return true;
      }
      markAccepted(record, acceptedMessageId(xhr));
      const input = options.composer?.();
      if (input && String(input.tagName ?? "").toUpperCase() === "TEXTAREA" && input.value) {
        options.persistComposerDraft?.(input, record.sessionId);
      } else {
        options.clearComposerDraft?.(record.sessionId);
      }
      return true;
    };
    const reset = () => {
      clearRecords();
      authoritativeClientMessageIds.clear();
      authoritativeMessageIds.clear();
      commissionedSessionId = "";
    };
    const commission = (sessionId) => {
      const next = String(sessionId ?? "");
      if (!next) {
        reset();
        return false;
      }
      if (commissionedSessionId !== next) {
        clearRecords();
        authoritativeClientMessageIds.clear();
        authoritativeMessageIds.clear();
      }
      commissionedSessionId = next;
      const container = echoContainer();
      if (!container) return false;
      if (String(container.dataset?.sessionId ?? "") !== next) container.setAttribute("data-session-id", next);
      reconcile(document);
      return true;
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      reset();
      observer?.disconnect?.();
      host.removeEventListener?.("pagehide", reset, true);
    };

    if (typeof host.MutationObserver === "function" && document?.documentElement) {
      observer = new host.MutationObserver(onMutations);
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["data-client-message-id", "data-message-id"],
      });
    }
    host.addEventListener?.("pagehide", reset, true);
    return Object.freeze({ configRequest, beforeRequest, afterRequest, commission, reset, reconcile, dispose });
  };
  /* qq-prompt-echo-factory:end */

  const ownScript = document.currentScript;
  const qqLatency = createQQLatencyStudy(window, { script: ownScript });
  window.qqLatency = qqLatency;
  const desktopChair = () => window.matchMedia("(min-width: 42.01rem)").matches;
  const composer = () => document.querySelector("#prompt");
  const completeSlash = async (input) => {
    if (!(input instanceof HTMLTextAreaElement)) return;
    const line = input.value;
    if (!line.startsWith("/")) return;
    const action = input.form?.getAttribute("action") ?? "";
    if (!action.endsWith("/prompt")) return;
    const url = new URL(action.replace(/\/prompt$/, "/complete"), location.href);
    url.searchParams.set("line", line);
    try {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const body = await response.json();
      if (typeof body.completed !== "string" || body.completed === line) return;
      input.value = body.completed;
      const cursor = body.completed.length;
      input.setSelectionRange(cursor, cursor);
      fitComposer(input);
    } catch {
      /* completion is best-effort */
    }
  };
  const fitComposer = (input = composer(), { shrink = true } = {}) => {
    if (!(input instanceof HTMLTextAreaElement)) return;
    const extras = input.offsetHeight - input.clientHeight;
    if (!shrink) {
      const next = input.scrollHeight + extras;
      if (next > input.offsetHeight) input.style.height = `${next}px`;
      return;
    }
    input.style.height = "auto";
    input.style.height = `${input.scrollHeight + extras}px`;
  };
  try { history.scrollRestoration = "manual"; } catch {}
  const transcriptBottomGap = 48;
  let transcriptView = { follow: true, top: 0 };
  let transcriptProgrammatic = false;
  let transcriptSizeObserver = null;
  const atTranscriptBottom = (transcript) =>
    transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop <= transcriptBottomGap;
  const showLatest = () => {
    const transcript = document.querySelector("#transcript");
    if (!transcript) return;
    transcriptProgrammatic = true;
    transcript.scrollTop = transcript.scrollHeight;
    transcriptView = { follow: true, top: transcript.scrollTop };
    requestAnimationFrame(() => { transcriptProgrammatic = false; });
  };
  const followLatest = () => {
    if (!transcriptView.follow) return;
    showLatest();
    requestAnimationFrame(() => {
      if (transcriptView.follow) showLatest();
    });
  };
  const anchorTranscript = () => {
    transcriptView = { follow: true, top: 0 };
    followLatest();
  };
  const captureTranscriptView = (transcript = document.querySelector("#transcript")) => {
    if (!transcript || transcriptProgrammatic) return;
    // Swaps and token paint must not unanchor. Only a user scroll does that.
    if (transcriptView.follow) return;
    transcriptView = { follow: false, top: transcript.scrollTop };
  };
  const onTranscriptUserScroll = (transcript) => {
    if (!transcript || transcriptProgrammatic) return;
    transcriptView = {
      follow: atTranscriptBottom(transcript),
      top: transcript.scrollTop,
    };
  };
  const bindTranscriptFollow = () => {
    const transcript = document.querySelector("#transcript");
    if (!transcript || typeof ResizeObserver !== "function") return;
    if (!transcriptSizeObserver) {
      transcriptSizeObserver = new ResizeObserver(() => {
        if (transcriptView.follow) showLatest();
      });
    } else {
      transcriptSizeObserver.disconnect();
    }
    transcriptSizeObserver.observe(transcript);
    for (const child of transcript.children ?? []) transcriptSizeObserver.observe(child);
  };
  const restoreTranscriptView = () => {
    const restore = () => {
      const transcript = document.querySelector("#transcript");
      if (!transcript) return;
      if (transcriptView.follow) showLatest();
      else transcript.scrollTop = transcriptView.top;
    };
    restore();
    requestAnimationFrame(restore);
  };
  let swapDraft = null;
  const captureDraft = () => {
    const input = composer();
    const active = document.activeElement;
    if (input instanceof HTMLTextAreaElement) {
      swapDraft = {
        kind: "composer",
        value: input.value,
        focused: active === input,
        start: input.selectionStart,
        end: input.selectionEnd,
      };
      return;
    }
    if (active instanceof HTMLTextAreaElement && active.classList.contains("queue-edit-text")) {
      swapDraft = {
        kind: "queue",
        id: active.dataset.messageId,
        value: active.value,
        focused: true,
        start: active.selectionStart,
        end: active.selectionEnd,
      };
      return;
    }
    swapDraft = { kind: "none", focused: false };
  };
  const restoreDraft = () => {
    const draft = swapDraft;
    swapDraft = null;
    if (!draft) return;
    const input = draft?.kind === "queue"
      ? [...document.querySelectorAll(".queue-edit-text")]
          .find((candidate) => candidate.dataset.messageId === draft.id)
      : composer();
    if (draft?.kind === "composer" && input instanceof HTMLTextAreaElement) {
      if (draft.focused && document.activeElement === input) {
        fitComposer(input, { shrink: false });
        return;
      }
      if (draft.value) input.value = draft.value;
      fitComposer(input, { shrink: false });
    } else if (draft?.kind === "queue" && input instanceof HTMLTextAreaElement) {
      input.value = draft.value;
      fitComposer(input, { shrink: false });
    }
    if (draft?.focused && input instanceof HTMLTextAreaElement) {
      input.focus();
      try { input.setSelectionRange(draft.start, draft.end); } catch {}
      return;
    }
    const prompt = composer();
    if (prompt instanceof HTMLTextAreaElement && prompt === document.activeElement) prompt.blur();
  };
  const prepareSession = () => {
    restoreTranscriptView();
    bindTranscriptFollow();
    syncProviderGapForTurn();
    restorePersistedDraft();
    const input = composer();
    if (input instanceof HTMLTextAreaElement && document.activeElement !== input) {
      fitComposer(input, { shrink: false });
    }
  };
  const submitForm = (selector) => {
    const form = document.querySelector(selector);
    if (form instanceof HTMLFormElement) form.requestSubmit();
  };
  const clickButton = (selector) => {
    const button = document.querySelector(selector);
    if (button instanceof HTMLElement) button.click();
  };
  const currentSessionId = () => {
    const composerForm = document.querySelector("#composer") ?? document.querySelector("#interrupt-form");
    const fromDataset = composerForm?.dataset?.sessionId;
    if (fromDataset) return fromDataset;
    const match = location.pathname.match(/\/session\/(session-[0-9a-fA-F-]{36})(?:\/|$)/);
    return match ? match[1] : "";
  };
  let resetAdoptedSession = () => {};
  let overlaySessionId = "";
  const LIVE_TRACKER_OVERVIEW = "all-projects";
  let liveTrackerProjectFilter = "";
  let liveSessionId = currentSessionId();
  let committedLocation = location.href;
  let pendingCanonical = "";
  let switchGeneration = 0;
  let bootstrapSwitch = null;
  let activeSseSource = null;
  let liveSwitchMeta = null;
  const viewingSessionId = () => overlaySessionId || liveSessionId;
  const composerDraftKey = (sessionId = liveSessionId || currentSessionId()) => (sessionId ? `qq:composer:${sessionId}` : "");
  const persistComposerDraft = (input = composer(), sessionId = liveSessionId || currentSessionId()) => {
    const key = composerDraftKey(sessionId);
    if (!key || !(input instanceof HTMLTextAreaElement)) return;
    try {
      if (input.value) sessionStorage.setItem(key, input.value);
      else sessionStorage.removeItem(key);
    } catch { /* private mode */ }
  };
  const clearComposerDraft = (sessionId = liveSessionId || currentSessionId()) => {
    const key = composerDraftKey(sessionId);
    if (!key) return;
    try { sessionStorage.removeItem(key); } catch { /* private mode */ }
  };
  const restorePersistedDraft = (sessionId = liveSessionId || currentSessionId(), { replace = false } = {}) => {
    const input = composer();
    const key = composerDraftKey(sessionId);
    if (!key || !(input instanceof HTMLTextAreaElement) || (!replace && input.value)) return;
    try {
      const saved = sessionStorage.getItem(key) ?? "";
      if (replace || saved) input.value = saved;
      if (input.value) fitComposer(input, { shrink: false });
    } catch { /* private mode */ }
  };
  const promptEchoes = createQQPromptEchoController(window, {
    currentSessionId: () => liveSessionId,
    composer,
    fitComposer,
    clearComposerDraft,
    persistComposerDraft,
    anchorTranscript,
    markLocalEcho: (xhr, echo) => qqLatency.markPromptLocalEcho?.(xhr, echo),
  });
  promptEchoes.commission(liveSessionId);
  const sessionLinks = () => {
    const seen = new Set();
    const links = [];
    for (const link of document.querySelectorAll(".live-tracker-session[data-session-id]")) {
      const id = link.dataset.sessionId;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      links.push(link);
    }
    return links;
  };
  const sessionIds = () => sessionLinks().map((link) => link.dataset.sessionId).filter(Boolean);
  const LIVE_SESSION_PICKER = ".live-tracker-session[data-session-id], .session-parent a[data-session-id], .session-child[data-session-id]";
  const openSession = (sessionId) => {
    if (!sessionId || sessionId === viewingSessionId()) return;
    const link = sessionLinks().find((entry) => entry.dataset.sessionId === sessionId);
    if (link?.href) void chairGo(link.href, link);
  };

  const formatLiveTrackerElapsed = (milliseconds) => {
    const seconds = Math.max(0, Math.floor(milliseconds / 1000));
    if (seconds < 60) return "";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    return `${Math.floor(minutes / 60)}h`;
  };
  const nextLiveTrackerElapsedUpdate = (milliseconds) => {
    const elapsed = Math.max(0, milliseconds);
    const unit = elapsed < 3_600_000 ? 60_000 : 3_600_000;
    const remainder = elapsed % unit;
    return Math.max(1, Math.ceil(remainder === 0 ? unit : unit - remainder));
  };
  let liveTrackerElapsedTimer = 0;
  const syncLiveTrackerElapsed = () => {
    if (liveTrackerElapsedTimer) clearTimeout(liveTrackerElapsedTimer);
    liveTrackerElapsedTimer = 0;
    const now = Date.now();
    let nextUpdate = null;
    for (const time of document.querySelectorAll(".live-tracker-elapsed[data-phase-started-at]")) {
      const startedAt = Number(time.dataset.phaseStartedAt);
      const valid = Number.isFinite(startedAt) && startedAt >= 0;
      const milliseconds = valid ? Math.max(0, now - startedAt) : 0;
      const formatted = valid ? formatLiveTrackerElapsed(milliseconds) : "";
      time.textContent = formatted;
      time.hidden = !formatted;
      if (valid) {
        const delay = nextLiveTrackerElapsedUpdate(milliseconds);
        nextUpdate = nextUpdate === null ? delay : Math.min(nextUpdate, delay);
      }
    }
    if (nextUpdate !== null) liveTrackerElapsedTimer = setTimeout(syncLiveTrackerElapsed, nextUpdate);
  };

  const confirmingClose = () => document.querySelector(".session-item-current.close-confirming");
  const restoreCloseFocus = () => {
    const arm = document.querySelector(".close-arm");
    if (arm instanceof HTMLElement) arm.focus();
  };
  const disarmClose = () => {
    const row = document.querySelector(".session-item-current");
    const confirm = row?.querySelector(".close-confirm");
    const arm = row?.querySelector(".close-arm");
    if (!row) return;
    row.classList.remove("close-confirming");
    if (confirm) confirm.hidden = true;
    if (arm) arm.hidden = false;
  };
  const armClose = () => {
    const row = document.querySelector(".session-item-current");
    const confirm = row?.querySelector(".close-confirm");
    const arm = row?.querySelector(".close-arm");
    const submit = confirm?.querySelector("button[type=\"submit\"]");
    if (!row || !confirm) return;
    row.classList.add("close-confirming");
    confirm.hidden = false;
    if (arm) arm.hidden = true;
    if (submit instanceof HTMLElement) submit.focus();
  };
  const neighborSession = (delta) => {
    const ids = sessionIds();
    const current = liveSessionId;
    const index = ids.indexOf(current);
    if (index < 0 || ids.length < 2) return;
    openSession(ids[(index + delta + ids.length) % ids.length]);
  };
  const scrollTranscript = (mode) => {
    const transcript = document.querySelector("#transcript");
    if (!transcript) return;
    const page = Math.max(transcript.clientHeight - 48, 80);
    if (mode === "up") transcript.scrollTop -= page;
    if (mode === "down") transcript.scrollTop += page;
    if (mode === "home") transcript.scrollTop = 0;
    if (mode === "end") transcript.scrollTop = transcript.scrollHeight;
  };
  const consoleMenu = () => document.querySelector(".console-menu");
  const consoleMenuChoices = (menu = consoleMenu()) => menu
    ? [...menu.querySelectorAll(".console-menu-choice, .workflows-choice")]
        .filter((choice) => !choice.disabled)
    : [];
  const closeConsoleMenu = (restoreFocus = false) => {
    const menu = consoleMenu();
    if (menu instanceof HTMLDetailsElement && menu.open) {
      menu.open = false;
      if (restoreFocus) menu.querySelector(":scope > summary")?.focus();
      return true;
    }
    return false;
  };
  const openConsoleMenu = () => {
    const menu = consoleMenu();
    if (!(menu instanceof HTMLDetailsElement)) return false;
    menu.open = true;
    const choices = consoleMenuChoices(menu);
    const choice = choices.find((candidate) => candidate.classList.contains("workflows-current")) ?? choices[0];
    choice?.focus();
    return true;
  };
  const handleConsoleMenuKey = (event) => {
    const menu = consoleMenu();
    if (!(menu instanceof HTMLDetailsElement)) return false;
    const summary = menu.querySelector(":scope > summary");
    if (event.key === "Enter" && event.target === summary) {
      event.preventDefault();
      if (menu.open) closeConsoleMenu(true);
      else openConsoleMenu();
      return true;
    }
    if (!menu.open) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      closeConsoleMenu(true);
      return true;
    }
    const choices = consoleMenuChoices(menu);
    const current = choices.indexOf(document.activeElement);
    if (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const fallback = choices.findIndex((choice) => choice.classList.contains("workflows-current"));
      const start = current >= 0 ? current : fallback >= 0 ? fallback : 0;
      const next = event.key === "Home" ? 0
        : event.key === "End" ? choices.length - 1
          : (start + (event.key === "ArrowUp" ? -1 : 1) + choices.length) % choices.length;
      choices[next]?.focus();
      return true;
    }
    if (event.key === "Enter" && current >= 0) {
      event.preventDefault();
      choices[current].click();
      return true;
    }
    return false;
  };
  const usageView = () => document.querySelector("#session-usage");
  const usageViewOpen = () => document.querySelector("#session-panel")?.dataset.consoleView === "usage";
  const syncUsageAction = () => {
    const action = document.querySelector(".usage-choice");
    if (action instanceof HTMLElement) action.setAttribute("aria-expanded", usageViewOpen() ? "true" : "false");
  };
  const showUsageView = ({ focus = true } = {}) => {
    const panel = document.querySelector("#session-panel");
    const view = usageView();
    if (!(panel instanceof HTMLElement) || !(view instanceof HTMLElement)) return false;
    panel.dataset.consoleView = "usage";
    syncUsageAction();
    closeConsoleMenu();
    if (focus) view.querySelector("#usage-heading")?.focus({ preventScroll: true });
    return true;
  };
  const closeUsageView = ({ focus = true } = {}) => {
    const panel = document.querySelector("#session-panel");
    if (!(panel instanceof HTMLElement) || !usageViewOpen()) return false;
    delete panel.dataset.consoleView;
    syncUsageAction();
    if (location.hash === "#session-usage") {
      try { history.replaceState(history.state, "", `${location.pathname}${location.search}`); } catch {}
    }
    restoreTranscriptView();
    if (focus) document.querySelector(".console-menu > summary")?.focus({ preventScroll: true });
    return true;
  };
  const syncUsageView = () => {
    if (location.hash === "#session-usage") showUsageView({ focus: false });
    else syncUsageAction();
  };
  const dismissSheet = () => {
    const ignore = document.querySelector(".offer-ignore");
    if (ignore instanceof HTMLElement) {
      ignore.click();
      return true;
    }
    const workflows = document.querySelector(".workflows-popup");
    if (workflows) {
      workflows.remove();
      return true;
    }
    if (closeConsoleMenu()) return true;
    return false;
  };
  const editingElsewhere = (node) => {
    if (!(node instanceof HTMLElement)) return false;
    const tag = node.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT") return true;
    if (tag === "INPUT") {
      const type = String(node.type || "text").toLowerCase();
      return type !== "button" && type !== "submit" && type !== "reset" && type !== "checkbox" && type !== "radio";
    }
    return node.isContentEditable;
  };

  const activeProjectItems = () => [...document.querySelectorAll(".active-project-item[data-project][href]")];
  const projectRailItems = () => [...document.querySelectorAll(".active-project-item[href]")];
  const projectIdentity = (entry) => `${String(entry?.project ?? "")}\n${String(entry?.folder ?? "")}`;
  const activeProjectEntry = (item) => ({
    project: String(item?.dataset?.project ?? ""),
    folder: String(item?.dataset?.folder ?? ""),
    projectLabel: String(item?.dataset?.projectLabel || item?.dataset?.project || "").trim(),
    folderLabel: String(item?.dataset?.folderLabel || item?.dataset?.folder || "").trim(),
    label: String(item?.title || item?.querySelector?.(".active-project-label")?.textContent || item?.dataset?.folder || item?.dataset?.project || "").trim(),
    href: String(item?.href ?? ""),
  });
  const buildActiveProjectItem = (entry) => {
    const row = document.createElement("li");
    const link = document.createElement("a");
    link.className = "active-project-item";
    link.href = entry.href;
    link.dataset.project = entry.project;
    link.dataset.folder = entry.folder || "";
    link.dataset.projectLabel = entry.projectLabel || entry.project || "";
    link.dataset.folderLabel = entry.folderLabel || entry.folder || "";
    const projectLabel = entry.projectLabel || entry.project || "project";
    const folderLabel = entry.folderLabel || entry.folder || "";
    const display = entry.label
      || (entry.folder ? `${projectLabel} / ${folderLabel}` : projectLabel);
    link.title = display;
    const mark = document.createElement("span");
    mark.className = "active-project-mark";
    mark.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "active-project-label";
    label.textContent = display;
    link.append(mark, label);
    row.append(link);
    return row;
  };
  const currentProjectSessionHref = () => {
    const id = currentSessionId();
    if (!id || !location.pathname.includes(`/session/${id}`)) return "";
    return new URL(location.pathname, location.origin).href;
  };
  const projectSwitchHref = (project, folder = "") => {
    const name = String(project ?? "");
    if (!name) return "";
    const prefix = location.pathname.match(/^(\/[^/]+)(?=\/project\/|\/session\/|$)/);
    const base = prefix ? prefix[1] : "/qq";
    const nested = String(folder ?? "") ? `/${encodeURIComponent(folder)}` : "";
    return new URL(`${base}/project/${encodeURIComponent(name)}${nested}`, location.origin).href;
  };
  const retargetProjectLink = (link, currentKey, currentHref) => {
    if (!(link instanceof HTMLAnchorElement) || !link.dataset.project) return;
    const key = projectIdentity({ project: link.dataset.project, folder: link.dataset.folder });
    if (key === currentKey && currentHref) {
      link.href = currentHref;
      return;
    }
    const next = projectSwitchHref(link.dataset.project, link.dataset.folder);
    if (next) link.href = next;
  };
  const compareProjectText = (left, right) => {
    const primary = left.localeCompare(right, "en", { numeric: true, sensitivity: "base" });
    return primary || left.localeCompare(right, "en", { numeric: true, sensitivity: "variant" });
  };
  const compareProjectEntries = (left, right) => {
    const leftProject = String(left?.project || "").trim();
    const rightProject = String(right?.project || "").trim();
    const byProjectLabel = compareProjectText(
      String(left?.projectLabel || leftProject).trim(),
      String(right?.projectLabel || rightProject).trim(),
    );
    if (byProjectLabel) return byProjectLabel;
    const byProject = compareProjectText(leftProject, rightProject);
    if (byProject) return byProject;
    const leftFolder = String(left?.folder || "").trim();
    const rightFolder = String(right?.folder || "").trim();
    if (!leftFolder && rightFolder) return -1;
    if (leftFolder && !rightFolder) return 1;
    const byFolderLabel = compareProjectText(
      String(left?.folderLabel || leftFolder).trim(),
      String(right?.folderLabel || rightFolder).trim(),
    );
    return byFolderLabel || compareProjectText(leftFolder, rightFolder);
  };
  const orderProjectItems = (list, items, entryOf) => {
    if (!list || items.length < 2) return;
    const movable = new Set(items.map((item) => item.closest("li") ?? item));
    const fixed = [...list.children].filter((item) => !movable.has(item));
    const ordered = items
      .map((item, index) => ({ item, index, entry: entryOf(item) }))
      .sort((left, right) => compareProjectEntries(left.entry, right.entry) || left.index - right.index)
      .map(({ item }) => item.closest("li") ?? item);
    list.replaceChildren(...fixed, ...ordered);
  };
  const restoreActiveProjects = () => {
    const rail = document.querySelector("#project-rail");
    const list = rail?.querySelector(".active-projects ol");
    if (!rail || !list) return;
    orderProjectItems(list, activeProjectItems(), activeProjectEntry);
    orderProjectItems(
      document.querySelector(".projects-menu-list"),
      [...document.querySelectorAll(".projects-choice[data-project]")],
      (item) => ({
        project: item.dataset.project,
        folder: item.dataset.folder,
        projectLabel: item.dataset.projectLabel,
        folderLabel: item.dataset.folderLabel,
      }),
    );
    const currentKey = projectIdentity({ project: rail.dataset.currentProject, folder: rail.dataset.currentFolder });
    const currentIsActive = rail.dataset.currentActive === "true";
    const currentHref = currentIsActive ? currentProjectSessionHref() : "";
    for (const item of activeProjectItems()) retargetProjectLink(item, currentKey, currentHref);
    for (const choice of document.querySelectorAll(".projects-choice[data-project]")) {
      retargetProjectLink(choice, currentKey, currentHref);
    }
    scheduleSessionConnectors();
  };
  const activeProjectKeys = () => new Set(activeProjectItems().map((item) => projectIdentity(activeProjectEntry(item))));
  const appendActiveProject = (entry) => {
    if (!entry.project || activeProjectKeys().has(projectIdentity(entry))) return;
    const list = document.querySelector(".active-projects ol");
    if (!list) return;
    list.append(buildActiveProjectItem(entry));
    restoreActiveProjects();
  };
  const removeActiveProject = (entry) => {
    const key = projectIdentity(entry);
    const item = activeProjectItems().find((candidate) => projectIdentity(activeProjectEntry(candidate)) === key);
    item?.closest("li")?.remove();
    scheduleSessionConnectors();
  };
  const responseHasSession = (response) => {
    if (response.status === 404) return false;
    const path = new URL(response.url).pathname;
    if (/\/session\/session-[0-9a-f-]+(?:\/|$)/i.test(path)) return true;
    if (/\/project\/[^/]+/i.test(path) && (response.ok || response.redirected)) return true;
    return response.ok;
  };
  const validateRememberedProjects = async () => {
    const current = activeProjectItems().find((item) => item.matches('[aria-current="page"]'));
    const candidates = activeProjectItems()
      .filter((item) => item !== current && item.dataset.live !== "true")
      .map(activeProjectEntry);
    await Promise.all(candidates.map(async (entry) => {
      try {
        const response = await fetch(entry.href, { method: "HEAD", headers: { Accept: "text/html" } });
        if (response.status === 404) removeActiveProject(entry);
        else if (!responseHasSession(response) && response.status >= 400) removeActiveProject(entry);
      } catch {
        /* retain remembered activity when validation cannot reach the fixture */
      }
    }));
  };
  const neighborProject = (delta) => {
    const projects = projectRailItems();
    if (projects.length < 2) return;
    const current = projects.findIndex((project) => project.matches('[aria-current="page"]'));
    const index = current < 0 ? 0 : current;
    const next = projects[(index + delta + projects.length) % projects.length];
    void chairGo(next.href, next);
  };
  const inactiveProjectTree = () => document.querySelector("#inactive-project-tree");
  const projectTreeColumns = () => inactiveProjectTree()?.querySelector(".project-tree-columns");
  const projectTreeIsOpen = () => {
    const tree = inactiveProjectTree();
    return Boolean(tree && !tree.hidden);
  };
  const activeProjectNames = () => new Set(activeProjectItems().map((item) => item.dataset.project).filter(Boolean));
  const discoverActiveProjects = async (entries) => {
    const candidates = entries.filter((entry) => entry.kind === "project" && entry.project && !activeProjectNames().has(entry.project));
    await Promise.all(candidates.map(async (entry) => {
      try {
        const response = await fetch(entry.href, { method: "HEAD", headers: { Accept: "text/html" } });
        if (!responseHasSession(response)) return;
        appendActiveProject(entry);
      } catch {
        /* project activity discovery is best-effort */
      }
    }));
  };
  const folderEntries = (html, responseUrl) => {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const entries = [...parsed.querySelectorAll("#project-drawer .drawer-entry[data-entry-type]")]
      .map((link) => {
        const kind = link.dataset.entryType;
        const label = link.querySelector(".drawer-name")?.textContent?.trim() ?? "";
        let href = "";
        try { href = new URL(link.getAttribute("href") ?? "", responseUrl).href; } catch {}
        let project = String(link.dataset.project ?? "");
        if (!project) {
          try {
            const match = new URL(href).pathname.match(/\/project\/([^/]+)/);
            project = match ? decodeURIComponent(match[1]) : "";
          } catch {}
        }
        return {
          kind,
          label,
          href,
          project,
          folder: String(link.dataset.folder ?? ""),
          fileKind: String(link.dataset.fileKind ?? ""),
          action: String(link.dataset.treeAction ?? (kind === "file" ? "open" : "expand")),
        };
      })
      .filter((entry) => entry.href && entry.label && ["project", "directory", "file"].includes(entry.kind));
    let createHref = "";
    const start = parsed.querySelector("#project-drawer .drawer-start-session[action]");
    if (start instanceof HTMLFormElement) {
      try { createHref = new URL(start.getAttribute("action") ?? "", responseUrl).href; } catch { createHref = ""; }
    }
    return { entries, createHref };
  };
  const projectCreateHref = (entry) => {
    const project = entry.project || (entry.kind === "project" ? entry.label : "");
    if (!project) return "";
    const folder = entry.folder || (entry.kind === "directory" ? entry.label : "");
    const folderPart = folder ? `/${encodeURIComponent(folder)}` : "";
    const prefix = location.pathname.match(/^(.*)\/project\//)?.[1] ?? "";
    try {
      return new URL(`${prefix}/project/${encodeURIComponent(project)}${folderPart}/sessions`, location.origin).href;
    } catch {
      return "";
    }
  };
  const treeCreateMark = (href) => {
    const create = document.createElement("span");
    create.className = "project-tree-create";
    create.dataset.href = href;
    create.dataset.action = "create";
    create.setAttribute("aria-label", "New session");
    create.textContent = "+";
    return create;
  };
  const attachTreeCreate = (node, href) => {
    if (!(node instanceof HTMLElement) || !href) return;
    node.classList.add("project-tree-node-create");
    const existing = node.querySelector(".project-tree-create");
    if (existing instanceof HTMLElement) {
      existing.dataset.href = href;
      return;
    }
    const mark = treeCreateMark(href);
    const branch = node.querySelector(".project-tree-branch");
    if (branch) branch.before(mark);
    else node.append(mark);
  };
  const projectTreeNodes = (column) => [...column.querySelectorAll(".project-tree-node")];
  let treeRequest = 0;
  const trimProjectTree = (depth) => {
    const columns = projectTreeColumns();
    if (!columns) return;
    for (const column of [...columns.querySelectorAll(".project-tree-column")]) {
      if (Number(column.dataset.depth) >= depth) column.remove();
    }
  };
  const renderProjectTreeColumn = (entries, depth, parentNode) => {
    const columns = projectTreeColumns();
    if (!columns) return null;
    trimProjectTree(depth);
    columns.querySelector(".project-tree-loading")?.remove();
    if (entries.length === 0) return null;
    const column = document.createElement("div");
    column.className = "project-tree-column";
    column.dataset.depth = String(depth);
    column.setAttribute("role", "group");
    if (parentNode instanceof HTMLElement) column.dataset.parentHref = parentNode.dataset.href ?? "";
    for (const [index, entry] of entries.entries()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "project-tree-node";
      button.dataset.href = entry.href;
      button.dataset.kind = entry.kind;
      button.dataset.action = entry.action;
      button.dataset.project = entry.project;
      button.dataset.folder = entry.folder;
      button.dataset.fileKind = entry.fileKind;
      button.dataset.depth = String(depth);
      button.setAttribute("role", "treeitem");
      button.setAttribute("aria-selected", String(index === 0));
      button.tabIndex = index === 0 ? 0 : -1;
      button.title = entry.label;
      const label = document.createElement("span");
      label.className = "project-tree-label";
      label.textContent = entry.label;
      if (entry.kind === "file") {
        button.append(label);
      } else {
        const mark = document.createElement("span");
        mark.className = "project-tree-mark";
        mark.setAttribute("aria-hidden", "true");
        button.append(mark, label);
      }
      if (entry.action === "expand") {
        const branch = document.createElement("span");
        branch.className = "project-tree-branch";
        branch.setAttribute("aria-hidden", "true");
        branch.textContent = "›";
        button.append(branch);
      }
      const createHref = projectCreateHref(entry);
      if (createHref) attachTreeCreate(button, createHref);
      column.append(button);
    }
    columns.append(column);
    return column;
  };
  const treeChildUrl = (node) => new URL(node.dataset.href, location.href).href;
  const loadProjectTreeColumn = async (url, depth, parentNode = null, focusChild = false) => {
    const request = ++treeRequest;
    trimProjectTree(depth);
    try {
      const response = await fetch(url, { headers: { Accept: "text/html" } });
      if (!response.ok) return null;
      const html = await response.text();
      if (request !== treeRequest && depth > 0) return null;
      const listing = folderEntries(html, response.url);
      if (parentNode) attachTreeCreate(parentNode, listing.createHref);
      const column = renderProjectTreeColumn(listing.entries, depth, parentNode);
      if (focusChild) column?.querySelector(".project-tree-node")?.focus();
      return column;
    } catch {
      return null;
    }
  };
  let projectTreeReady = null;
  const hydrateProjectTree = () => {
    const tree = inactiveProjectTree();
    if (!tree) return Promise.resolve(null);
    if (!projectTreeReady) projectTreeReady = loadProjectTreeColumn(tree.dataset.rootUrl, 0);
    return projectTreeReady;
  };
  const selectProjectTreeNode = (node) => {
    if (!(node instanceof HTMLElement)) return;
    const column = node.closest(".project-tree-column");
    for (const other of projectTreeNodes(column)) {
      const selected = other === node;
      other.setAttribute("aria-selected", String(selected));
      other.tabIndex = selected ? 0 : -1;
    }
  };
  const spawnProjectSession = (node) => {
    if (!(node instanceof HTMLElement) || !node.dataset.href) return;
    void navigatePage(node.dataset.href, node);
  };
  const createProjectSession = (node) => {
    if (!(node instanceof HTMLElement) || !node.dataset.href) return;
    const form = document.createElement("form");
    form.method = "post";
    form.action = node.dataset.href;
    form.hidden = true;
    document.body.append(form);
    form.requestSubmit();
  };
  const activateProjectTreeNode = (node, focusChild = true) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.dataset.action === "expand") {
      void loadProjectTreeColumn(treeChildUrl(node), Number(node.dataset.depth) + 1, node, focusChild);
      return;
    }
    if (node.dataset.action === "create") {
      createProjectSession(node);
      return;
    }
    if (node.dataset.action === "spawn") {
      spawnProjectSession(node);
      return;
    }
    void navigatePage(node.dataset.href, node);
  };
  const setProjectTreeOpen = (open, restoreFocus = false) => {
    const tree = inactiveProjectTree();
    if (!tree) return;
    tree.hidden = !open;
    document.body.classList.toggle("inactive-projects-open", open);
    if (!open) {
      if (restoreFocus) document.querySelector(".active-project-current")?.focus({ preventScroll: true });
      return;
    }
    void hydrateProjectTree().then(() => {
      const first = tree.querySelector(".project-tree-node");
      if (first instanceof HTMLElement) first.focus({ preventScroll: true });
    });
  };
  const handleProjectTreeKey = (event) => {
    if (!projectTreeIsOpen()) return false;
    const node = event.target instanceof Element ? event.target.closest(".project-tree-node") : null;
    if (event.key === "Escape") {
      event.preventDefault();
      setProjectTreeOpen(false, true);
      return true;
    }
    if (!(node instanceof HTMLElement)) return false;
    const column = node.closest(".project-tree-column");
    const nodes = projectTreeNodes(column);
    const index = nodes.indexOf(node);
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const delta = event.key === "ArrowUp" ? -1 : 1;
      const next = nodes[(index + delta + nodes.length) % nodes.length];
      selectProjectTreeNode(next);
      next.focus();
      return true;
    }
    if (event.key === "ArrowRight") {
      if (node.dataset.action !== "expand") return false;
      event.preventDefault();
      selectProjectTreeNode(node);
      activateProjectTreeNode(node, true);
      return true;
    }
    if (event.key === "ArrowLeft") {
      const depth = Number(node.dataset.depth);
      if (depth <= 0) return false;
      event.preventDefault();
      const parentHref = column.dataset.parentHref;
      trimProjectTree(depth);
      const parent = [...document.querySelectorAll(".project-tree-node")].find((candidate) => candidate.dataset.href === parentHref);
      parent?.focus();
      return true;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      selectProjectTreeNode(node);
      activateProjectTreeNode(node, true);
      return true;
    }
    return false;
  };
  document.addEventListener("click", (event) => {
    const create = event.target instanceof Element ? event.target.closest(".project-tree-create") : null;
    if (create instanceof HTMLElement) {
      event.preventDefault();
      createProjectSession(create);
      return;
    }
    const node = event.target instanceof Element ? event.target.closest(".project-tree-node") : null;
    if (!(node instanceof HTMLElement)) return;
    event.preventDefault();
    selectProjectTreeNode(node);
    activateProjectTreeNode(node, false);
  });

  const projectDrawer = () => document.querySelector("#project-drawer");
  const projectRail = () => document.querySelector("#project-rail");
  const drawerToggle = () => document.querySelector("#project-drawer-toggle");
  const drawerBackdrop = () => document.querySelector("#project-drawer-backdrop");
  let drawerReturnFocus = null;
  const drawerIsOpen = () => document.body.classList.contains("drawer-open");
  const CHAIR_MODE_KEY = "qq:chair-mode";
  const navMode = () => document.body.classList.contains("nav-mode");
  const PAGE_CACHE_MS = 8000;
  const pageCache = new Map();
  const pageControllers = new Map();
  let navGeneration = 0;
  let pendingHtmxProcess = false;
  const consolePageUrl = (value) => {
    try {
      const url = new URL(value, location.href);
      if (url.origin !== location.origin) return null;
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      const path = url.pathname;
      if (/\.(?:js|css|png|webmanifest|map|woff2?)$/i.test(path)) return null;
      if (/\/(?:file|open|download|events|assets)\//.test(path) || /\/events$/.test(path)) return null;
      if (path.endsWith("/sw.js")) return null;
      return url;
    } catch {
      return null;
    }
  };
  const rememberPage = (key, entry) => {
    pageCache.set(key, entry);
    if (pageCache.size <= 24) return;
    const oldest = pageCache.keys().next().value;
    if (oldest && oldest !== key) pageCache.delete(oldest);
  };
  const abortPrefetchesExcept = (keep) => {
    for (const [key, controller] of pageControllers) {
      if (key === keep) continue;
      controller.abort();
      pageControllers.delete(key);
      const hit = pageCache.get(key);
      if (hit && !hit.ready) pageCache.delete(key);
    }
  };
  const prefetchPage = (value, priority = "low") => {
    const url = consolePageUrl(value);
    if (!url) return null;
    const key = url.href;
    const hit = pageCache.get(key);
    if (hit && (!hit.ready || Date.now() - hit.at < PAGE_CACHE_MS)) return hit.promise;
    const controller = new AbortController();
    const promise = fetch(key, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "text/html" },
      priority,
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("navigate");
      const html = await response.text();
      const page = { html, url: response.url };
      const entry = { at: Date.now(), promise: Promise.resolve(page), ready: true };
      rememberPage(key, entry);
      if (response.url !== key) rememberPage(response.url, entry);
      return page;
    }).catch((error) => {
      pageControllers.delete(key);
      const current = pageCache.get(key);
      if (current?.promise === promise) pageCache.delete(key);
      throw error;
    }).finally(() => {
      if (pageControllers.get(key) === controller) pageControllers.delete(key);
    });
    pageControllers.set(key, controller);
    rememberPage(key, { at: Date.now(), promise, ready: false });
    return promise;
  };
  const processConsole = () => {
    pendingHtmxProcess = false;
    if (typeof globalThis.htmx?.process === "function") globalThis.htmx.process(document.body);
  };
  const closeSseSources = () => {
    const api = globalThis.htmx;
    if (!api || typeof api.trigger !== "function") return;
    for (const node of document.querySelectorAll("[sse-connect], [data-sse-connect]")) {
      api.trigger(node, "htmx:beforeCleanupElement");
    }
  };
  const rebindSseSwaps = (stream) => {
    const nodes = [
      stream,
      ...stream.querySelectorAll("[sse-swap], [data-sse-swap], [hx-trigger], [data-hx-trigger]"),
    ];
    for (const node of nodes) {
      const internalData = node["htmx-internal-data"];
      if (internalData) delete internalData.initHash;
    }
  };
  // Mirrors HTMX 2.0.10's deterministic attribute hash without calling minified internals.
  const htmxAttributeHash = (node) => {
    let hash = 0;
    const add = (value) => {
      for (let index = 0; index < value.length; index += 1) {
        hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
      }
    };
    for (const attribute of node.attributes) {
      if (!attribute.value) continue;
      add(attribute.name);
      add(attribute.value);
    }
    return hash;
  };
  const syncHtmxInitHash = (node) => {
    const internalData = node["htmx-internal-data"];
    if (internalData) internalData.initHash = htmxAttributeHash(node);
  };
  const markGroupCurrent = (selector, currentClass, current) => {
    for (const item of document.querySelectorAll(selector)) {
      const on = item === current;
      item.classList.toggle(currentClass, on);
      if (on) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    }
  };
  const markLinkCurrent = (link) => {
    if (!(link instanceof Element)) return;
    if (link.matches(".active-project-item")) markGroupCurrent(".active-project-item[href]", "active-project-current", link);
    if (link.matches(".projects-choice")) markGroupCurrent(".projects-choice[href]", "projects-choice-current", link);
    if (link.matches(".live-tracker-session")) {
      markGroupCurrent(".live-tracker-session[href]", "live-tracker-session-current", link);
    }
  };
  const adoptPage = (html, url, historyMode = "push") => {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    if (!(parsed.body instanceof HTMLElement)) return false;
    const keepNav = navMode();
    resetAdoptedSession();
    closeSseSources();
    projectTreeReady = null;
    treeRequest += 1;
    liveTrackerProjectFilter = "";
    const next = document.adoptNode(parsed.body);
    if (keepNav) next.classList.add("nav-mode");
    document.title = parsed.title;
    document.documentElement.replaceChild(next, document.body);
    liveSessionId = currentSessionId();
    promptEchoes.commission(liveSessionId);
    if (historyMode === "push") {
      if (!history.state?.qqPage) history.replaceState({ qqPage: true }, "", location.href);
      history.pushState({ qqPage: true }, "", url);
    }
    if (keepNav) pendingHtmxProcess = true;
    else processConsole();
    syncInitialChrome({ skipValidate: true });
    restorePersistedDraft();
    restoreTranscriptView();
    return true;
  };
  const navigatePage = async (value, current = null) => {
    const url = consolePageUrl(value);
    if (!url) {
      location.assign(String(value ?? ""));
      return;
    }
    if (url.href === location.href) return;
    if (current instanceof Element && current.matches("[aria-current='page']")) return;
    const sessionSwitchId = /\/session\/[^/]+\/?$/.test(url.pathname)
      ? qqLatency.markSessionSwitch(url.href, current) : null;
    markLinkCurrent(current);
    const gen = ++navGeneration;
    abortPrefetchesExcept(url.href);
    closeSseSources();
    try {
      const page = await prefetchPage(url.href, "high");
      if (gen !== navGeneration) return;
      if (sessionSwitchId) qqLatency.markSessionSwitchResponse(sessionSwitchId, current);
      if (!page?.html || !adoptPage(page.html, page.url)) throw new Error("adopt");
      if (sessionSwitchId) qqLatency.markSessionSwitchReady(sessionSwitchId, document.body);
    } catch (error) {
      if (gen !== navGeneration) return;
      if (error?.name === "AbortError") return;
      qqLatency.markNavigationIntent(url.href, current, sessionSwitchId);
      location.assign(url.href);
    }
  };
  const overlayProjectItem = (link) => {
    if (!(link instanceof Element)) return null;
    if (link.matches(".active-project-item")) return link;
    if (link.matches(".projects-session-choice")) {
      return document.querySelector(".projects-session-item") ?? link;
    }
    if (!link.matches(".projects-choice") || !link.dataset.project) return null;
    return [...document.querySelectorAll(".active-project-item")].find((item) => (
      item.dataset.project === link.dataset.project
      && (item.dataset.folder || "") === (link.dataset.folder || "")
    )) ?? link;
  };
  const readProjectSessions = (item) => {
    try {
      const parsed = JSON.parse(item?.dataset?.sessions || "[]");
      return Array.isArray(parsed)
        ? parsed.filter((session) => session && session.id && session.href)
        : [];
    } catch {
      return [];
    }
  };
  const paintSessionTokens = (sessions, currentId, projectItem = null) => {
    const nav = document.querySelector(".session-traversal");
    if (!nav || nav.classList.contains("live-tracker")) return;
    nav.replaceChildren();
    if (!sessions.length) {
      const empty = document.createElement("span");
      empty.className = "session-empty";
      empty.textContent = "no live sessions";
      nav.append(empty);
    }
    for (const session of sessions) {
      const link = document.createElement("a");
      link.className = session.id === currentId ? "session-token session-token-current" : "session-token";
      if (session.id === currentId) link.setAttribute("aria-current", "page");
      link.href = session.href;
      link.dataset.sessionId = session.id;
      const label = document.createElement("span");
      label.textContent = session.token || "session";
      link.append(label);
      nav.append(link);
    }
    const create = document.querySelector("form.new-session");
    if (create instanceof HTMLFormElement && !create.hidden) {
      const form = document.createElement("form");
      form.className = "new-session";
      const project = projectItem?.dataset?.project || document.querySelector(".active-project-item[aria-current='page']")?.dataset?.project || "";
      const folder = projectItem?.dataset?.folder || document.querySelector(".active-project-item[aria-current='page']")?.dataset?.folder || "";
      const canonicalBase = project
        ? `${consoleBasePath()}/project/${encodeURIComponent(project)}${folder ? `/${encodeURIComponent(folder)}` : ""}/sessions`
        : create.action;
      form.action = canonicalBase;
      form.method = "post";
      const button = document.createElement("button");
      button.type = "submit";
      button.setAttribute("aria-label", "New session");
      button.innerHTML = '<svg class="banner-mark" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
      form.append(button);
      nav.append(form);
    }
  };
  const rememberOverlaySession = (projectItem, sessionId, href) => {
    overlaySessionId = sessionId || "";
    pendingCanonical = href || "";
    if (projectItem instanceof HTMLElement && sessionId) projectItem.dataset.sessionId = sessionId;
  };
  const consoleBasePath = () => {
    const stream = document.querySelector("#console-stream");
    try {
      const current = new URL(stream?.getAttribute("sse-connect") || location.href, location.href);
      const match = current.pathname.match(/^(.*?)(?:\/project\/|\/session\/)/);
      if (match?.[1]) return match[1];
    } catch { /* use the console default */ }
    return "/qq";
  };
  const SESSION_CONNECTOR_ID = "session-connectors";
  const SESSION_CONNECTOR_INSET = 0.75;
  const SESSION_CONNECTOR_SPINE_GAP = 4;
  const SESSION_CONNECTOR_LEAD = 10;
  const SESSION_CONNECTOR_NS = "http://www.w3.org/2000/svg";
  let sessionConnectorFrame = 0;
  let sessionConnectorResizeObserver = null;
  let sessionConnectorObserved = [];
  const removeSessionConnectors = () => {
    document.getElementById(SESSION_CONNECTOR_ID)?.remove();
  };
  const sessionConnectorRect = (node) => {
    if (!(node instanceof HTMLElement)) return null;
    const rect = node.getBoundingClientRect();
    return {
      left: rect.left + node.clientLeft,
      top: rect.top + node.clientTop,
      right: rect.left + node.clientLeft + node.clientWidth,
      bottom: rect.top + node.clientTop + node.clientHeight,
    };
  };
  const sessionTrackerConnectorRect = (tracker) => {
    const clip = sessionConnectorRect(tracker);
    if (!clip || !navMode() || desktopChair()) return clip;
    const composerShell = document.querySelector("#session-composer");
    if (!(composerShell instanceof HTMLElement)) return clip;
    const style = getComputedStyle(composerShell);
    const composer = composerShell.getBoundingClientRect();
    const coversTracker = style.display !== "none" && style.visibility !== "hidden"
      && composer.width > 0 && composer.height > 0
      && composer.left < clip.right && composer.right > clip.left
      && composer.top < clip.bottom && composer.bottom > clip.top;
    return coversTracker ? { ...clip, bottom: Math.max(clip.top, Math.min(clip.bottom, composer.top)) } : clip;
  };
  const visibleConnectorSurface = (node, clip) => {
    if (!(node instanceof HTMLElement) || !clip || node.hidden) return null;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const visible = {
      left: Math.max(rect.left, clip.left),
      top: Math.max(rect.top, clip.top),
      right: Math.min(rect.right, clip.right),
      bottom: Math.min(rect.bottom, clip.bottom),
    };
    const meaningfulHeight = Math.min(12, Math.max(4, rect.height * 0.35));
    if (visible.right - visible.left < 8 || visible.bottom - visible.top < meaningfulHeight) return null;
    return { rect, visible };
  };
  const sessionConnectorModeVisible = (tracker, rail) => {
    if (!(tracker instanceof HTMLElement) || !(rail instanceof HTMLElement)) return false;
    if (tracker.dataset.overview !== "true") return false;
    if (!desktopChair() && !navMode()) return false;
    const trackerStyle = getComputedStyle(tracker);
    const railStyle = getComputedStyle(rail);
    return trackerStyle.display !== "none" && trackerStyle.visibility !== "hidden"
      && railStyle.display !== "none" && railStyle.visibility !== "hidden";
  };
  const observeSessionConnectorSurfaces = (nodes) => {
    if (typeof ResizeObserver !== "function") return;
    const next = [...new Set(nodes.filter((node) => node instanceof Element))];
    if (next.length === sessionConnectorObserved.length
      && next.every((node, index) => node === sessionConnectorObserved[index])) return;
    if (!sessionConnectorResizeObserver) {
      sessionConnectorResizeObserver = new ResizeObserver(() => scheduleSessionConnectors());
    }
    sessionConnectorResizeObserver.disconnect();
    sessionConnectorObserved = next;
    for (const node of next) sessionConnectorResizeObserver.observe(node);
  };
  const sessionConnectorJoin = (spineTop, spineBottom, sourceY) => {
    const preferred = (spineTop + spineBottom) / 2;
    if (Math.abs(preferred - sourceY) >= 1) return preferred;
    return Math.min(spineBottom, Math.max(
      spineTop,
      preferred + (preferred >= sourceY ? 2 : -2),
    ));
  };
  const paintSessionConnectors = () => {
    sessionConnectorFrame = 0;
    const rail = document.querySelector("#project-rail");
    const projects = rail?.querySelector(".active-projects");
    const tracker = document.querySelector(".live-tracker");
    if (!sessionConnectorModeVisible(tracker, rail)
      || !(projects instanceof HTMLElement) || !(tracker instanceof HTMLElement)) {
      removeSessionConnectors();
      sessionConnectorResizeObserver?.disconnect();
      sessionConnectorObserved = [];
      return;
    }
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    if (width <= 0 || height <= 0) {
      removeSessionConnectors();
      return;
    }
    const groups = new Map();
    for (const group of tracker.querySelectorAll(".live-tracker-project[data-project]")) {
      if (!group.hidden) groups.set(projectIdentity(group.dataset), group);
    }
    const routes = [];
    const projectClip = sessionConnectorRect(projects);
    const trackerClip = sessionTrackerConnectorRect(tracker);
    const composerShell = document.querySelector("#session-composer");
    for (const project of projects.querySelectorAll(".active-project-item[data-project][data-folder]")) {
      const key = projectIdentity(project.dataset);
      const group = groups.get(key);
      const source = visibleConnectorSurface(project, projectClip);
      const target = visibleConnectorSurface(group, trackerClip);
      const sessions = group?.querySelector?.(".live-tracker-sessions");
      if (!key || !source || !target || !(sessions instanceof HTMLElement)) continue;
      const sessionsRect = sessions.getBoundingClientRect();
      const start = {
        x: source.rect.right - SESSION_CONNECTOR_INSET,
        y: (source.rect.top + source.rect.bottom) / 2,
      };
      const contentLeft = Math.max(target.rect.left, sessionsRect.left);
      const spineX = contentLeft - SESSION_CONNECTOR_SPINE_GAP;
      const spineTop = Math.max(target.visible.top, sessionsRect.top) + SESSION_CONNECTOR_INSET;
      const spineBottom = Math.min(target.visible.bottom, sessionsRect.bottom) - SESSION_CONNECTOR_INSET;
      const joinY = sessionConnectorJoin(spineTop, spineBottom, start.y);
      const connectorWidth = spineX - start.x;
      const leadX = start.x + Math.min(
        SESSION_CONNECTOR_LEAD,
        Math.max(2, connectorWidth / 3),
      );
      const sourceAnchorVisible = start.y >= source.visible.top - 0.01
        && start.y <= source.visible.bottom + 0.01;
      const spineVisible = spineBottom - spineTop >= 4
        && spineTop >= trackerClip.top && spineBottom <= trackerClip.bottom;
      if (!sourceAnchorVisible || !spineVisible || connectorWidth < 4) continue;
      routes.push({ project, group, start, leadX, joinY, contentLeft, spineX, spineTop, spineBottom });
    }
    const observe = [rail, projects, tracker, composerShell, ...groups.values()];
    if (routes.length === 0) {
      removeSessionConnectors();
      observeSessionConnectorSurfaces(observe);
      return;
    }
    let svg = document.getElementById(SESSION_CONNECTOR_ID);
    if (!(svg instanceof SVGElement)) {
      removeSessionConnectors();
      svg = document.createElementNS(SESSION_CONNECTOR_NS, "svg");
      svg.id = SESSION_CONNECTOR_ID;
      svg.classList.add("session-connectors");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      document.body.append(svg);
    }
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.replaceChildren(...routes.map(({
      project, start, leadX, joinY, spineX, spineTop, spineBottom,
    }) => {
      const path = document.createElementNS(SESSION_CONNECTOR_NS, "path");
      path.dataset.project = project.dataset.project || "";
      path.dataset.folder = project.dataset.folder || "";
      path.setAttribute("d", `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} H ${leadX.toFixed(2)} L ${spineX.toFixed(2)} ${joinY.toFixed(2)} M ${spineX.toFixed(2)} ${spineTop.toFixed(2)} V ${spineBottom.toFixed(2)}`);
      return path;
    }));
    observeSessionConnectorSurfaces(observe);
  };
  function scheduleSessionConnectors() {
    if (sessionConnectorFrame) return;
    sessionConnectorFrame = requestAnimationFrame(paintSessionConnectors);
  }
  const suppressSessionConnectors = () => {
    if (sessionConnectorFrame) cancelAnimationFrame(sessionConnectorFrame);
    sessionConnectorFrame = 0;
    removeSessionConnectors();
    sessionConnectorResizeObserver?.disconnect();
    sessionConnectorObserved = [];
  };

  const liveTrackerGroups = (tracker = document.querySelector(".live-tracker")) => tracker
    ? [...tracker.querySelectorAll(".live-tracker-project[data-project]")]
    : [];
  const removeLiveTrackerCreate = (tracker) => {
    for (const create of tracker.querySelectorAll("form.new-session")) create.remove();
  };
  const ensureLiveTrackerCreate = (tracker, project, folder) => {
    let create = tracker.querySelector("form.new-session");
    if (!(create instanceof HTMLFormElement)) {
      create = document.createElement("form");
      create.className = "new-session";
      create.method = "post";
      const button = document.createElement("button");
      button.type = "submit";
      button.setAttribute("aria-label", "New session");
      button.innerHTML = '<svg class="banner-mark" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
      create.append(button);
      tracker.append(create);
    }
    create.hidden = false;
    create.action = `${consoleBasePath()}/project/${encodeURIComponent(project)}${folder ? `/${encodeURIComponent(folder)}` : ""}/sessions`;
    return create;
  };
  const showLiveTrackerOverview = ({ remember = true } = {}) => {
    const tracker = document.querySelector(".live-tracker");
    if (!(tracker instanceof HTMLElement)) return false;
    for (const group of liveTrackerGroups(tracker)) {
      group.hidden = false;
      group.dataset.current = "false";
    }
    tracker.dataset.overview = "true";
    delete tracker.dataset.filterProject;
    delete tracker.dataset.filterFolder;
    tracker.setAttribute("aria-label", "All project sessions");
    const empty = tracker.querySelector(".live-tracker-filter-empty");
    if (empty instanceof HTMLElement) empty.hidden = true;
    removeLiveTrackerCreate(tracker);
    markGroupCurrent(".active-project-item[href]", "active-project-current", null);
    markGroupCurrent(".projects-choice[href]", "projects-choice-current", null);
    if (remember) liveTrackerProjectFilter = LIVE_TRACKER_OVERVIEW;
    scheduleSessionConnectors();
    return true;
  };
  const showLiveTrackerProject = (group, { remember = true, item = null } = {}) => {
    const tracker = document.querySelector(".live-tracker");
    if (!(tracker instanceof HTMLElement)) return false;
    suppressSessionConnectors();
    const project = String(group?.dataset?.project ?? item?.dataset?.project ?? "");
    const folder = String(group?.dataset?.folder ?? item?.dataset?.folder ?? "");
    if (!project) return false;
    delete tracker.dataset.overview;
    for (const candidate of liveTrackerGroups(tracker)) {
      const selected = candidate === group;
      candidate.hidden = !selected;
      candidate.dataset.current = selected ? "true" : "false";
    }
    const label = String(
      group?.dataset?.projectLabel
        ?? item?.querySelector?.(".active-project-label")?.textContent
        ?? item?.textContent
        ?? project,
    ).trim();
    tracker.dataset.filterProject = project;
    tracker.dataset.filterFolder = folder;
    tracker.setAttribute("aria-label", `${label || project} sessions`);
    const empty = tracker.querySelector(".live-tracker-filter-empty");
    if (empty instanceof HTMLElement) empty.hidden = Boolean(group);
    ensureLiveTrackerCreate(tracker, project, folder);
    if (remember || !liveTrackerProjectFilter) {
      liveTrackerProjectFilter = projectIdentity({ project, folder });
    }
    return true;
  };
  const filterLiveTrackerProject = (item) => {
    const tracker = document.querySelector(".live-tracker");
    const project = String(item?.dataset?.project ?? "");
    const folder = String(item?.dataset?.folder ?? "");
    if (!(tracker instanceof HTMLElement) || !project) return false;
    const key = projectIdentity({ project, folder });
    const group = liveTrackerGroups(tracker).find((candidate) => (
      projectIdentity(candidate.dataset) === key
    )) ?? null;
    showLiveTrackerProject(group, { item });
    const menu = item.closest?.("details.projects-menu");
    if (menu instanceof HTMLDetailsElement) menu.open = false;
    return true;
  };
  const syncLiveTrackerProjectFilter = () => {
    const tracker = document.querySelector(".live-tracker");
    const groups = liveTrackerGroups(tracker);
    if (!(tracker instanceof HTMLElement)) return;
    if (liveTrackerProjectFilter === LIVE_TRACKER_OVERVIEW
      || (!liveTrackerProjectFilter && tracker.dataset.overview === "true")) {
      showLiveTrackerOverview({ remember: false });
      liveTrackerProjectFilter = LIVE_TRACKER_OVERVIEW;
      return;
    }
    if (groups.length === 0) return;
    const serverKey = projectIdentity({
      project: tracker.dataset.filterProject,
      folder: tracker.dataset.filterFolder,
    });
    const key = liveTrackerProjectFilter || serverKey;
    const selected = groups.find((group) => projectIdentity(group.dataset) === key)
      ?? groups.find((group) => group.dataset.current === "true")
      ?? groups[0];
    showLiveTrackerProject(selected, { remember: false });
  };
  const CHOOSER_INTERACTIVE = "a, button, input, select, textarea, summary, details, form, label, menu, [role='button'], [role='link'], [contenteditable], [tabindex]";
  const projectChooserSurface = (target) => {
    if (target?.closest?.("#inactive-project-tree")) return null;
    return target?.closest?.("#project-rail, .active-projects, .session-traversal") ?? null;
  };
  const projectChooserAction = (target, surface) => {
    const row = target?.closest?.(".active-projects li, .session-traversal li") ?? null;
    if (row) return row;
    const action = target?.closest?.(CHOOSER_INTERACTIVE) ?? null;
    return action && action !== surface ? action : null;
  };
  const clearProjectFilterFromEmptySpace = (target) => {
    if (!(target instanceof Element) || (!desktopChair() && !navMode())) return false;
    const surface = projectChooserSurface(target);
    if (!(surface instanceof Element) || projectChooserAction(target, surface)) return false;
    return showLiveTrackerOverview();
  };
  const clearProjectFilterFromChooserKey = (event) => {
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar")) return false;
    const target = event.target instanceof Element ? event.target : null;
    const surface = projectChooserSurface(target);
    if (!(surface instanceof Element) || target !== surface || projectChooserAction(target, surface)) return false;
    if (!showLiveTrackerOverview()) return false;
    event.preventDefault();
    return true;
  };
  const sessionEventsUrl = (sessionId) =>
    `${consoleBasePath()}/session/${encodeURIComponent(sessionId)}/events`;
  const selectionCanonical = (sessionId, projectItem, fallback = "") => {
    const id = String(sessionId || "");
    if (!id) return fallback;
    const project = String(projectItem?.dataset?.project || "");
    const folder = String(projectItem?.dataset?.folder || "");
    if (!project) return `${consoleBasePath()}/session/${encodeURIComponent(id)}`;
    return `${consoleBasePath()}/project/${encodeURIComponent(project)}${folder ? `/${encodeURIComponent(folder)}` : ""}/session/${encodeURIComponent(id)}`;
  };
  const normalizedCanonical = (value) => {
    try {
      const url = new URL(value, location.href);
      if (url.origin !== location.origin) return "";
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return "";
    }
  };
  const sessionHistoryState = (sessionId, canonical) => ({
    ...(history.state && typeof history.state === "object" ? history.state : {}),
    qqPage: true,
    qqSession: sessionId,
    canonical,
  });
  const commitSessionLocation = (sessionId, canonical, mode = "push") => {
    const href = normalizedCanonical(canonical);
    if (!sessionId || !href) return;
    committedLocation = new URL(href, location.href).href;
    if (mode === "none") return;
    const current = `${location.pathname}${location.search}${location.hash}`;
    if (current === href) {
      history.replaceState(sessionHistoryState(sessionId, href), "", href);
      return;
    }
    if (!history.state?.qqPage) {
      history.replaceState(sessionHistoryState(liveSessionId, current), "", current);
    }
    history.pushState(sessionHistoryState(sessionId, href), "", href);
  };
  const syncRailAfterSwitch = (meta) => {
    const rail = document.querySelector("#project-rail");
    if (!(rail instanceof HTMLElement)) return;
    const oldProject = rail.dataset.currentProject || "";
    const oldFolder = rail.dataset.currentFolder || "";
    const project = String(meta.project || "");
    const folder = String(meta.folder || "");
    const projectsScope = meta.scope === "projects";
    const child = meta.origin === "subagent" && Boolean(meta.parent);
    if (!projectsScope && project && liveTrackerProjectFilter !== LIVE_TRACKER_OVERVIEW) {
      liveTrackerProjectFilter = projectIdentity({ project, folder });
    }
    rail.dataset.currentProject = project;
    rail.dataset.currentFolder = folder;
    rail.dataset.currentActive = "true";
    for (const choice of document.querySelectorAll(".projects-choice[data-project]")) {
      const item = [...document.querySelectorAll(".active-project-item[data-project]")].find((candidate) => (
        candidate.dataset.project === choice.dataset.project
        && (candidate.dataset.folder || "") === (choice.dataset.folder || "")
      ));
      if (!(item instanceof HTMLElement)) continue;
      if (choice.dataset.sessions) item.dataset.sessions = choice.dataset.sessions;
      else delete item.dataset.sessions;
      if (choice.dataset.sessionId) item.dataset.sessionId = choice.dataset.sessionId;
    }
    const currentProject = [...document.querySelectorAll(".active-project-item[data-project]")].find((item) => (
      item.dataset.project === project && (item.dataset.folder || "") === folder
    ));
    const projectsItem = document.querySelector(".projects-session-item");
    const projectsChoice = document.querySelector(".projects-session-choice");
    if (projectsScope) {
      const projectsId = child ? String(meta.parent || "") : String(meta.id || "");
      if (projectsId) {
        if (projectsItem instanceof HTMLElement) projectsItem.dataset.sessionId = projectsId;
        if (projectsChoice instanceof HTMLElement) projectsChoice.dataset.sessionId = projectsId;
      }
      markGroupCurrent(".active-project-item[href]", "active-project-current", projectsItem);
      markGroupCurrent(".projects-choice[href]", "projects-choice-current", projectsChoice);
    } else {
      if (currentProject) {
        currentProject.dataset.sessionId = meta.id;
        currentProject.href = meta.canonical;
      }
      markGroupCurrent(".active-project-item[href]", "active-project-current", currentProject);
      const currentChoice = [...document.querySelectorAll(".projects-choice[data-project]")].find((choice) => (
        choice.dataset.project === project && (choice.dataset.folder || "") === folder
      ));
      markGroupCurrent(".projects-choice[href]", "projects-choice-current", currentChoice);
    }
    const canonical = normalizedCanonical(meta.canonical);
    const projectBase = canonical.replace(/\/session\/[^/?#]+$/, "");
    const create = document.querySelector(".session-traversal form.new-session") || rail.querySelector("form.new-session");
    const close = rail.querySelector("#close-session");
    if (create instanceof HTMLFormElement && !projectsScope) create.action = `${projectBase}/sessions`;
    if (close instanceof HTMLFormElement) close.action = `${canonical}/close`;
    if (create instanceof HTMLFormElement) create.hidden = child || projectsScope;
    if (!projectsScope && project) {
      syncLiveTrackerProjectFilter();
    }
    if (oldProject !== project || oldFolder !== folder) {
      closeDrawer({ updateUrl: false, restoreFocus: false });
      projectTreeReady = null;
      treeRequest += 1;
    }
  };
  const canLiveSwitch = () => {
    const stream = document.querySelector("#console-stream");
    if (!(stream instanceof HTMLElement)
      || !liveSessionId
      || !stream.hasAttribute("sse-connect")
      || !document.querySelector("#switch-meta")
      || !document.querySelector("#switch-ready")) return false;
    return true;
  };
  const liveSwitch = (sessionId, { history: historyMode = "none", exitWhenReady = false, canonical = "" } = {}) => {
    const id = String(sessionId || "");
    if (!id || (id === liveSessionId && !bootstrapSwitch)) return false;
    if (!canLiveSwitch()) return false;
    const stream = document.querySelector("#console-stream");
    if (!bootstrapSwitch) persistComposerDraft(composer(), liveSessionId);
    resetAdoptedSession();
    const generation = ++switchGeneration;
    const events = sessionEventsUrl(id);
    const bootstrap = `${events}?bootstrap=session&switch=${generation}`;
    if (historyMode === "push") commitSessionLocation(id, canonical || pendingCanonical, "push");
    bootstrapSwitch = {
      id,
      generation,
      sourceUrl: new URL(bootstrap, location.href).href,
      canonical: canonical || pendingCanonical,
      history: historyMode,
      exitWhenReady: Boolean(exitWhenReady),
      meta: null,
      latencySwitchId: null,
    };
    stream.setAttribute("aria-busy", "true");
    bootstrapSwitch.latencySwitchId = qqLatency.markSessionSwitch(bootstrapSwitch.canonical || bootstrap, stream);
    closeSseSources();
    activeSseSource = null;
    stream.setAttribute("sse-connect", bootstrap);
    rebindSseSwaps(stream);
    if (typeof globalThis.htmx?.process === "function") globalThis.htmx.process(stream);
    return true;
  };
  const finishLiveSwitch = (payload) => {
    const state = bootstrapSwitch;
    if (!state
      || String(payload?.id || "") !== state.id
      || String(payload?.generation ?? "") !== String(state.generation)
      || !state.meta) return false;
    const meta = state.meta;
    liveSessionId = state.id;
    promptEchoes.commission(liveSessionId);
    liveSwitchMeta = meta;
    bootstrapSwitch = null;
    pendingCanonical = meta.canonical || state.canonical;
    const stream = document.querySelector("#console-stream");
    if (stream instanceof HTMLElement) {
      // Keep the bootstrap URL: this EventSource continues with ordinary live events,
      // and its HTMX attribute hash must continue to describe the active source.
      stream.removeAttribute("aria-busy");
      syncHtmxInitHash(stream);
    }
    syncRailAfterSwitch(meta);
    swapDraft = null;
    restorePersistedDraft(liveSessionId, { replace: true });
    anchorTranscript();
    prepareSession();
    // switch-ready is intentionally cancelled before htmx's no-op swap, so it
    // has no htmx:sseMessage callback. Commit the incoming sequence namespace
    // here, after every transcript/live bootstrap frame and payload validation.
    if (state.latencySwitchId) {
      qqLatency.markSessionSwitchServerTimings(state.latencySwitchId, payload.timings);
      qqLatency.markSessionSwitchReady(state.latencySwitchId, document.body);
    }
    if (state.history === "push" && normalizedCanonical(meta.canonical)) {
      const canonical = normalizedCanonical(meta.canonical);
      history.replaceState(sessionHistoryState(liveSessionId, canonical), "", canonical);
      committedLocation = new URL(canonical, location.href).href;
    }
    if (state.exitWhenReady) {
      paintChairMode(false);
      commitSessionLocation(liveSessionId, meta.canonical || state.canonical, "push");
    }
    return true;
  };
  const liveSwitchOrNavigate = (sessionId, options, href) => {
    if (canLiveSwitch()) liveSwitch(sessionId, options);
    else void navigatePage(href);
  };
  const selectOverlayProject = (item) => {
    const projectItem = overlayProjectItem(item);
    if (!(projectItem instanceof HTMLElement)) return false;
    markLinkCurrent(projectItem);
    if (item !== projectItem && item instanceof Element) markLinkCurrent(item);
    if (projectItem.matches(".projects-session-item") || item?.matches?.(".projects-session-choice")) {
      const sessionId = projectItem.dataset.sessionId || item?.dataset?.sessionId || "";
      paintSessionTokens([], "", projectItem);
      if (!sessionId) {
        void navigatePage(projectItem.href);
        return true;
      }
      rememberOverlaySession(projectItem, sessionId, projectItem.href);
      liveSwitchOrNavigate(sessionId, {
        history: navMode() ? "none" : "push",
        canonical: projectItem.href,
      }, projectItem.href);
      return true;
    }
    if (filterLiveTrackerProject(projectItem)) return true;
    const sessions = readProjectSessions(projectItem);
    const currentId = sessions.some((session) => session.id === overlaySessionId)
      ? overlaySessionId
      : (projectItem.dataset.sessionId || sessions[0]?.id || "");
    paintSessionTokens(sessions, currentId, projectItem);
    const selected = sessions.find((session) => session.id === currentId) ?? sessions[0];
    const canonical = selectionCanonical(selected?.id || currentId, projectItem, selected?.href || projectItem.href);
    rememberOverlaySession(projectItem, selected?.id || currentId, canonical);
    if (!selected?.id) {
      void navigatePage(projectItem.href);
      return true;
    }
    liveSwitchOrNavigate(selected.id, {
      history: navMode() ? "none" : "push",
      canonical,
    }, projectItem.href);
    return true;
  };
  const selectOverlaySession = (link) => {
    if (!(link instanceof HTMLElement) || !link.dataset.sessionId) return false;
    markLinkCurrent(link);
    const tracker = link.matches(".live-tracker-session");
    const projectItem = tracker
      ? null
      : document.querySelector(".active-project-item[aria-current='page']");
    const canonical = tracker
      ? link.href
      : selectionCanonical(link.dataset.sessionId, projectItem, link.href);
    rememberOverlaySession(projectItem, link.dataset.sessionId, canonical);
    liveSwitchOrNavigate(link.dataset.sessionId, {
      history: navMode() ? "none" : "push",
      canonical,
    }, link.href);
    return true;
  };
  const paintChairMode = (nav, persist = true) => {
    if (nav) document.body.classList.add("nav-mode");
    else document.body.classList.remove("nav-mode");
    if (nav) scheduleSessionConnectors();
    else if (!desktopChair()) suppressSessionConnectors();
    else scheduleSessionConnectors();
    if (nav) {
      overlaySessionId = "";
      pendingCanonical = "";
      const prompt = composer();
      if (prompt instanceof HTMLTextAreaElement && document.activeElement === prompt) prompt.blur();
    }
    syncDrawerChrome();
    if (!persist) return;
    try { sessionStorage.setItem(CHAIR_MODE_KEY, nav ? "nav" : "session"); } catch { /* private mode */ }
  };
  const commitOverlaySession = () => {
    const desired = overlaySessionId;
    if (!desired) {
      paintChairMode(false);
      return true;
    }
    if (bootstrapSwitch?.id === desired) {
      bootstrapSwitch.exitWhenReady = true;
      return false;
    }
    if (desired !== liveSessionId) return false;
    const canonical = liveSwitchMeta?.canonical || pendingCanonical || committedLocation;
    paintChairMode(false);
    commitSessionLocation(liveSessionId, canonical, "push");
    return true;
  };
  const chairGo = (value, current = null) => {
    if (current instanceof Element) {
      if (current.matches(".active-project-item, .projects-choice") && selectOverlayProject(current)) return;
      if (current.matches(LIVE_SESSION_PICKER) && selectOverlaySession(current)) return;
    }
    void navigatePage(value, current);
  };
  const closeMobileRailAfterAction = () => {
    if (desktopChair() || !navMode()) return;
    commitOverlaySession();
    // A live switch commits its destination when bootstrap is ready, but the
    // mobile rail should not remain open while that work finishes.
    if (navMode()) paintChairMode(false);
  };
  const modifiedClick = (event) => event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
  const activateOverviewFromChooserClick = (event, target) => {
    if (event.defaultPrevented || modifiedClick(event) || !clearProjectFilterFromEmptySpace(target)) return false;
    event.preventDefault();
    return true;
  };
  const applyChairMode = (mode, persist = true) => {
    if (mode === "nav") {
      paintChairMode(true, persist);
      return;
    }
    if (persist) commitOverlaySession();
    else paintChairMode(false, false);
  };
  const restoreChairMode = () => {
    let mode = "session";
    try {
      if (sessionStorage.getItem(CHAIR_MODE_KEY) === "nav") mode = "nav";
    } catch { /* private mode */ }
    applyChairMode(mode, false);
  };
  const toggleChairMode = () => applyChairMode(navMode() ? "session" : "nav");
  const openDocumentViewerDialog = () => document.querySelector(".document-viewer-dialog[open]");
  const documentViewerIsOpen = () => Boolean(openDocumentViewerDialog());
  let documentViewerReturnFocus = null;
  let documentViewerHome = null;
  let documentViewerScroll = [];
  let documentViewerPriorInert = new WeakMap();
  const applyDocumentViewerPriorInert = (viewer) => {
    for (const node of document.body.children) {
      if (node === viewer) continue;
      if (documentViewerPriorInert.has(node)) node.inert = documentViewerPriorInert.get(node);
    }
  };
  const syncDocumentViewerChrome = (viewer, open) => {
    if (!(viewer instanceof Element)) return;
    if (open) {
      documentViewerPriorInert = new WeakMap();
      for (const node of document.body.children) {
        if (node === viewer) continue;
        documentViewerPriorInert.set(node, node.inert);
        node.inert = true;
      }
      return;
    }
    applyDocumentViewerPriorInert(viewer);
    requestAnimationFrame(() => applyDocumentViewerPriorInert(viewer));
  };
  const captureDocumentViewerScroll = (from) => {
    const seen = [];
    for (let node = from instanceof Element ? from : null; node; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1) {
        seen.push({ node, top: node.scrollTop, left: node.scrollLeft });
      }
    }
    documentViewerScroll = seen;
  };
  const restoreDocumentViewerScroll = () => {
    const restore = () => {
      for (const entry of documentViewerScroll) {
        if (!entry.node.isConnected) continue;
        entry.node.scrollTop = entry.top;
        entry.node.scrollLeft = entry.left;
      }
    };
    restore();
    requestAnimationFrame(restore);
  };
  const parkDocumentViewer = (viewer) => {
    if (viewer.parentElement === document.body) return;
    documentViewerHome = { parent: viewer.parentNode, next: viewer.nextSibling };
    document.body.append(viewer);
  };
  const unparkDocumentViewer = (viewer) => {
    const home = documentViewerHome;
    documentViewerHome = null;
    if (!home?.parent?.isConnected) {
      viewer.remove();
      return;
    }
    home.parent.insertBefore(viewer, home.next);
  };
  const restoreDocumentViewerFocus = () => {
    const opener = documentViewerReturnFocus;
    documentViewerReturnFocus = null;
    if (opener instanceof HTMLElement && opener.isConnected && !opener.inert) {
      opener.focus({ preventScroll: true });
    }
    restoreDocumentViewerScroll();
  };
  const closeDocumentViewer = (viewer = openDocumentViewerDialog()) => {
    if (!(viewer instanceof HTMLElement) || !viewer.open) return;
    viewer.close?.();
    if (viewer.open) {
      viewer.removeAttribute("open");
      syncDocumentViewerChrome(viewer, false);
      unparkDocumentViewer(viewer);
      restoreDocumentViewerFocus();
    }
  };
  const openDocumentViewer = (viewer, opener) => {
    if (!(viewer instanceof HTMLElement) || viewer.tagName !== "DIALOG") return;
    if (documentViewerIsOpen() && openDocumentViewerDialog() !== viewer) closeDocumentViewer();
    documentViewerReturnFocus = opener instanceof HTMLElement ? opener : document.activeElement;
    captureDocumentViewerScroll(documentViewerReturnFocus instanceof Element ? documentViewerReturnFocus : document.querySelector("#transcript, .document-viewer-proof"));
    parkDocumentViewer(viewer);
    syncDocumentViewerChrome(viewer, true);
    if (!viewer.open) {
      if (typeof viewer.showModal === "function") viewer.showModal();
      else viewer.setAttribute("open", "");
    }
    const heading = viewer.querySelector("h1");
    if (heading instanceof HTMLElement) heading.focus({ preventScroll: true });
  };
  const TOOL_INLINE_VIEWPORT_RATIO = 0.42;
  const toolInlineLimit = () => {
    const height = Number(window.visualViewport?.height)
      || Number(window.innerHeight)
      || Number(document.documentElement?.clientHeight)
      || 720;
    return height * TOOL_INLINE_VIEWPORT_RATIO;
  };
  const TOOL_MEDIA_WAIT_MS = 1_600;
  const toolLayoutFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const boundedToolMediaWait = (promise) => new Promise((resolve) => {
    let settled = false;
    const finish = (ready) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ready);
    };
    const timer = setTimeout(() => finish(false), TOOL_MEDIA_WAIT_MS);
    Promise.resolve(promise).then(() => finish(true), () => finish(true));
  });
  const waitForToolMediaEvent = (node, readyEvents) => new Promise((resolve) => {
    let settled = false;
    const done = (ready) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const eventName of readyEvents) node.removeEventListener(eventName, onReady);
      node.removeEventListener("error", onReady);
      resolve(ready);
    };
    const onReady = () => done(true);
    const timer = setTimeout(() => done(false), TOOL_MEDIA_WAIT_MS);
    for (const eventName of readyEvents) node.addEventListener(eventName, onReady, { once: true });
    node.addEventListener("error", onReady, { once: true });
  });
  const waitForToolMediaNode = async (node) => {
    if (node.tagName === "IMG") {
      if (!node.complete && !await waitForToolMediaEvent(node, ["load"])) return false;
      if (typeof node.decode === "function") {
        try { return boundedToolMediaWait(node.decode()); } catch { return true; }
      }
      return true;
    }
    if (node.tagName === "VIDEO" && Number(node.readyState) < 1) {
      return waitForToolMediaEvent(node, ["loadedmetadata"]);
    }
    return true;
  };
  const waitForToolMedia = async (body) => {
    const readiness = await Promise.all(
      [...body.querySelectorAll("img, video")].map(waitForToolMediaNode),
    );
    return readiness.every(Boolean);
  };
  const measureToolBody = (card, body) => {
    const rectWidth = Number(card.getBoundingClientRect?.().width)
      || Number(card.clientWidth)
      || Number(window.innerWidth)
      || 320;
    let horizontalPadding = 0;
    try {
      const style = getComputedStyle(card);
      horizontalPadding = (Number.parseFloat(style.paddingLeft) || 0)
        + (Number.parseFloat(style.paddingRight) || 0);
    } catch { /* the full card width is a safe fallback */ }
    card.style.setProperty("--tool-measure-width", `${Math.max(1, rectWidth - horizontalPadding)}px`);
    card.classList.add("tool-measuring");
    const height = Math.max(Number(body.scrollHeight) || 0, Number(body.getBoundingClientRect?.().height) || 0);
    card.classList.remove("tool-measuring");
    card.style.removeProperty("--tool-measure-width");
    return height;
  };
  const toolOutputUrl = (card) => {
    const href = String(card.dataset.toolHref ?? "").replace(/^\/+/, "");
    if (!href) return null;
    const transcript = card.closest("#transcript[data-tool-base]");
    const base = String(transcript?.dataset.toolBase ?? "") || location.pathname;
    const url = new URL(base, location.href);
    url.hash = "";
    url.search = "";
    url.pathname = `${url.pathname.replace(/\/+$/, "")}/${href}`;
    return url;
  };
  const presentToolBody = async (card, summary) => {
    const body = card.querySelector(":scope > .tool-body");
    if (!(body instanceof HTMLElement)) return;
    await toolLayoutFrame();
    const mediaReady = await waitForToolMedia(body);
    await toolLayoutFrame();
    if (!card.isConnected) return;
    const viewer = body.querySelector(".document-viewer-dialog");
    if (!mediaReady && viewer instanceof HTMLElement) {
      card.open = false;
      openDocumentViewer(viewer, summary);
      return;
    }
    const inlineHeight = measureToolBody(card, body) + 12;
    if (!(viewer instanceof HTMLElement) || inlineHeight <= toolInlineLimit()) {
      card.open = true;
      return;
    }
    card.open = false;
    openDocumentViewer(viewer, summary);
  };
  const loadToolBody = async (card) => {
    const body = card.querySelector(":scope > .tool-body");
    if (!(body instanceof HTMLElement)) return false;
    if (card.dataset.toolBodyState === "loaded") return true;
    if (card.dataset.toolBodyState === "loading") return false;
    const url = toolOutputUrl(card);
    if (!url) return false;
    card.dataset.toolBodyState = "loading";
    try {
      const response = await fetch(url, { headers: { Accept: "text/html", "HX-Request": "true" } });
      if (!response.ok) throw new Error(`tool output ${response.status}`);
      body.innerHTML = await response.text();
      globalThis.htmx?.process?.(body);
      card.dataset.toolBodyState = "loaded";
      return true;
    } catch {
      body.innerHTML = "<p class=\"tool-empty\">Tool output is unavailable</p>";
      card.dataset.toolBodyState = "error";
      return false;
    }
  };
  const activateToolCard = async (card, summary) => {
    if (!(card instanceof HTMLDetailsElement)) return;
    if (card.open) {
      card.open = false;
      return;
    }
    if (card.dataset.toolBodyState === "loading") return;
    card.setAttribute("aria-busy", "true");
    try {
      const ready = await loadToolBody(card);
      if (!card.isConnected) return;
      if (!ready && card.dataset.toolBodyState !== "error") return;
      await presentToolBody(card, summary);
    } finally {
      card.removeAttribute("aria-busy");
    }
  };
  document.addEventListener("close", (event) => {
    const viewer = event.target;
    if (!(viewer instanceof HTMLElement) || !viewer.classList.contains("document-viewer-dialog")) return;
    syncDocumentViewerChrome(viewer, false);
    unparkDocumentViewer(viewer);
    restoreDocumentViewerFocus();
  }, true);
  const updateDrawerUrl = (open) => {
    const url = new URL(location.href);
    if (open) url.searchParams.set("drawer", projectDrawer()?.dataset.drawerPath || "");
    else url.searchParams.delete("drawer");
    history.replaceState(history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };
  const panelFocusables = (panel) => {
    if (!panel) return [];
    return [...panel.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((node) => node instanceof HTMLElement && !node.hidden);
  };
  const drawerIsTransient = () => document.body.classList.contains("drawer-drag-active") || document.body.classList.contains("drawer-drag-settling");
  const panelIsTransient = () => drawerIsTransient();
  const syncDrawerChrome = () => {
    const drawer = projectDrawer();
    const rail = projectRail();
    const toggle = drawerToggle();
    const backdrop = drawerBackdrop();
    const filesOpen = drawerIsOpen();
    const transient = panelIsTransient();
    toggle?.setAttribute("aria-expanded", String(filesOpen));
    if (drawer) {
      drawer.setAttribute("aria-hidden", String(!filesOpen));
      drawer.inert = !filesOpen;
    }
    if (rail) {
      if (desktopChair() || navMode()) {
        rail.removeAttribute("aria-hidden");
        rail.inert = filesOpen;
      } else {
        rail.setAttribute("aria-hidden", "true");
        rail.inert = true;
      }
    }
    if (backdrop) {
      backdrop.hidden = !filesOpen && !transient;
      backdrop.setAttribute("aria-hidden", String(!filesOpen));
      backdrop.inert = !filesOpen;
    }
    for (const node of document.body?.children ?? []) {
      if (node === drawer || node === rail || node === backdrop) continue;
      node.inert = filesOpen;
    }
  };
  let drawerSettleTimer = null;
  const clearDrawerTransient = ({ sync = true } = {}) => {
    if (drawerSettleTimer !== null) clearTimeout(drawerSettleTimer);
    drawerSettleTimer = null;
    document.body.classList.remove("drawer-drag-active", "drawer-drag-settling");
    projectDrawer()?.style.removeProperty("transform");
    drawerBackdrop()?.style.removeProperty("opacity");
    if (sync) syncDrawerChrome();
  };
  const openDrawer = ({ updateUrl = true, focus = true, preserveTransient = false } = {}) => {
    const drawer = projectDrawer();
    if (!drawer) return;
    if (!preserveTransient) clearDrawerTransient({ sync: false });
    if (!drawerIsOpen()) {
      const active = document.activeElement;
      drawerReturnFocus = active instanceof HTMLElement && active !== document.body && !drawer.contains(active)
        ? active
        : null;
    }
    document.body.classList.add("drawer-open");
    syncDrawerChrome();
    if (updateUrl) updateDrawerUrl(true);
    if (focus) {
      const heading = document.querySelector("#project-drawer-title");
      if (heading instanceof HTMLElement) heading.focus({ preventScroll: true });
    }
  };
  const closeDrawer = ({ updateUrl = true, restoreFocus = true, preserveTransient = false } = {}) => {
    const drawer = projectDrawer();
    if (!drawer) return;
    if (!preserveTransient) clearDrawerTransient({ sync: false });
    const returnFocus = drawerReturnFocus;
    drawerReturnFocus = null;
    document.body.classList.remove("drawer-open");
    syncDrawerChrome();
    if (updateUrl) updateDrawerUrl(false);
    if (!restoreFocus) return;
    if (desktopChair()) drawerToggle()?.focus({ preventScroll: true });
    else if (returnFocus?.isConnected && !returnFocus.inert) returnFocus.focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement && drawer.contains(document.activeElement)) document.activeElement.blur();
  };
  const trapDrawerFocus = (event) => {
    const panel = drawerIsOpen() ? projectDrawer() : null;
    const focusable = panelFocusables(panel);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    const index = focusable.indexOf(document.activeElement);
    if (event.shiftKey && index <= 0) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (index < 0 || document.activeElement === last)) {
      event.preventDefault();
      first.focus();
    }
  };

  const FILE_RETURN_KIND = "qq-file-return";
  const FILE_RETURN_NAME_PREFIX = `${FILE_RETURN_KIND}:`;
  const filePageViewer = () => document.querySelector(".document-viewer-page");
  const currentHref = () => `${location.pathname}${location.search}${location.hash}`;
  const fileReturnHref = (href) => {
    try {
      const url = new URL(href, location.href);
      if (url.origin !== location.origin) return "";
      return `${url.pathname}${url.search}${url.hash}`;
    } catch {
      return "";
    }
  };
  const sameHref = (left, right) => fileReturnHref(left) === fileReturnHref(right);
  const mergeHistoryState = (patch) => {
    const current = history.state && typeof history.state === "object" ? { ...history.state } : {};
    return { ...current, ...patch };
  };
  const readFileReturnPayload = (value) => {
    const payload = value && typeof value === "object" ? value : null;
    if (!payload || payload.kind !== FILE_RETURN_KIND) return null;
    const href = fileReturnHref(payload.href);
    const fileHref = fileReturnHref(payload.fileHref);
    const openerPath = String(payload.openerPath ?? "").trim();
    if (!href || !fileHref || !openerPath || !fileHref.includes("/file/")) return null;
    return {
      kind: FILE_RETURN_KIND,
      href,
      fileHref,
      openerPath,
      transcriptTop: Number.isFinite(payload.transcriptTop) ? payload.transcriptTop : 0,
      nonce: String(payload.nonce ?? ""),
    };
  };
  const fileReturnState = (state = history.state) => {
    const owner = state && typeof state === "object" ? state : null;
    return readFileReturnPayload(owner?.qqFileReturn);
  };
  const fileFromState = (state = history.state) => {
    const owner = state && typeof state === "object" ? state : null;
    return readFileReturnPayload(owner?.qqFileFrom);
  };
  const writeWindowNamePayload = (payload) => {
    try { window.name = `${FILE_RETURN_NAME_PREFIX}${JSON.stringify(payload)}`; } catch {}
  };
  const readWindowNamePayload = () => {
    const raw = typeof window.name === "string" ? window.name : "";
    if (!raw.startsWith(FILE_RETURN_NAME_PREFIX)) return null;
    try {
      return readFileReturnPayload(JSON.parse(raw.slice(FILE_RETURN_NAME_PREFIX.length)));
    } catch {
      return null;
    }
  };
  const clearWindowName = () => {
    try {
      if (String(window.name ?? "").startsWith(FILE_RETURN_NAME_PREFIX)) window.name = "";
    } catch {}
  };
  const findFileOpener = (openerPath) => {
    const drawer = projectDrawer();
    if (!drawer) return null;
    return [...drawer.querySelectorAll("a.drawer-entry[data-file-path]")]
      .find((node) => node.dataset.filePath === openerPath) ?? null;
  };
  const recordFileReturnFromLink = (link) => {
    if (!(link instanceof HTMLElement) || String(link.tagName).toUpperCase() !== "A") return;
    const openerPath = String(link.dataset.filePath ?? "").trim();
    if (!openerPath) return;
    const fileHref = fileReturnHref(link.getAttribute("href") ?? link.href);
    if (!fileHref || !fileHref.includes("/file/")) return;
    const transcript = document.querySelector("#transcript");
    const payload = {
      kind: FILE_RETURN_KIND,
      href: currentHref(),
      fileHref,
      openerPath,
      transcriptTop: transcript ? transcript.scrollTop : 0,
      nonce: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    };
    writeWindowNamePayload(payload);
    try { history.replaceState(mergeHistoryState({ qqFileReturn: payload }), "", currentHref()); } catch {}
  };
  const adoptFileReturnFromWindowName = () => {
    if (!filePageViewer()) return;
    const named = readWindowNamePayload();
    clearWindowName();
    if (!named || !sameHref(named.fileHref, currentHref())) return;
    if (fileFromState()) return;
    try { history.replaceState(mergeHistoryState({ qqFileFrom: named }), "", currentHref()); } catch {}
  };
  const matchingFileReturnForBack = () => {
    const payload = fileFromState();
    if (!payload || !sameHref(payload.fileHref, currentHref())) return null;
    return payload;
  };
  const consumeFileReturn = () => {
    const current = history.state && typeof history.state === "object" ? { ...history.state } : {};
    if (!Object.hasOwn(current, "qqFileReturn")) return;
    delete current.qqFileReturn;
    try { history.replaceState(Object.keys(current).length ? current : null, "", currentHref()); } catch {}
  };
  const pendingFileReturn = () => {
    const payload = fileReturnState();
    return Boolean(payload && sameHref(payload.href, currentHref()));
  };
  const restoreFileReturnFromHistory = () => {
    if (filePageViewer()) return;
    const payload = fileReturnState();
    if (!payload) return;
    const matches = sameHref(payload.href, currentHref());
    if (matches) {
      if (!drawerIsOpen()) openDrawer({ updateUrl: false, focus: false });
      const transcript = document.querySelector("#transcript");
      if (transcript) {
        transcriptView = { follow: false, top: payload.transcriptTop };
        transcript.scrollTop = payload.transcriptTop;
        requestAnimationFrame(() => {
          const live = document.querySelector("#transcript");
          if (!live) return;
          live.scrollTop = payload.transcriptTop;
        });
      }
      const focusOpener = () => {
        const opener = findFileOpener(payload.openerPath);
        if (opener instanceof HTMLElement && opener.isConnected && !opener.inert && !opener.closest("[inert]")) {
          opener.focus({ preventScroll: true });
        }
      };
      focusOpener();
      requestAnimationFrame(focusOpener);
    }
    consumeFileReturn();
  };

  const surfaceGestureBlocked = (target) => {
    if (documentViewerIsOpen()) return true;
    if (target.closest("#project-drawer, #project-rail, #project-drawer-backdrop, .document-viewer, #session-chrome, .session-children, #composer, .session-composer, .session-popups")) return true;
    const transcript = target.closest("#transcript");
    // Transcript controls stay native for taps; only a horizontal lock takes the gesture.
    if (!transcript && target.closest("form, a, button, input, textarea, select, option, label, summary, audio, video, [contenteditable]:not([contenteditable=\"false\"]), [role=button], [role=link], [role=textbox], [role=slider], [role=spinbutton], [role=switch], [role=tab], [role=checkbox], [role=radio]")) return true;
    for (let node = target; node; node = node.parentElement) {
      if (!(node instanceof HTMLElement)) continue;
      const overflowX = getComputedStyle(node).overflowX;
      if ((overflowX === "auto" || overflowX === "scroll") && node.scrollWidth > node.clientWidth + 1) return true;
    }
    return false;
  };
  const findTouch = (touches, id) => {
    for (let index = 0; index < touches.length; index += 1) {
      if (touches[index].identifier === id) return touches[index];
    }
    return null;
  };
  let surfaceGesture = null;
  const activeTouchOptions = { capture: true, passive: false };
  const endSurfaceGesture = () => {
    surfaceGesture = null;
    document.removeEventListener("touchmove", moveSurfaceGesture, true);
    document.removeEventListener("touchend", finishSurfaceGesture, true);
    document.removeEventListener("touchcancel", finishSurfaceGesture, true);
  };
  const cancelSurfaceGesture = () => {
    const hadDrag = Boolean(surfaceGesture?.horizontal) || panelIsTransient();
    endSurfaceGesture();
    if (hadDrag) clearDrawerTransient();
  };
  const transitionMilliseconds = (node) => {
    if (!(node instanceof Element)) return 0;
    const values = getComputedStyle(node).transitionDuration.split(",");
    return Math.max(0, ...values.map((value) => {
      const duration = parseFloat(value) || 0;
      return value.trim().endsWith("ms") ? duration : duration * 1000;
    }));
  };
  const applySurfaceDrag = (gesture, distance) => {
    const panel = projectDrawer();
    const backdrop = drawerBackdrop();
    if (!panel || !backdrop) return;
    gesture.distance = Math.min(gesture.hiddenDistance, Math.max(0, distance));
    const progress = gesture.distance / gesture.hiddenDistance;
    panel.style.transform = `translate3d(calc(105% - ${gesture.distance}px), 0, 0)`;
    backdrop.style.opacity = String(progress);
    if (!document.body.classList.contains("drawer-drag-active")) {
      document.body.classList.add("drawer-drag-active");
      syncDrawerChrome();
    }
  };
  const settleSurfaceDrag = (gesture, open) => {
    const panel = projectDrawer();
    const backdrop = drawerBackdrop();
    if (!panel || !backdrop) {
      clearDrawerTransient();
      return;
    }
    document.body.classList.remove("drawer-drag-active");
    document.body.classList.add("drawer-drag-settling");
    if (open) {
      if (drawerIsOpen()) syncDrawerChrome();
      else openDrawer({ preserveTransient: true });
    } else if (drawerIsOpen()) closeDrawer({ preserveTransient: true });
    else syncDrawerChrome();
    panel.style.transform = open ? "translate3d(0, 0, 0)" : "translate3d(105%, 0, 0)";
    panel.getBoundingClientRect();
    backdrop.style.opacity = open ? "1" : "0";
    const settleFor = Math.max(transitionMilliseconds(panel), transitionMilliseconds(backdrop));
    drawerSettleTimer = setTimeout(() => clearDrawerTransient(), settleFor ? settleFor + 40 : 0);
  };
  function finishSurfaceGesture(event) {
    const gesture = surfaceGesture;
    const point = gesture && findTouch(event.changedTouches, gesture.id);
    if (!gesture || !point) return;
    endSurfaceGesture();
    if (!gesture.horizontal || event.type === "touchcancel") {
      if (gesture.horizontal && gesture.kind === "drawer") settleSurfaceDrag(gesture, gesture.mode === "close");
      return;
    }
    if (gesture.kind === "nav") {
      const dx = point.clientX - gesture.x;
      const releaseDelay = performance.now() - gesture.lastAt;
      const velocity = releaseDelay <= 120 ? gesture.velocity : 0;
      if (gesture.mode === "open") {
        if (dx >= 30 || velocity >= 0.25) applyChairMode("nav");
      } else if (gesture.mode === "close") {
        if (dx <= -30 || velocity <= -0.25) commitOverlaySession();
      }
      return;
    }
    if (gesture.kind === "drawer") {
      const travel = Math.abs(gesture.distance - (gesture.startDistance ?? 0));
      if (travel < 12) {
        settleSurfaceDrag(gesture, gesture.mode === "close");
        return;
      }
      const releaseDelay = performance.now() - gesture.lastAt;
      const velocity = releaseDelay <= 120 ? gesture.velocity : 0;
      const projectedDistance = gesture.distance + (-velocity) * 320;
      settleSurfaceDrag(gesture, projectedDistance >= gesture.hiddenDistance * .42);
    }
  }
  function moveSurfaceGesture(event) {
    const gesture = surfaceGesture;
    if (!gesture || event.touches.length !== 1) {
      cancelSurfaceGesture();
      return;
    }
    const point = findTouch(event.touches, gesture.id);
    if (!point) {
      cancelSurfaceGesture();
      return;
    }
    const now = performance.now();
    const dx = point.clientX - gesture.x;
    const dy = point.clientY - gesture.y;
    const absoluteX = Math.abs(dx);
    const absoluteY = Math.abs(dy);
    gesture.samples.push({ x: point.clientX, at: now });
    const cutoff = now - 120;
    while (gesture.samples.length > 1 && gesture.samples[0].at < cutoff) gesture.samples.shift();
    if (!gesture.horizontal) {
      if (absoluteY >= 10 && absoluteY > absoluteX * 1.15) {
        endSurfaceGesture();
        return;
      }
      if (gesture.kind === "nav") {
        const closeDx = dx;
        if (closeDx > 8) {
          endSurfaceGesture();
          return;
        }
        if (closeDx > -10 || absoluteX <= absoluteY * 1.45) return;
        gesture.horizontal = true;
      } else if (gesture.kind === "drawer") {
        const closeDx = -dx;
        if (closeDx > 8) {
          endSurfaceGesture();
          return;
        }
        if (closeDx > -10 || absoluteX <= absoluteY * 1.45) return;
        const panel = projectDrawer();
        if (!panel) {
          endSurfaceGesture();
          return;
        }
        gesture.horizontal = true;
        gesture.width = Math.max(1, panel.getBoundingClientRect().width || 1);
        gesture.hiddenDistance = gesture.width * 1.05;
        gesture.startDistance = gesture.hiddenDistance;
      } else {
        if (dx < -10 && absoluteX > absoluteY * 1.45) {
          const panel = projectDrawer();
          if (!panel) {
            endSurfaceGesture();
            return;
          }
          gesture.kind = "drawer";
          gesture.mode = "open";
          gesture.horizontal = true;
          gesture.width = Math.max(1, panel.getBoundingClientRect().width || 1);
          gesture.hiddenDistance = gesture.width * 1.05;
          gesture.startDistance = 0;
        } else if (dx > 10 && absoluteX > absoluteY * 1.45) {
          gesture.kind = "nav";
          gesture.mode = "open";
          gesture.horizontal = true;
        } else {
          return;
        }
      }
    }
    if (gesture.kind === "drawer") {
      const closing = gesture.mode === "close";
      const openDx = -dx;
      if (closing) {
        if (absoluteY > Math.max(18, absoluteX * .68)) {
          cancelSurfaceGesture();
          return;
        }
      } else if (openDx <= 0 || absoluteY > Math.max(18, openDx * .68)) {
        cancelSurfaceGesture();
        return;
      }
      event.preventDefault();
      const anchor = gesture.samples[0];
      gesture.velocity = (point.clientX - anchor.x) / Math.max(1, now - anchor.at);
      gesture.lastAt = now;
      applySurfaceDrag(gesture, closing ? gesture.startDistance + openDx : openDx);
    } else if (gesture.kind === "nav") {
      event.preventDefault();
      const anchor = gesture.samples[0];
      gesture.velocity = (point.clientX - anchor.x) / Math.max(1, now - anchor.at);
      gesture.lastAt = now;
      gesture.distance = dx;
    }
  }
  document.addEventListener("touchstart", (event) => {
    if (surfaceGesture) cancelSurfaceGesture();
    else if (panelIsTransient()) clearDrawerTransient();
    const target = event.target instanceof Element ? event.target : null;
    if (!target || event.defaultPrevented || event.touches.length !== 1 || desktopChair()) return;
    const point = event.touches[0];
    const now = performance.now();
    if (navMode()) {
      surfaceGesture = {
        kind: "nav",
        mode: "close",
        id: point.identifier,
        x: point.clientX,
        y: point.clientY,
        lastAt: now,
        distance: 0,
        startDistance: 0,
        velocity: 0,
        horizontal: false,
        samples: [{ x: point.clientX, at: now }],
      };
    } else if (drawerIsOpen()) {
      if (!target.closest("#project-drawer, #project-drawer-backdrop")) return;
      surfaceGesture = {
        kind: "drawer",
        mode: "close",
        id: point.identifier,
        x: point.clientX,
        y: point.clientY,
        lastAt: now,
        distance: 0,
        startDistance: 0,
        velocity: 0,
        horizontal: false,
        samples: [{ x: point.clientX, at: now }],
      };
    } else if (surfaceGestureBlocked(target)) return;
    else {
      surfaceGesture = {
        kind: "surface",
        mode: "open",
        id: point.identifier,
        x: point.clientX,
        y: point.clientY,
        lastAt: now,
        distance: 0,
        startDistance: 0,
        velocity: 0,
        horizontal: false,
        samples: [{ x: point.clientX, at: now }],
      };
    }
    document.addEventListener("touchmove", moveSurfaceGesture, activeTouchOptions);
    document.addEventListener("touchend", finishSurfaceGesture, { capture: true, passive: true });
    document.addEventListener("touchcancel", finishSurfaceGesture, { capture: true, passive: true });
  }, { capture: true, passive: true });
  window.addEventListener("pagehide", cancelSurfaceGesture);
  window.addEventListener("beforeunload", cancelSurfaceGesture);
  window.addEventListener("popstate", () => {
    cancelSurfaceGesture();
    const sessionMatch = location.pathname.match(/\/session\/(session-[0-9a-fA-F-]{36})\/?$/);
    if (history.state?.qqPage && sessionMatch) {
      const sessionId = sessionMatch[1];
      committedLocation = location.href;
      overlaySessionId = sessionId;
      pendingCanonical = location.href;
      liveSwitch(sessionId, { history: "none", canonical: location.href });
      return;
    }
    if (history.state?.qqPage) {
      const gen = ++navGeneration;
      void prefetchPage(location.href, "high")?.then((page) => {
        if (gen !== navGeneration) return;
        if (!page?.html || !adoptPage(page.html, location.href, "none")) throw new Error("adopt");
      }).catch(() => {
        if (gen !== navGeneration) return;
        location.reload();
      });
      return;
    }
    restoreTranscriptView();
  });
  let pendingClose = false;

  document.addEventListener("change", (event) => {
    const select = event.target;
    if (!(select instanceof HTMLSelectElement) || select.id !== "session-choice") return;
    if (select.value) openSession(select.value);
  });

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (desktopChair() || !navMode() || !(form instanceof HTMLFormElement)
      || !form.matches(".session-traversal .new-session")) return;
    // Observe the native submission rather than replacing the button's action.
    // This keeps pointer and keyboard activation single-shot.
    paintChairMode(false);
  });

  document.addEventListener("pointerdown", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement) || link.hasAttribute("data-native-navigation")) return;
    const picker = link.matches(`.active-project-item, .projects-choice, ${LIVE_SESSION_PICKER}`);
    if (picker) return;
    const url = consolePageUrl(link.href);
    if (!url || (url.pathname === location.pathname && url.search === location.search)) return;
    abortPrefetchesExcept(url.href);
    prefetchPage(url.href);
  }, { capture: true, passive: true });
  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || modifiedClick(event)) return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self")
      || link.hasAttribute("download") || link.hasAttribute("data-native-navigation")) return;
    const url = consolePageUrl(link.href);
    const picker = link.matches(`.active-project-item, .projects-choice, ${LIVE_SESSION_PICKER}`);
    if (!url) return;
    if (!picker && url.pathname === location.pathname && url.search === location.search) return;
    const filterOnlyProject = link.matches(".active-project-item[data-project], .projects-choice[data-project]")
      && Boolean(document.querySelector(".live-tracker"));
    const closesMobileRail = picker && !filterOnlyProject && !desktopChair() && navMode()
      && Boolean(link.closest("#project-rail, .session-traversal"));
    event.preventDefault();
    void chairGo(url.href, link);
    if (closesMobileRail) closeMobileRailAfterAction();
  }, true);
  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const usageChoice = target?.closest(".usage-choice");
    if (usageChoice instanceof HTMLAnchorElement && event.button === 0
      && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      showUsageView();
      return;
    }
    if (target?.closest(".usage-close")) {
      event.preventDefault();
      closeUsageView();
      return;
    }
    if (!target?.closest(".console-menu")) closeConsoleMenu();
    const toolCard = target?.closest(".message-tool[data-tool-output]");
    const toolSummary = toolCard?.querySelector(":scope > summary[data-tool-output-summary]");
    if (toolCard instanceof HTMLDetailsElement && toolSummary instanceof HTMLElement
      && (!toolCard.open || toolSummary.contains(target))) {
      event.preventDefault();
      void activateToolCard(toolCard, toolSummary);
      return;
    }
    const fileLink = target?.closest("a.drawer-entry[data-file-path][href]");
    if (fileLink instanceof HTMLElement && event.button === 0 && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      recordFileReturnFromLink(fileLink);
    }
    const fileClose = target?.closest("a.document-viewer-close");
    if (fileClose instanceof HTMLElement && filePageViewer() && event.button === 0 && !event.defaultPrevented && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      if (matchingFileReturnForBack() && typeof history.back === "function") {
        event.preventDefault();
        history.back();
        return;
      }
    }
    const viewerOpen = target?.closest("[data-document-viewer-open]");
    if (viewerOpen instanceof HTMLElement) {
      event.preventDefault();
      const viewer = document.getElementById(viewerOpen.getAttribute("data-document-viewer-open") ?? "");
      if (viewer) openDocumentViewer(viewer, viewerOpen);
      return;
    }
    if (target?.closest("[data-document-viewer-close]")) {
      event.preventDefault();
      closeDocumentViewer(target.closest(".document-viewer-dialog") ?? openDocumentViewerDialog());
      return;
    }
    if (target?.closest("#project-drawer-toggle")) {
      event.preventDefault();
      if (drawerIsOpen()) closeDrawer();
      else openDrawer();
      return;
    }
    if (target?.closest(".drawer-close")) {
      event.preventDefault();
      closeDrawer();
      return;
    }
    const dismiss = target?.closest(".workflows-dismiss");
    if (dismiss instanceof HTMLElement) {
      event.preventDefault();
      dismiss.closest(".workflows-popup")?.remove();
      return;
    }
    if (activateOverviewFromChooserClick(event, target)) return;
    const traversalAction = target?.closest(".session-traversal a[href], .session-traversal button, .session-traversal input, .session-traversal select, .session-traversal textarea, .session-traversal [role=button], .session-traversal [role=link]");
    if (!desktopChair() && !traversalAction
      && target?.closest(".session-heading-start, .session-project, .session-mobile-id, .session-place")) {
      event.preventDefault();
      toggleChairMode();
      return;
    }
    if (navMode() && !target?.closest("#project-rail, .session-traversal")) {
      event.preventDefault();
      commitOverlaySession();
      return;
    }
    const arm = target?.closest(".close-arm");
    if (arm instanceof HTMLElement) {
      event.preventDefault();
      armClose();
      return;
    }
    if (confirmingClose() && !target?.closest(".session-item-current")) {
      disarmClose();
    }
  });

  document.addEventListener("toggle", (event) => {
    const menu = event.target;
    if (!(menu instanceof HTMLDetailsElement)) return;
    if (!menu.open) return;
    if (!menu.classList.contains("session-menu") && !menu.classList.contains("console-menu") && !menu.classList.contains("projects-menu")) return;
    for (const other of document.querySelectorAll("details.session-menu, details.console-menu, details.projects-menu")) {
      if (other !== menu) other.open = false;
    }
  }, true);

  document.addEventListener("input", (event) => {
    if (event.target instanceof HTMLTextAreaElement && event.target.id === "prompt") {
      fitComposer(event.target);
      persistComposerDraft(event.target);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    if (documentViewerIsOpen()) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDocumentViewer();
      }
      return;
    }
    if (event.key === "Escape" && confirmingClose()) {
      event.preventDefault();
      disarmClose();
      restoreCloseFocus();
      return;
    }
    if (drawerIsOpen()) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDrawer();
      } else if (event.key === "Tab") {
        trapDrawerFocus(event);
      }
      return;
    }
    if (clearProjectFilterFromChooserKey(event)) return;
    const input = event.target;
    const inComposer = input instanceof HTMLTextAreaElement && input.id === "prompt";

    if (inComposer) {
      pendingClose = false;
      if (event.key === "Tab") {
        event.preventDefault();
        completeSlash(input);
        return;
      }
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        input.form?.requestSubmit();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (confirmingClose()) {
          disarmClose();
          restoreCloseFocus();
          return;
        }
        if (document.querySelector("#interrupt-form")) {
          submitForm("#interrupt-form");
          return;
        }
        if (dismissSheet()) return;
        input.blur();
      }
      return;
    }

    if (!desktopChair()) return;
    if (editingElsewhere(input)) return;

    const key = event.key;
    if (handleConsoleMenuKey(event)) return;
    if (handleProjectTreeKey(event)) return;
    if (pendingClose) {
      if (key === "x" || key === "X") {
        event.preventDefault();
        pendingClose = false;
        if (document.querySelector(".overlay-popup")) {
          clickButton('.overlay-dismiss button[value="dismiss"]');
          return;
        }
        if (document.querySelector(".workflows-popup")) {
          document.querySelector(".workflows-popup")?.remove();
          return;
        }
        if (closeConsoleMenu()) return;
        submitForm("#close-session");
        return;
      }
      pendingClose = false;
      if (key === "Escape") {
        event.preventDefault();
        return;
      }
    }

    if (key === "Enter") {
      event.preventDefault();
      composer()?.focus();
      return;
    }
    if (key === "Escape") {
      event.preventDefault();
      if (confirmingClose()) {
        disarmClose();
        restoreCloseFocus();
        return;
      }
      if (document.querySelector("#interrupt-form")) {
        submitForm("#interrupt-form");
        return;
      }
      dismissSheet();
      return;
    }
    if (key === "n" || key === "N") {
      const create = document.querySelector(".new-session:not([hidden])");
      if (!(create instanceof HTMLFormElement)) return;
      event.preventDefault();
      create.requestSubmit();
      return;
    }
    const overlay = document.querySelector(".overlay-popup");
    if (overlay) {
      const reserved = key === "h" || key === "H" || key === "q" || key === "Q" || key === "x" || key === "X" || key === "Escape";
      let bound = null;
      try { bound = JSON.parse(overlay.dataset.overlayKeys || "{}"); } catch { bound = null; }
      const action = !reserved && bound && bound[key];
      if (typeof action === "string" && action) {
        event.preventDefault();
        clickButton(`.overlay-${action}`);
        return;
      }
    }
    if (key === "f" || key === "F") {
      event.preventDefault();
      setProjectTreeOpen(!projectTreeIsOpen(), true);
      return;
    }
    if (key === "w" || key === "W") {
      event.preventDefault();
      openConsoleMenu();
      return;
    }
    if (key === "ArrowUp") {
      event.preventDefault();
      neighborProject(-1);
      return;
    }
    if (key === "ArrowDown") {
      event.preventDefault();
      neighborProject(1);
      return;
    }
    if (key === "ArrowLeft") {
      event.preventDefault();
      neighborSession(-1);
      return;
    }
    if (key === "ArrowRight") {
      event.preventDefault();
      neighborSession(1);
      return;
    }
    if (key === "q" || key === "Q") {
      event.preventDefault();
      pendingClose = true;
      return;
    }
    if (key === " " || key === "Spacebar") {
      event.preventDefault();
      document.dispatchEvent(new CustomEvent("qq:desktop-dictation-toggle"));
      return;
    }
    if (key === "1") {
      event.preventDefault();
      clickButton(".offer-handoff");
      return;
    }
    if (key === "2") {
      event.preventDefault();
      clickButton(".offer-bank");
      return;
    }
    if (key === "3") {
      event.preventDefault();
      clickButton(".offer-ignore");
      return;
    }
    if (key === "j" || key === "J") {
      event.preventDefault();
      scrollTranscript("up");
      return;
    }
    if (key === "k" || key === "K") {
      event.preventDefault();
      scrollTranscript("down");
      return;
    }
    if (key === "PageUp") {
      event.preventDefault();
      scrollTranscript("up");
      return;
    }
    if (key === "PageDown") {
      event.preventDefault();
      scrollTranscript("down");
      return;
    }
    if (key === "Home") {
      event.preventDefault();
      scrollTranscript("home");
      return;
    }
    if (key === "End") {
      event.preventDefault();
      scrollTranscript("end");
      return;
    }
    if (key === "h" || key === "H") event.preventDefault();
  });

  document.addEventListener("htmx:configRequest", (event) => {
    promptEchoes.configRequest(event);
  });
  document.addEventListener("htmx:beforeRequest", (event) => {
    promptEchoes.beforeRequest(event);
  });
  document.addEventListener("htmx:afterRequest", (event) => {
    promptEchoes.afterRequest(event);
  });
  document.addEventListener("scroll", (event) => {
    if (event.target?.id === "transcript") onTranscriptUserScroll(event.target);
    if (event.target?.matches?.(".active-projects, .live-tracker")) scheduleSessionConnectors();
  }, true);
  const visualViewport = window.visualViewport;
  if (visualViewport && typeof visualViewport.addEventListener === "function") {
    visualViewport.addEventListener("resize", () => {
      if (transcriptView.follow) showLatest();
    });
  }
  // Jitter buffer for visible text: hold the start of a burst, then leak
  // characters at a steady rate so a 0ms slab does not read as fast→stall→fast.
  // Catchup may rise toward MAX_CPS so we do not trail forever, but it must
  // not collapse a dump back into a 400ms blob.
  const LIVE_SMOOTH_START_MS = 96;
  const LIVE_SMOOTH_IDLE_MS = 180;
  const LIVE_SMOOTH_CPS = 36;
  const LIVE_SMOOTH_MAX_CPS = 52;
  const LIVE_SMOOTH_MAX_CATCHUP_MS = 4000;
  const liveBuffers = new Map();
  let liveRaf = 0;
  let liveStartTimer = 0;
  const liveSmoothOn = () => ownScript?.dataset.liveSmooth === "1";
  const liveNow = () => (typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now());
  const PROVIDER_GAP_SILENCE_MS = 1000;
  const PROVIDER_GAP_ELAPSED_MS = 1000;
  let providerGapSince = 0;
  let providerGapArmed = false;
  let providerGapAwaiting = false;
  let providerGapStopping = false;
  let providerGapWatch = 0;
  let providerGapTick = 0;
  let providerGapShownSecond = -1;
  const turnIsRunning = () => !providerGapStopping && (providerGapAwaiting || Boolean(document.querySelector("#interrupt-submit")));
  const liveToolRunning = () => {
    const tail = document.getElementById?.("transcript-live-nodes") ?? document.querySelector?.("#transcript-live-nodes");
    return Boolean(tail?.querySelector?.(".message-tool.tool-running"));
  };
  const clearProviderGapTimers = () => {
    if (providerGapWatch) {
      clearTimeout(providerGapWatch);
      providerGapWatch = 0;
    }
    if (providerGapTick) {
      clearInterval(providerGapTick);
      providerGapTick = 0;
    }
  };
  const providerGapSlot = () => document.getElementById?.("provider-gap") ?? document.querySelector?.(".provider-gap");
  const hideProviderGap = () => {
    const gap = providerGapSlot();
    if (gap) {
      gap.dataset.state = "idle";
      gap.setAttribute("data-state", "idle");
      gap.setAttribute("aria-hidden", "true");
      gap.removeAttribute("aria-label");
      const elapsed = gap.querySelector(".provider-gap-elapsed");
      if (elapsed) {
        elapsed.hidden = true;
        elapsed.textContent = "";
      }
    }
    providerGapShownSecond = -1;
    if (providerGapTick) {
      clearInterval(providerGapTick);
      providerGapTick = 0;
    }
  };
  resetAdoptedSession = () => {
    promptEchoes.reset();
    liveBuffers.clear();
    if (liveRaf) {
      cancelAnimationFrame(liveRaf);
      liveRaf = 0;
    }
    if (liveStartTimer) {
      clearTimeout(liveStartTimer);
      liveStartTimer = 0;
    }
    clearProviderGapTimers();
    providerGapArmed = false;
    providerGapAwaiting = false;
    providerGapStopping = false;
    providerGapSince = 0;
    hideProviderGap();
  };
  const paintProviderGap = () => {
    let gap = providerGapSlot();
    if (!gap) {
      const host = document.getElementById?.("transcript-live") ?? document.querySelector?.("#transcript-live");
      if (!host || typeof document.createElement !== "function") return;
      gap = document.createElement("div");
      gap.id = "provider-gap";
      gap.className = "provider-gap";
      gap.setAttribute("role", "status");
      gap.setAttribute("aria-live", "polite");
      gap.setAttribute("aria-atomic", "true");
      gap.innerHTML = '<span class="provider-gap-caret" aria-hidden="true"></span><span class="provider-gap-elapsed" hidden></span>';
      host.append(gap);
    }
    gap.dataset.state = "on";
    gap.setAttribute("data-state", "on");
    gap.removeAttribute("aria-hidden");
    const waited = Math.max(0, liveNow() - providerGapSince);
    const elapsed = gap.querySelector(".provider-gap-elapsed");
    if (waited >= PROVIDER_GAP_ELAPSED_MS && elapsed) {
      const seconds = Math.max(1, Math.round(waited / 1000));
      elapsed.hidden = false;
      elapsed.textContent = `${seconds}s`;
      if (seconds !== providerGapShownSecond) {
        providerGapShownSecond = seconds;
        gap.setAttribute("aria-label", `Waiting for model · ${seconds}s`);
      }
    } else {
      gap.setAttribute("aria-label", "Waiting for model");
    }
    followLatest();
  };
  const syncProviderGap = () => {
    if (!turnIsRunning() || liveToolRunning()) {
      hideProviderGap();
      return;
    }
    if (liveNow() - providerGapSince < PROVIDER_GAP_SILENCE_MS) return;
    paintProviderGap();
    if (!providerGapTick) providerGapTick = setInterval(syncProviderGap, 250);
  };
  const scheduleProviderGap = () => {
    if (providerGapWatch) clearTimeout(providerGapWatch);
    providerGapWatch = setTimeout(() => {
      providerGapWatch = 0;
      syncProviderGap();
    }, PROVIDER_GAP_SILENCE_MS);
  };
  const noteLiveActivity = () => {
    hideProviderGap();
    providerGapSince = liveNow();
    if (turnIsRunning()) scheduleProviderGap();
  };
  const syncProviderGapForTurn = () => {
    if (document.querySelector("#interrupt-submit")) providerGapAwaiting = false;
    if (!document.querySelector("#interrupt-submit")) providerGapStopping = false;
    if (!turnIsRunning()) {
      providerGapArmed = false;
      providerGapAwaiting = false;
      providerGapStopping = false;
      clearProviderGapTimers();
      hideProviderGap();
      return;
    }
    if (!providerGapArmed) {
      providerGapArmed = true;
      providerGapSince = liveNow();
    }
    if (liveToolRunning()) {
      hideProviderGap();
      scheduleProviderGap();
      return;
    }
    scheduleProviderGap();
  };
  const armProviderGapFromSend = () => {
    providerGapStopping = false;
    providerGapAwaiting = true;
    providerGapArmed = true;
    providerGapSince = liveNow();
    scheduleProviderGap();
  };
  document.addEventListener("htmx:beforeRequest", (event) => {
    const form = event.detail?.elt;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.id === "composer") {
      armProviderGapFromSend();
      return;
    }
    if (form.id !== "interrupt-form") return;
    providerGapStopping = true;
    providerGapAwaiting = false;
    providerGapArmed = false;
    clearProviderGapTimers();
    hideProviderGap();
  });
  document.addEventListener("htmx:afterRequest", (event) => {
    const form = event.detail?.elt;
    if (!(form instanceof HTMLFormElement) || form.id !== "composer") return;
    const failed = event.detail?.successful === false || event.detail?.failed === true;
    if (!failed) return;
    providerGapAwaiting = false;
    syncProviderGapForTurn();
  });
  const paintLiveSlice = (state, take, presentationOpportunity) => {
    if (take <= 0) return;
    const slice = state.committed.slice(state.painted, state.painted + take);
    state.painted += slice.length;
    const textNode = state.block.firstChild;
    if (textNode?.nodeType === 3 && textNode === state.block.lastChild && typeof textNode.appendData === "function") {
      textNode.appendData(slice);
    } else {
      state.block.append(slice);
    }
    if (presentationOpportunity !== null) qqLatency.markStreamPaint(state.block, presentationOpportunity);
  };
  const flushLiveElt = (elt) => {
    for (const [key, state] of liveBuffers) {
      if (state.elt !== elt) continue;
      paintLiveSlice(state, state.committed.length - state.painted, null);
      liveBuffers.delete(key);
    }
  };
  const playLive = (frameTime) => {
    liveRaf = 0;
    const now = liveNow();
    const presentationOpportunity = frameTime ?? now;
    let againAt = Infinity;
    for (const state of liveBuffers.values()) {
      const pending = state.committed.length - state.painted;
      if (pending <= 0) continue;
      if (now < state.startAt) {
        againAt = Math.min(againAt, state.startAt);
        continue;
      }
      const dt = Math.max(0, now - state.lastTick);
      state.lastTick = now;
      let cps = LIVE_SMOOTH_CPS;
      const catchup = pending / (LIVE_SMOOTH_MAX_CATCHUP_MS / 1000);
      if (catchup > cps) cps = Math.min(LIVE_SMOOTH_MAX_CPS, catchup);
      const take = Math.min(pending, Math.max(1, Math.floor((cps * dt) / 1000) || 1));
      paintLiveSlice(state, take, presentationOpportunity);
      if (state.committed.length > state.painted) againAt = Math.min(againAt, now + 16);
      else state.emptyAt = now;
    }
    followLatest();
    if (againAt < Infinity) scheduleLive(againAt - now);
  };
  const scheduleLive = (delayMs) => {
    if (delayMs > 4) {
      if (liveStartTimer) return;
      liveStartTimer = setTimeout(() => {
        liveStartTimer = 0;
        scheduleLive(0);
      }, delayMs);
      return;
    }
    if (liveRaf) return;
    liveRaf = requestAnimationFrame(playLive);
  };
  const appendLiveChars = (block, text) => {
    const textNode = block.firstChild;
    if (textNode?.nodeType === 3 && textNode === block.lastChild && typeof textNode.appendData === "function") {
      textNode.appendData(text);
    } else {
      block.append(text);
    }
  };
  const liveTailElement = (elt) => {
    if (elt instanceof HTMLElement && elt.id === "transcript-live-nodes") return elt;
    return document.getElementById?.("transcript-live-nodes") ?? document.querySelector?.("#transcript-live-nodes");
  };
  const applyLivePatch = (elt, data, { smooth = true } = {}) => {
    const tail = liveTailElement(elt);
    if (!(tail instanceof HTMLElement) || typeof data !== "string" || data.length === 0) return false;
    let patch;
    try {
      patch = JSON.parse(data);
    } catch {
      return false;
    }
    if (!patch || typeof patch.op !== "string" || typeof patch.key !== "string") return false;

    if (patch.op === "qq-live-insert" || patch.op === "qq-live-replace") {
      if (typeof patch.html !== "string") return false;
      const target = document.getElementById?.(patch.key) ?? null;
      if (patch.op === "qq-live-insert") {
        if (target && typeof patch.inner === "string") {
          flushLiveElt(tail);
          target.innerHTML = patch.inner;
          globalThis.htmx?.process?.(target);
        } else if (!target && typeof tail.insertAdjacentHTML === "function") {
          tail.insertAdjacentHTML("beforeend", patch.html);
          const inserted = document.getElementById?.(patch.key) ?? tail.lastElementChild;
          globalThis.htmx?.process?.(inserted ?? tail);
        }
        return true;
      }
      // Seal and tool progress restyle only their stable wrapper. Flush any
      // jitter-buffered suffix first so a replacement cannot strand tokens.
      if (target) {
        flushLiveElt(tail);
        target.innerHTML = patch.html;
        globalThis.htmx?.process?.(target);
      }
      return true;
    }

    if (patch.op !== "qq-live-append"
      || !Number.isSafeInteger(patch.from)
      || patch.from < 0
      || typeof patch.text !== "string") return false;
    const block = [...tail.querySelectorAll(".message-live-text")]
      .find((node) => node.dataset.liveKey === patch.key);
    // A recognized append frame must never fall through to HTMX's innerHTML
    // swap. If a reconnect raced an old DOM, the next full live frame
    // recommissions the tail without painting protocol JSON.
    if (!block) return true;
    const state = liveBuffers.get(patch.key);
    const from = state ? state.committed.length : (block.textContent ?? "").length;
    if (from !== patch.from) return true;
    const buffered = smooth && liveSmoothOn() && !block.classList.contains("tool-argument");
    if (!buffered) {
      appendLiveChars(block, patch.text);
      if (state) {
        state.committed += patch.text;
        state.painted = state.committed.length;
      }
      return true;
    }
    const next = state ?? {
      elt: tail,
      block,
      committed: block.textContent ?? "",
      painted: (block.textContent ?? "").length,
      startAt: 0,
      lastTick: 0,
      emptyAt: 0,
    };
    const wasEmpty = next.committed.length === next.painted;
    next.committed += patch.text;
    if (wasEmpty) {
      const now = liveNow();
      const continueBurst = next.emptyAt > 0 && (now - next.emptyAt) < LIVE_SMOOTH_IDLE_MS;
      next.startAt = continueBurst ? now : now + LIVE_SMOOTH_START_MS;
      next.lastTick = next.startAt;
    }
    liveBuffers.set(patch.key, next);
    scheduleLive(Math.max(0, next.startAt - liveNow()));
    return true;
  };
  const swapTargetId = (event) => event.detail?.target?.id || event.target?.id || "";
  const touchesComposer = (id) =>
    id === "session-panel" || id === "session-composer" || id === "session-queue" || id === "pending-queue" || id === "composer";
  const touchesTranscript = (id) =>
    id === "session-panel" || id === "transcript" || id === "transcript-log" || id === "transcript-live"
      || id === "transcript-live-nodes" || id === "transcript-anchor"
      || id.startsWith("live-node-") || id.startsWith("live-assistant-");
  const touchesPromptTruth = (id) => touchesTranscript(id)
    || id === "transcript-settled" || id === "session-queue" || id === "pending-queue";
  for (const eventName of ["htmx:beforeSwap", "htmx:sseBeforeMessage"]) {
    document.addEventListener(eventName, (event) => {
      const id = swapTargetId(event);
      if (touchesComposer(id)) captureDraft();
      if (touchesTranscript(id)) captureTranscriptView();
    });
  }
  const ownGeneration = ownScript?.dataset.uiGeneration ?? "";
  document.addEventListener("htmx:sseBeforeMessage", (event) => {
    const elt = event.target instanceof HTMLElement ? event.target : event.detail?.target;
    const source = typeof EventSource !== "undefined" && event.detail?.target instanceof EventSource
      ? event.detail.target
      : null;
    if (source && bootstrapSwitch?.sourceUrl && source.url !== bootstrapSwitch.sourceUrl) {
      event.preventDefault();
      return;
    }
    if (source && activeSseSource && source !== activeSseSource) {
      event.preventDefault();
      return;
    }
    if (elt instanceof HTMLElement
      && elt.id === "session-composer"
      && event.detail?.type === "composer-shell") {
      const currentComposer = document.querySelector("#composer");
      if (currentComposer instanceof HTMLElement) {
        currentComposer.removeAttribute("hx-preserve");
        currentComposer.removeAttribute("id");
      }
    }
    const data = typeof event.detail?.data === "string"
      ? event.detail.data
      : typeof event.detail?.elt?.id === "string" && typeof event.data === "string"
        ? event.data
        : "";
    if (elt instanceof HTMLElement && (elt.id === "switch-meta" || elt.id === "switch-ready")) {
      event.preventDefault();
      let payload;
      try { payload = JSON.parse(data); } catch { return; }
      const state = bootstrapSwitch;
      if (!state
        || String(payload?.id || "") !== state.id
        || String(payload?.generation ?? "") !== String(state.generation)) return;
      if (elt.id === "switch-meta") {
        state.meta = payload;
        return;
      }
      const readyKeys = payload && typeof payload === "object" && !Array.isArray(payload)
        ? Object.keys(payload) : [];
      const timingEnvelopeIsFixed = readyKeys.every((key) => ["id", "generation", "timings"].includes(key));
      if (!timingEnvelopeIsFixed) return;
      finishLiveSwitch({
        id: state.id,
        generation: state.generation,
        timings: timingEnvelopeIsFixed
          ? qqLatency.normalizeSessionSwitchServerTimings(payload.timings)
          : null,
      });
      return;
    }
    if (elt instanceof HTMLElement && elt.id === "ui-generation") {
      event.preventDefault();
      const incoming = data;
      if (ownGeneration && incoming && incoming !== ownGeneration) {
        persistComposerDraft();
        location.reload();
      }
      return;
    }
    if (applyLivePatch(elt, data)) {
      event.preventDefault();
      noteLiveActivity();
      if (!liveSmoothOn()) followLatest();
      return;
    }
    if (elt?.id === "transcript-live-nodes" && typeof data === "string") {
      flushLiveElt(elt);
      noteLiveActivity();
    }
  });
  const paintLiveChannel = (channel, data) => {
    const elt = document.getElementById?.("transcript-live-nodes") ?? document.querySelector?.("#transcript-live-nodes");
    if (!applyLivePatch(elt, data, { smooth: channel !== "live-tool-append" })) return;
    noteLiveActivity();
    followLatest();
  };
  document.addEventListener("htmx:sseOpen", (event) => {
    const source = event.detail?.source;
    if (!source || typeof source.addEventListener !== "function") return;
    const stream = document.querySelector("#console-stream");
    let expected = "";
    try { expected = new URL(stream?.getAttribute("sse-connect") || "", location.href).href; } catch {}
    if (source.url && expected && source.url !== expected) {
      if (activeSseSource === source) activeSseSource = null;
      source.close?.();
      return;
    }
    activeSseSource = source;
    if (source.qqLiveBound) return;
    source.qqLiveBound = true;
    source.addEventListener("live-append", (message) => {
      if (source !== activeSseSource) return;
      paintLiveChannel("live-append", message.data);
    });
    source.addEventListener("live-tool-append", (message) => {
      if (source !== activeSseSource) return;
      paintLiveChannel("live-tool-append", message.data);
    });
  });
  for (const eventName of ["htmx:afterSwap", "htmx:sseMessage"]) {
    document.addEventListener(eventName, (event) => {
      const id = swapTargetId(event);
      if (touchesComposer(id)) {
        restoreDraft();
        scheduleSessionConnectors();
      }
      if (id === "session-chrome") {
        syncUsageAction();
        syncLiveTrackerElapsed();
        syncLiveTrackerProjectFilter();
        scheduleSessionConnectors();
      }
      if (id === "session-usage") syncUsageAction();
    });
  }

  for (const eventName of ["htmx:afterSwap", "htmx:afterSettle", "htmx:sseMessage"]) {
    document.addEventListener(eventName, (event) => {
      const id = swapTargetId(event);
      if (touchesPromptTruth(id)) promptEchoes.reconcile();
      if (touchesTranscript(id) || id === "session-composer" || id === "composer-turn-controls" || id === "composer") prepareSession();
    });
  }

  window.addEventListener("resize", scheduleSessionConnectors, { passive: true });
  window.addEventListener("orientationchange", scheduleSessionConnectors, { passive: true });
  window.visualViewport?.addEventListener?.("resize", scheduleSessionConnectors, { passive: true });
  window.visualViewport?.addEventListener?.("scroll", scheduleSessionConnectors, { passive: true });
  document.fonts?.ready?.then?.(scheduleSessionConnectors).catch?.(() => {});
  window.addEventListener("load", () => {
    restoreTranscriptView();
    scheduleSessionConnectors();
  }, { once: true });
  window.addEventListener("pageshow", () => {
    adoptFileReturnFromWindowName();
    restoreFileReturnFromHistory();
    promptEchoes.commission(liveSessionId);
    restorePersistedDraft();
    restoreTranscriptView();
    scheduleSessionConnectors();
  });

  const syncInitialChrome = (options = {}) => {
    adoptFileReturnFromWindowName();
    liveSessionId = currentSessionId();
    promptEchoes.commission(liveSessionId);
    const keepOpenerFocus = pendingFileReturn();
    if (keepOpenerFocus) {
      const payload = fileReturnState();
      transcriptView = { follow: false, top: payload.transcriptTop };
    }
    syncDrawerChrome();
    restoreChairMode();
    prepareSession();
    syncLiveTrackerElapsed();
    restoreActiveProjects();
    syncLiveTrackerProjectFilter();
    syncUsageView();
    scheduleSessionConnectors();
    if (!options.skipValidate) void validateRememberedProjects();
    if (drawerIsOpen()) requestAnimationFrame(() => openDrawer({ updateUrl: false, focus: !keepOpenerFocus }));
    restoreFileReturnFromHistory();
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncInitialChrome, { once: true });
  } else {
    syncInitialChrome();
  }

  const serviceWorker = ownScript?.dataset.serviceWorker;
  if (serviceWorker && "serviceWorker" in navigator) {
    window.addEventListener(
      "load",
      () => navigator.serviceWorker.register(serviceWorker, { updateViaCache: "none" }).catch(() => {}),
      { once: true },
    );
  }
})();
