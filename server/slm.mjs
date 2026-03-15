import { getSlmSettings } from "./store.mjs";

let cachedAvailability = {
  checkedAt: 0,
  fingerprint: "",
  value: null,
};

const clampConfidence = (value, fallback = 0.62) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : fallback;
};

const safeArray = (value, fallback = []) => {
  if (!Array.isArray(value)) {
    return fallback;
  }

  return value
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, 8);
};

const trimFence = (text) => String(text ?? "").replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();

const parseJsonObject = (text) => {
  try {
    return JSON.parse(trimFence(text));
  } catch {
    const raw = String(text ?? "");
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");

    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
};

const summarizeChecks = (recentChecks = []) =>
  recentChecks.slice(0, 8).map((check) => ({
    checkedAt: check.checkedAt,
    status: check.status,
    statusCode: check.statusCode,
    latencyMs: check.latencyMs,
    classification: check.classification,
    message: check.message,
    responsePreview: check.responseBody ?? check.responsePreview,
    evidence: check.evidence ?? {},
  }));

const fallbackHealthyAnalysis = ({ monitor, recentChecks }) => {
  const latestCheck = recentChecks[0] ?? null;
  const facts = [
    `${monitor.name} is currently ${monitor.status}.`,
    latestCheck ? `Last check ${latestCheck.status}${latestCheck.latencyMs ? ` in ${latestCheck.latencyMs}ms` : ""}.` : "No completed checks yet.",
    monitor.uptime24h > 0 ? `24h uptime is ${monitor.uptime24h.toFixed(2)}%.` : "24h uptime will populate after more checks run.",
  ];

  return {
    facts,
    probableRootCause: "No active fault is visible in the latest monitor history.",
    confidence: 0.84,
    blastRadius: "No active blast radius. This monitor is reporting healthy or pending checks.",
    recommendedChecks: [
      "Keep the monitor running on its current interval.",
      "Review latency trends for any slow-burn regressions before they become incidents.",
    ],
    suggestedFixes: [
      "No immediate remediation is required.",
      "Add stricter assertions if this endpoint needs deeper health validation.",
    ],
    reportSummary: `${monitor.name} is currently stable, and the latest checks do not show a live incident.`,
    evidence: facts,
  };
};

const latestIssueCheck = (recentChecks) => recentChecks.find((check) => check.status === "down" || check.status === "degraded") ?? null;

const fallbackIssueAnalysis = ({ monitor, recentChecks, incident }) => {
  const latestIssue = latestIssueCheck(recentChecks);
  const evidence = [
    latestIssue ? `Latest unhealthy check: ${latestIssue.classification}.` : "Recent unhealthy checks are present.",
    incident ? `Open incident: ${incident.title}.` : "The monitor has no open incident record yet.",
    latestIssue?.statusCode ? `Last status code was ${latestIssue.statusCode}.` : latestIssue?.message ?? "The request failed before a status code was recorded.",
  ];

  const joinedEvidence = recentChecks
    .slice(0, 6)
    .map((check) => `${check.classification} ${check.message ?? ""} ${check.responseBody ?? check.responsePreview ?? ""}`.toLowerCase())
    .join("\n");

  if (joinedEvidence.includes("dns") || joinedEvidence.includes("enotfound") || joinedEvidence.includes("nxdomain")) {
    return {
      facts: evidence,
      probableRootCause: "Name resolution is failing for the target endpoint or one of its upstream dependencies.",
      confidence: 0.82,
      blastRadius: `${monitor.name} cannot reach its target while the DNS issue persists.`,
      recommendedChecks: [
        "Validate the hostname and current DNS records for the target.",
        "Compare resolver results from the monitor host and the service network.",
      ],
      suggestedFixes: [
        "Restore the DNS record or roll back the hostname change.",
        "Flush stale DNS caches after the record is corrected.",
      ],
      reportSummary: `${monitor.name} appears to be failing because the hostname cannot be resolved consistently.`,
      evidence,
    };
  }

  if (joinedEvidence.includes("timeout") || joinedEvidence.includes("timed out") || joinedEvidence.includes("abort")) {
    return {
      facts: evidence,
      probableRootCause: "The endpoint is timing out before it can return a healthy response.",
      confidence: 0.8,
      blastRadius: `${monitor.name} is unavailable or degraded for callers hitting this path.`,
      recommendedChecks: [
        "Inspect upstream latency, queue depth, and database wait time.",
        "Compare the failing window to recent deploys or traffic spikes.",
      ],
      suggestedFixes: [
        "Reduce load or scale the bottlenecked service while the timeout persists.",
        "Add deeper tracing around slow requests to isolate the hot path.",
      ],
      reportSummary: `${monitor.name} is failing because requests are timing out before the expected response arrives.`,
      evidence,
    };
  }

  if (joinedEvidence.includes("tls") || joinedEvidence.includes("ssl") || joinedEvidence.includes("certificate")) {
    return {
      facts: evidence,
      probableRootCause: "The HTTPS handshake is failing because of a certificate or TLS configuration issue.",
      confidence: 0.79,
      blastRadius: `${monitor.name} cannot complete secure requests until the TLS issue is fixed.`,
      recommendedChecks: [
        "Inspect the certificate chain, hostname coverage, and expiry date.",
        "Compare the live certificate with the expected issuer and SAN list.",
      ],
      suggestedFixes: [
        "Replace or renew the invalid certificate.",
        "Correct the hostname or trust-store mismatch on the target.",
      ],
      reportSummary: `${monitor.name} appears to be failing during TLS negotiation instead of after the request reaches the application.`,
      evidence,
    };
  }

  if ((latestIssue?.statusCode ?? 0) >= 500) {
    return {
      facts: evidence,
      probableRootCause: "The application or an upstream dependency is returning server-side errors.",
      confidence: 0.76,
      blastRadius: `${monitor.name} is unstable for any caller hitting the affected endpoint.`,
      recommendedChecks: [
        "Inspect application logs around the first 5xx response.",
        "Correlate the failures with dependency saturation, deploys, or feature flags.",
      ],
      suggestedFixes: [
        "Roll back the newest risky change or scale the failing dependency.",
        "Add rate limiting or circuit breaking if retries are amplifying the outage.",
      ],
      reportSummary: `${monitor.name} is currently returning server errors, which points to an application-side failure.`,
      evidence,
    };
  }

  if (latestIssue?.statusCode === 401 || latestIssue?.statusCode === 403 || joinedEvidence.includes("unauthorized")) {
    return {
      facts: evidence,
      probableRootCause: "Authentication or authorization rules no longer match the monitor request.",
      confidence: 0.77,
      blastRadius: `${monitor.name} is rejecting the probe, so health results are unreliable until auth is corrected.`,
      recommendedChecks: [
        "Verify credentials, headers, and any rotated secrets used by the monitor.",
        "Diff recent auth policy changes against the last healthy release.",
      ],
      suggestedFixes: [
        "Update the monitor credentials or headers to match the current policy.",
        "Roll back the auth change if legitimate traffic is failing too.",
      ],
      reportSummary: `${monitor.name} is likely failing because the monitor request is no longer authorized.`,
      evidence,
    };
  }

  return {
    facts: evidence,
    probableRootCause: "The monitor has an unhealthy pattern, but the evidence is still broad and needs operator review.",
    confidence: 0.65,
    blastRadius: `${monitor.name} is unhealthy, and downstream consumers may be impacted until the fault domain is narrowed.`,
    recommendedChecks: [
      "Review the latest failed checks and compare them to the last healthy response.",
      "Correlate the first failure with infrastructure or deployment changes.",
    ],
    suggestedFixes: [
      "Stabilize the endpoint first, then refresh analysis with more evidence.",
      "Capture deeper logs or traces around the first failing request.",
    ],
    reportSummary: `${monitor.name} is unhealthy, but the fallback engine needs more evidence to narrow the exact cause.`,
    evidence,
  };
};

const fallbackMonitorAnalysis = (context) =>
  context.monitor.status === "up" || context.monitor.status === "pending"
    ? fallbackHealthyAnalysis(context)
    : fallbackIssueAnalysis(context);

const buildOllamaUrl = (baseUrl, pathname) => `${baseUrl}${pathname}`;
const buildOpenAiCompatibleUrl = (baseUrl, pathname) => `${baseUrl}${pathname}`;

const getHeaders = (slmConfig) => {
  const headers = {
    "Content-Type": "application/json",
  };

  if (slmConfig.provider === "openai-compatible" && slmConfig.apiKey) {
    headers.Authorization = `Bearer ${slmConfig.apiKey}`;
  }

  return headers;
};

const listAvailableModels = (payload, provider) => {
  const names = new Set();

  if (provider === "ollama" && Array.isArray(payload?.models)) {
    for (const model of payload.models) {
      for (const name of [model?.name, model?.model]) {
        const normalized = String(name ?? "").trim();
        if (normalized) {
          names.add(normalized);
        }
      }
    }
  }

  if (provider === "openai-compatible" && Array.isArray(payload?.data)) {
    for (const model of payload.data) {
      const normalized = String(model?.id ?? "").trim();
      if (normalized) {
        names.add(normalized);
      }
    }
  }

  return [...names];
};

const generateText = async (prompt, { format } = {}) => {
  const slmConfig = await getSlmSettings({ includeSecrets: true });

    if (slmConfig.provider === "ollama") {
      const response = await fetch(buildOllamaUrl(slmConfig.baseUrl, "/api/generate"), {
        method: "POST",
        headers: getHeaders(slmConfig),
        body: JSON.stringify({
          model: slmConfig.model,
          prompt,
          stream: false,
          ...(format ? { format } : {}),
          options: {
            temperature: 0.1,
            num_ctx: 3072,  // Limit context size to speed up generation
            num_predict: 350,   // Prevent rambling by capping output tokens
          },
        }),
        signal: AbortSignal.timeout(slmConfig.timeoutMs),
      });

    if (!response.ok) {
      throw new Error(`SLM request failed with status ${response.status}`);
    }

    const payload = await response.json();
    return {
      text: String(payload.response ?? "").trim(),
      provider: slmConfig.provider,
      model: slmConfig.model,
      slmConfig,
    };
  }

  if (slmConfig.provider === "openai-compatible") {
    const response = await fetch(buildOpenAiCompatibleUrl(slmConfig.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: getHeaders(slmConfig),
      body: JSON.stringify({
        model: slmConfig.model,
        temperature: 0.1,
        max_tokens: 350,
        ...(format === "json" ? { response_format: { type: "json_object" } } : {}),
        messages: [
          {
            role: "system",
            content: "You are Auto-Ops Sentinel. Output strict concise JSON. Max 15 words per array item. No markdown formatting outside of strict JSON structure.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      signal: AbortSignal.timeout(slmConfig.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`SLM request failed with status ${response.status}`);
    }

    const payload = await response.json();
    return {
      text: String(payload?.choices?.[0]?.message?.content ?? "").trim(),
      provider: slmConfig.provider,
      model: slmConfig.model,
      slmConfig,
    };
  }

  throw new Error(`Unsupported SLM provider "${slmConfig.provider}".`);
};

export const getSlmConfig = async () => getSlmSettings();

export const checkSlmAvailability = async ({ force = false } = {}) => {
  const slmConfig = await getSlmSettings({ includeSecrets: true });
  const now = Date.now();
  const fingerprint = JSON.stringify({
    provider: slmConfig.provider,
    baseUrl: slmConfig.baseUrl,
    model: slmConfig.model,
    timeoutMs: slmConfig.timeoutMs,
    hasApiKey: slmConfig.hasApiKey,
  });

  if (!force && cachedAvailability.value && cachedAvailability.fingerprint === fingerprint && now - cachedAvailability.checkedAt < 15_000) {
    return cachedAvailability.value;
  }

  try {
    let response;

    if (slmConfig.provider === "ollama") {
      response = await fetch(buildOllamaUrl(slmConfig.baseUrl, "/api/tags"), {
        headers: getHeaders(slmConfig),
        signal: AbortSignal.timeout(Math.min(4_000, slmConfig.timeoutMs)),
      });
    } else {
      response = await fetch(buildOpenAiCompatibleUrl(slmConfig.baseUrl, "/models"), {
        headers: getHeaders(slmConfig),
        signal: AbortSignal.timeout(Math.min(4_000, slmConfig.timeoutMs)),
      });
    }

    if (!response.ok) {
      throw new Error(`SLM endpoint returned ${response.status}`);
    }

    const payload = await response.json();
    const availableModels = listAvailableModels(payload, slmConfig.provider);

    if (availableModels.length > 0 && !availableModels.includes(slmConfig.model)) {
      throw new Error(`Configured model "${slmConfig.model}" is not currently available.`);
    }

    cachedAvailability = {
      checkedAt: now,
      fingerprint,
      value: {
        reachable: true,
        mode: "live",
        provider: slmConfig.provider,
        reason: null,
      },
    };
  } catch (error) {
    cachedAvailability = {
      checkedAt: now,
      fingerprint,
      value: {
        reachable: false,
        mode: "fallback",
        provider: slmConfig.provider,
        reason: error instanceof Error ? error.message : "Unknown SLM connection failure",
      },
    };
  }

  return cachedAvailability.value;
};

const buildMonitorPrompt = ({ monitor, recentChecks, incident, relatedActivity, retrievalMatches }) => `
You are Auto-Ops Sentinel, a reliability analyst for a production monitoring system.
You MUST output EXACTLY one valid JSON object and absolutely nothing else.
NO markdown code blocks around the JSON. Look at the exact required keys below.

Required JSON Structure:
{
  "facts": ["fact 1 (max 15 words)", "fact 2 (max 15 words)"],
  "probableRootCause": "Brief root cause string",
  "confidence": 0.85,
  "blastRadius": "Brief blast radius string",
  "recommendedChecks": ["check 1", "check 2"],
  "suggestedFixes": ["fix 1", "fix 2"],
  "reportSummary": "1 sentence executive summary.",
  "citations": ["source_id_here"]
}

Rules:
- \`facts\`: 2-4 strings
- \`citations\`: array of valid source ids
- \`confidence\`: number between 0 and 1
- \`recommendedChecks\`: 2-4 concise strings (max 10 words each)
- \`suggestedFixes\`: 2-4 concise strings (max 10 words each)
- Stay grounded in evidence. Be extremely brief. Provide ONLY JSON.

Monitor:
${JSON.stringify(
  {
    id: monitor.id,
    name: monitor.name,
    type: monitor.type,
    url: monitor.url,
    method: monitor.method,
    status: monitor.status,
    intervalSeconds: monitor.intervalSeconds,
    timeoutMs: monitor.timeoutMs,
    environment: monitor.environment,
    owner: monitor.owner,
    uptime24h: monitor.uptime24h,
    avgLatencyMs: monitor.avgLatencyMs,
  },
  null,
  2,
)}

Recent checks:
${JSON.stringify(summarizeChecks(recentChecks), null, 2)}

Incident:
${JSON.stringify(incident ?? null, null, 2)}

Recent activity:
${JSON.stringify(relatedActivity.slice(0, 8), null, 2)}

Historical retrieval matches:
${JSON.stringify(retrievalMatches ?? [], null, 2)}
`;

const buildOpsPrompt = ({ question, dashboardSnapshot, monitorContext, incidentContext, retrievalMatches, timeWindow }) => `
You are Auto-Ops Sentinel, an operator analyst.
Answer the user's question using ONLY the supplied state snapshot and retrieved evidence.
EXTREMELY IMPORTANT: Be extremely concise and output your answer as plain text. Do not ramble. Maximum 2 sentences.

If evidence is weak, say so.
If asked about a time window, give exact timestamps.

Dashboard:
${JSON.stringify(dashboardSnapshot, null, 2)}

Selected monitor:
${JSON.stringify(monitorContext, null, 2)}

Selected incident:
${JSON.stringify(incidentContext, null, 2)}

Retrieved evidence:
${JSON.stringify(retrievalMatches ?? [], null, 2)}

Time window:
${JSON.stringify(timeWindow ?? null, null, 2)}

Question:
${question}
`;

export const generateMonitorAnalysis = async (context) => {
  const availability = await checkSlmAvailability();
  const slmConfig = await getSlmSettings();
  const prompt = buildMonitorPrompt(context);
  const fallback = fallbackMonitorAnalysis(context);

  if (!availability.reachable) {
    return {
      ...fallback,
      mode: "fallback",
      provider: "fallback",
      model: "fallback-rules",
      status: "completed",
      prompt,
      rawResponse: null,
      parsedResponse: null,
      failureReason: availability.reason,
      slmConfig,
      citations: safeArray(context.retrievalMatches?.map((match) => match.sourceId) ?? [], []),
      retrievalMatches: context.retrievalMatches ?? [],
      timeWindowStart: context.timeWindow?.start ?? null,
      timeWindowEnd: context.timeWindow?.end ?? null,
    };
  }

  let rawResponse = null;
  let parsedResponse = null;

  try {
    const generated = await generateText(prompt, { format: "json" });
    rawResponse = generated.text;
    parsedResponse = parseJsonObject(rawResponse);

    if (!parsedResponse) {
      throw new Error("SLM returned non-JSON monitor analysis.");
    }

    return {
      facts: safeArray(parsedResponse.facts, fallback.facts),
      probableRootCause: String(parsedResponse.probableRootCause ?? fallback.probableRootCause),
      confidence: clampConfidence(parsedResponse.confidence, fallback.confidence),
      blastRadius: String(parsedResponse.blastRadius ?? fallback.blastRadius),
      recommendedChecks: safeArray(parsedResponse.recommendedChecks, fallback.recommendedChecks),
      suggestedFixes: safeArray(parsedResponse.suggestedFixes, fallback.suggestedFixes),
      reportSummary: String(parsedResponse.reportSummary ?? fallback.reportSummary),
      evidence: fallback.evidence,
      mode: "live",
      provider: generated.provider,
      model: generated.model,
      status: "completed",
      prompt,
      rawResponse,
      parsedResponse,
      failureReason: null,
      slmConfig,
      citations: safeArray(parsedResponse.citations, safeArray(context.retrievalMatches?.map((match) => match.sourceId) ?? [], [])),
      retrievalMatches: context.retrievalMatches ?? [],
      timeWindowStart: context.timeWindow?.start ?? null,
      timeWindowEnd: context.timeWindow?.end ?? null,
    };
  } catch (error) {
    return {
      ...fallback,
      mode: "fallback",
      provider: "fallback",
      model: "fallback-rules",
      status: "completed",
      prompt,
      rawResponse,
      parsedResponse,
      failureReason: error instanceof Error ? error.message : "Unexpected SLM analysis failure.",
      slmConfig,
      citations: safeArray(context.retrievalMatches?.map((match) => match.sourceId) ?? [], []),
      retrievalMatches: context.retrievalMatches ?? [],
      timeWindowStart: context.timeWindow?.start ?? null,
      timeWindowEnd: context.timeWindow?.end ?? null,
    };
  }
};

const buildFallbackOpsAnswer = ({ question, dashboardSnapshot, monitorContext, retrievalMatches, timeWindow, availability }) => {
  const downCount = dashboardSnapshot.summary?.down ?? 0;
  const degradedCount = dashboardSnapshot.summary?.degraded ?? 0;

  if (timeWindow?.start && retrievalMatches?.length) {
    const first = retrievalMatches[0];
    return {
      answer: `Between ${timeWindow.start} and ${timeWindow.end ?? timeWindow.start}, the closest stored evidence is "${first.title}" at ${first.occurredAt}. ${first.snippet ?? first.body ?? ""}`.trim(),
      mode: "fallback",
      provider: "fallback",
      model: "fallback-rules",
      failureReason: availability.reason,
    };
  }

  if (/why|root cause|cause/i.test(question) && monitorContext?.latestAnalysis) {
    return {
      answer: monitorContext.latestAnalysis.reportSummary,
      mode: "fallback",
      provider: "fallback",
      model: "fallback-rules",
      failureReason: availability.reason,
    };
  }

  return {
    answer: `Current state: ${dashboardSnapshot.summary?.up ?? 0} up, ${degradedCount} degraded, ${downCount} down, and ${
      dashboardSnapshot.summary?.openIncidents ?? 0
    } open incidents. ${retrievalMatches?.[0] ? `Closest retrieved evidence: ${retrievalMatches[0].title}.` : "No historical evidence matched the question strongly."}`,
    mode: "fallback",
    provider: "fallback",
    model: "fallback-rules",
    failureReason: availability.reason,
  };
};

export const answerOpsQuestion = async ({ question, dashboardSnapshot, monitorContext, incidentContext, retrievalMatches, timeWindow }) => {
  const availability = await checkSlmAvailability();
  const slmConfig = await getSlmSettings();
  const prompt = buildOpsPrompt({
    question,
    dashboardSnapshot,
    monitorContext,
    incidentContext,
    retrievalMatches,
    timeWindow,
  });

  if (!availability.reachable) {
    const fallback = buildFallbackOpsAnswer({
      question,
      dashboardSnapshot,
      monitorContext,
      retrievalMatches,
      timeWindow,
      availability,
    });

    return {
      ...fallback,
      citations: retrievalMatches?.slice(0, 5).map((match) => match.sourceId) ?? [],
      retrievalMatches: retrievalMatches ?? [],
      prompt,
      rawResponse: null,
      slmConfig,
      timeWindow,
    };
  }

  try {
    const generated = await generateText(prompt);
    return {
      answer: generated.text,
      mode: "live",
      provider: generated.provider,
      model: generated.model,
      citations: retrievalMatches?.slice(0, 5).map((match) => match.sourceId) ?? [],
      retrievalMatches: retrievalMatches ?? [],
      prompt,
      rawResponse: generated.text,
      failureReason: null,
      slmConfig,
      timeWindow,
    };
  } catch (error) {
    const fallback = buildFallbackOpsAnswer({
      question,
      dashboardSnapshot,
      monitorContext,
      retrievalMatches,
      timeWindow,
      availability: {
        reason: error instanceof Error ? error.message : "Unexpected SLM answer failure.",
      },
    });

    return {
      ...fallback,
      citations: retrievalMatches?.slice(0, 5).map((match) => match.sourceId) ?? [],
      retrievalMatches: retrievalMatches ?? [],
      prompt,
      rawResponse: null,
      slmConfig,
      timeWindow,
    };
  }
};

