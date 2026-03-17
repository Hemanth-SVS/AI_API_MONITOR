import { getSlmSettings } from "./store.mjs";

// Response cache for faster repeated queries
const responseCache = new Map();
const CACHE_TTL_MS = 30000; // 30 seconds

let cachedAvailability = {
  checkedAt: 0,
  fingerprint: "",
  value: null,
};

const getCacheKey = (context) => {
  const { monitor, recentChecks } = context;
  const checkHash = recentChecks.slice(0, 2).map(c => c.status + c.statusCode).join(',');
  return `${monitor.id}:${monitor.status}:${checkHash}`;
};

const getCachedAnalysis = (context) => {
  const key = getCacheKey(context);
  const cached = responseCache.get(key);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }
  return null;
};

const setCachedAnalysis = (context, data) => {
  const key = getCacheKey(context);
  responseCache.set(key, { data, timestamp: Date.now() });
  // Cleanup old entries
  if (responseCache.size > 50) {
    const oldest = responseCache.keys().next().value;
    responseCache.delete(oldest);
  }
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

const estimateTokens = (text) => {
  // A rough heuristic: ~4 characters per token for English text
  return Math.ceil(String(text ?? "").length / 4);
};

// Truncate text to roughly target token length
const truncateTextTokens = (text, maxTokens) => {
  const str = String(text ?? "");
  const estimatedTokens = estimateTokens(str);
  if (estimatedTokens <= maxTokens) return str;
  // Truncate based on the heuristic (maxTokens * 4) minus a buffer
  const maxChars = Math.max(0, (maxTokens * 4) - 20);
  return str.slice(0, maxChars) + "... (truncated)";
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
  recentChecks.slice(0, 4).map((check) => ({
    status: check.status,
    statusCode: check.statusCode,
    latencyMs: check.latencyMs,
    classification: check.classification,
  }));

const fallbackHealthyAnalysis = ({ monitor, recentChecks }) => {
  const latestCheck = recentChecks[0] ?? null;
  const facts = [
    `${monitor.name} is currently ${monitor.status}.`,
    latestCheck ? `Last check ${latestCheck.status}${latestCheck.latencyMs ? ` in ${latestCheck.latencyMs}ms` : ""}.` : "No completed checks yet.",
    monitor.uptime24h > 0 ? `24h uptime is ${monitor.uptime24h.toFixed(2)}%.` : "24h uptime will populate after more checks run.",
  ];

  return {
    reasoning: "The monitor is returning healthy statuses and there are no recent failures or degraded checks in the window.",
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
      reasoning: "The underlying network stack is returning an NXDOMAIN or ENOTFOUND error, indicating the hostname cannot be resolved to an IP address.",
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
      reasoning: "The connection dropped or the application took too long to respond, exceeding the monitor's configured timeout limit.",
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
      reasoning: "The secure socket layer handshake failed, likely due to an expired certificate, a hostname mismatch, or an untrusted issuer.",
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
      reasoning: "The HTTP response contained a 5xx status code, indicating that the target server encountered an unexpected condition that prevented it from fulfilling the request.",
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
      reasoning: "The endpoint is actively refusing to fulfill the request due to missing, invalid, or expired credentials.",
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
    reasoning: "There is an active issue, but the specific failure mode does not cleanly match known network, timeout, TLS, server, or authorization patterns.",
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

const withRetry = async (fn, maxRetries = 2, baseDelayMs = 500) => {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      if (attempt > maxRetries) {
        throw error;
      }
      
      const isRetryable = error.name === "TimeoutError" || 
                          error.message.includes("429") || 
                          error.message.includes("503") ||
                          error.message.includes("502");
                          
      if (!isRetryable) {
        throw error;
      }
      
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      console.warn(`[SLM] Attempt ${attempt} failed, retrying in ${delay}ms... (${error.message})`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};

const generateText = async (prompt, { format, systemMessage } = {}) => {
  const slmConfig = await getSlmSettings({ includeSecrets: true });

  const executeRequest = async () => {
    const startTime = performance.now();
    let telemetry = { durationMs: 0, promptTokens: 0, completionTokens: 0 };

    if (slmConfig.provider === "ollama") {
      const isJsonFormat = format === "json";
      
      // Ollama Schema for structured output
      const jsonSchema = isJsonFormat ? {
        type: "object",
        properties: {
          reasoning: { type: "string" },
          facts: { type: "array", items: { type: "string" } },
          probableRootCause: { type: "string" },
          confidence: { type: "number" },
          blastRadius: { type: "string" },
          recommendedChecks: { type: "array", items: { type: "string" } },
          suggestedFixes: { type: "array", items: { type: "string" } },
          reportSummary: { type: "string" },
          citations: { type: "array", items: { type: "string" } }
        },
        required: ["reasoning", "facts", "probableRootCause", "confidence", "blastRadius", "recommendedChecks", "suggestedFixes", "reportSummary"]
      } : undefined;

      const response = await fetch(buildOllamaUrl(slmConfig.baseUrl, "/api/chat"), {
        method: "POST",
        headers: getHeaders(slmConfig),
        body: JSON.stringify({
          model: slmConfig.model,
          messages: [
            ...(systemMessage ? [{ role: "system", content: systemMessage }] : []),
            { role: "user", content: prompt }
          ],
          stream: false,
          ...(isJsonFormat ? { format: jsonSchema || "json" } : {}),
          options: {
            temperature: 0.1,
            top_k: 20,
            top_p: 0.9,
            num_ctx: 2048,
            num_predict: 500,
          },
        }),
        signal: AbortSignal.timeout(slmConfig.timeoutMs),
      });

      if (!response.ok) {
        throw new Error(`SLM request failed with status ${response.status}`);
      }

      const payload = await response.json();
      telemetry.durationMs = Math.round(performance.now() - startTime);
      telemetry.promptTokens = payload.prompt_eval_count || estimateTokens(prompt);
      telemetry.completionTokens = payload.eval_count || 0;
      
      console.log(`[SLM] Ollama request completed in ${telemetry.durationMs}ms (${telemetry.promptTokens} prompt tokens, ${telemetry.completionTokens} completion tokens)`);

      return {
        text: String(payload.message?.content ?? "").trim(),
        provider: slmConfig.provider,
        model: slmConfig.model,
        telemetry,
        slmConfig,
      };
    }

    if (slmConfig.provider === "openai-compatible") {
      const isJsonFormat = format === "json";
      
      const response = await fetch(buildOpenAiCompatibleUrl(slmConfig.baseUrl, "/chat/completions"), {
        method: "POST",
        headers: getHeaders(slmConfig),
        body: JSON.stringify({
          model: slmConfig.model,
          temperature: 0.1,
          top_p: 0.9,
          max_tokens: 500,
          ...(isJsonFormat ? { response_format: { type: "json_object" } } : {}),
          messages: [
            {
              role: "system",
              content: systemMessage || "You are an assistant.",
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
      telemetry.durationMs = Math.round(performance.now() - startTime);
      telemetry.promptTokens = payload.usage?.prompt_tokens || estimateTokens(prompt);
      telemetry.completionTokens = payload.usage?.completion_tokens || 0;

      console.log(`[SLM] OpenAI request completed in ${telemetry.durationMs}ms (${telemetry.promptTokens} prompt tokens, ${telemetry.completionTokens} completion tokens)`);

      return {
        text: String(payload?.choices?.[0]?.message?.content ?? "").trim(),
        provider: slmConfig.provider,
        model: slmConfig.model,
        telemetry,
        slmConfig,
      };
    }

    throw new Error(`Unsupported SLM provider "${slmConfig.provider}".`);
  };

  return withRetry(executeRequest);
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

const SYSTEM_MONITOR_PROMPT = `You are Auto-Ops Sentinel, a reliability analyst for a production monitoring system.
You MUST output EXACTLY one valid JSON object and absolutely nothing else.
NO markdown code blocks around the JSON. Look at the exact required keys below.

JSON Schema:
{
  "reasoning": "Brief explanation of your thought process.",
  "facts": ["fact 1 (max 15 words)", "fact 2 (max 15 words)"],
  "probableRootCause": "Brief root cause string",
  "confidence": 0.85,
  "blastRadius": "one line blast radius",
  "recommendedChecks": ["2-3 quick checks"],
  "suggestedFixes": ["2-3 suggested fixes"],
  "reportSummary": "one sentence summary"
}

Rules:
- \`reasoning\`: Think step-by-step about what the evidence indicates before generating the final report. Keep this internal monologue brief (2-4 sentences).
- \`facts\`: 2-5 strings, drawing ONLY from the provided evidence.
- \`citations\`: array of valid source ids that back up your claims.
- \`confidence\`: number between 0 and 1 representing your certainty.
- \`recommendedChecks\`: 2-4 concise strings (max 12 words each) suggesting immediate diagnostic actions.
- \`suggestedFixes\`: 2-4 concise strings (max 12 words each) suggesting likely remediations.
- Stay grounded in evidence. Generate the reasoning field first. Provide ONLY JSON. Never invent facts.`;

const buildMonitorPrompt = ({ monitor, recentChecks, incident, relatedActivity, retrievalMatches }) => `
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
${truncateTextTokens(JSON.stringify(summarizeChecks(recentChecks), null, 2), 1500)}

Incident:
${JSON.stringify(incident ?? null, null, 2)}

Recent activity:
${truncateTextTokens(JSON.stringify(relatedActivity.slice(0, 8), null, 2), 1000)}

Historical retrieval matches:
${truncateTextTokens(JSON.stringify(retrievalMatches ?? [], null, 2), 1000)}
`;

const SYSTEM_OPS_PROMPT = `You are Auto-Ops Sentinel, a monitoring assistant.
Answer the user's question using the provided dashboard state and evidence.
Be concise and direct. Max 3 sentences. Output plain text only.
If the evidence does not contain relevant information, say so briefly.`;

const buildOpsPrompt = ({ question, dashboardSnapshot, monitorContext, incidentContext, retrievalMatches, timeWindow }) => `
Dashboard state:
${truncateTextTokens(JSON.stringify(dashboardSnapshot, null, 2), 1500)}

Selected monitor context:
${truncateTextTokens(JSON.stringify(monitorContext, null, 2), 1000)}

Selected incident context:
${truncateTextTokens(JSON.stringify(incidentContext, null, 2), 1000)}

Retrieved factual evidence:
${truncateTextTokens(JSON.stringify(retrievalMatches ?? [], null, 2), 2000)}

Time window of interest:
${JSON.stringify(timeWindow ?? null, null, 2)}

Question:
${question}
`;

export const generateMonitorAnalysis = async (context) => {
  const availability = await checkSlmAvailability();
  const slmConfig = await getSlmSettings();
  
  // Check cache first
  const cached = getCachedAnalysis(context);
  if (cached) {
    return { ...cached, cached: true };
  }
  
  const prompt = buildMonitorPrompt(context);
  const fallback = fallbackMonitorAnalysis(context);

  if (!availability.reachable) {
    const result = {
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
    setCachedAnalysis(context, result);
    return result;
  }

  let rawResponse = null;
  let parsedResponse = null;

  try {
    const generated = await generateText(prompt, { format: "json", systemMessage: SYSTEM_MONITOR_PROMPT });
    rawResponse = generated.text;
    parsedResponse = parseJsonObject(rawResponse);

    if (!parsedResponse) {
      throw new Error("SLM returned non-JSON monitor analysis.");
    }

    const result = {
      reasoning: String(parsedResponse.reasoning ?? fallback.reasoning ?? "No reasoning was provided by the model."),
      facts: safeArray(parsedResponse.facts, fallback.facts),
      probableRootCause: String(parsedResponse.rootCause ?? parsedResponse.probableRootCause ?? fallback.probableRootCause),
      confidence: clampConfidence(parsedResponse.confidence, fallback.confidence),
      blastRadius: String(parsedResponse.impact ?? parsedResponse.blastRadius ?? fallback.blastRadius),
      recommendedChecks: safeArray(parsedResponse.checks ?? parsedResponse.recommendedChecks, fallback.recommendedChecks),
      suggestedFixes: safeArray(parsedResponse.fixes ?? parsedResponse.suggestedFixes, fallback.suggestedFixes),
      reportSummary: String(parsedResponse.summary ?? parsedResponse.reportSummary ?? fallback.reportSummary),
      evidence: fallback.evidence,
      mode: "live",
      provider: generated.provider,
      model: generated.model,
      telemetry: generated.telemetry,
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
    setCachedAnalysis(context, result);
    return result;
  } catch (error) {
    const result = {
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
    setCachedAnalysis(context, result);
    return result;
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
      answer: `According to the latest Signal Analyst report: ${monitorContext.latestAnalysis.reportSummary}`,
      mode: "fallback",
      provider: "fallback",
      model: "fallback-rules",
      failureReason: availability.reason,
    };
  }

  return {
    answer: `Current state: ${dashboardSnapshot.summary?.up ?? 0} up, ${degradedCount} degraded, ${downCount} down, and ${dashboardSnapshot.summary?.openIncidents ?? 0} open incidents. ${retrievalMatches?.[0] ? `Closest retrieved evidence: ${retrievalMatches[0].title}.` : "No historical evidence matched the question strongly."}`,
    mode: "fallback",
    provider: "fallback",
    model: "fallback-rules",
    failureReason: availability.reason,
  };
};

export const answerOpsQuestion = async ({ question, dashboardSnapshot, monitorContext, incidentContext, retrievalMatches, timeWindow }) => {
  const availability = await checkSlmAvailability();
  const slmConfig = await getSlmSettings();

  // Handle greetings in code — don't trust a tiny model to follow complex instruction rules
  const trimmed = question.trim().toLowerCase().replace(/[^a-z]/g, "");
  const greetings = new Set(["hello", "hi", "hey", "hiya", "howdy", "greetings", "sup", "yo"]);
  if (greetings.has(trimmed)) {
    return {
      answer: "Hello! I am the Auto-Ops Sentinel assistant. How can I help you check your monitors today?",
      mode: "fallback",
      provider: "fallback",
      model: "greeting-shortcircuit",
      citations: [],
      retrievalMatches: [],
      rawResponse: null,
      failureReason: null,
      slmConfig,
      timeWindow,
    };
  }
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
    const generated = await generateText(prompt, { systemMessage: SYSTEM_OPS_PROMPT });
    return {
      answer: generated.text,
      mode: "live",
      provider: generated.provider,
      model: generated.model,
      telemetry: generated.telemetry,
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

