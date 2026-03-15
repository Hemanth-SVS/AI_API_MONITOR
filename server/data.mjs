import { execFile as execFileCallback } from "node:child_process";
import dns from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import { promisify } from "node:util";
import { WebSocket } from "undici";

import { deliverNotification, serializeChannelConfig } from "./notifications.mjs";
import { buildIncidentReport, writeReportArtifacts } from "./reports.mjs";
import { createId, nowIso } from "./security.mjs";
import { answerOpsQuestion, generateMonitorAnalysis } from "./slm.mjs";
import { ensureSchema, getMeta, many, one, query, setMeta, withTransaction } from "./store.mjs";

const execFile = promisify(execFileCallback);

const ENGINE_INTERVAL_MS = 5_000;
const CHECK_WORKER_CONCURRENCY = Math.max(1, Number(process.env.CHECK_WORKER_CONCURRENCY ?? 3));
const ANALYSIS_WORKER_CONCURRENCY = Math.max(1, Number(process.env.SLM_CONCURRENCY ?? 2));
const NOTIFICATION_WORKER_CONCURRENCY = Math.max(1, Number(process.env.NOTIFICATION_CONCURRENCY ?? 2));
const CHECK_RETENTION_PER_MONITOR = Math.max(0, Number(process.env.CHECK_RETENTION_PER_MONITOR ?? 0));
const ANALYSIS_RETENTION_PER_MONITOR = Math.max(0, Number(process.env.ANALYSIS_RETENTION_PER_MONITOR ?? 0));
const ACTIVITY_EVENT_RETENTION = Math.max(0, Number(process.env.ACTIVITY_EVENT_RETENTION ?? 0));
const RESPONSE_BODY_LIMIT = Math.max(400, Number(process.env.MONITOR_RESPONSE_BODY_LIMIT ?? 12_000));
const DASHBOARD_URL = process.env.SENTINEL_PUBLIC_URL ?? "http://127.0.0.1:8080";

const listeners = new Set();
const activeChecks = new Map();
const workerTimers = [];

let runtimeStarted = false;
let checkWorkersRunning = 0;
let analysisWorkersRunning = 0;
let notificationWorkersRunning = 0;

const workerIdentity = `${process.pid}-${Math.random().toString(16).slice(2, 8)}`;

const safeObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

const normalizeTags = (tags) => {
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean);
  }

  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
};

const text = (value, fallback = "") => String(value ?? fallback);

const normalizeType = (value) => {
  const nextType = String(value ?? "http").trim().toLowerCase();
  const supported = new Set(["http", "keyword", "json-query", "tcp", "websocket", "ping", "dns", "push", "docker", "steam"]);
  return supported.has(nextType) ? nextType : "http";
};

const normalizeMonitorStatus = (value) => {
  const next = String(value ?? "pending").trim().toLowerCase();
  return ["up", "down", "degraded", "pending"].includes(next) ? next : "pending";
};

const coerceJsonStringValue = (value) => {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
};

const deriveDisplayUrl = (type, config = {}) => {
  switch (type) {
    case "tcp":
      return `tcp://${config.host ?? "localhost"}:${config.port ?? 80}`;
    case "websocket":
      return text(config.url, "ws://localhost");
    case "ping":
      return `ping://${config.host ?? "localhost"}`;
    case "dns":
      return `dns://${config.host ?? "localhost"}/${config.recordType ?? "A"}`;
    case "push":
      return `push://${config.pushToken ?? "token"}`;
    case "docker":
      return `docker://${config.container ?? "container"}`;
    case "steam":
      return `steam://${config.host ?? "localhost"}:${config.port ?? 27015}`;
    default:
      return text(config.url, "https://");
  }
};

const defaultConfigForType = (type) => {
  switch (type) {
    case "keyword":
      return { url: "https://", method: "GET", expectedStatusCodes: "200-299", keyword: "", headersText: "", body: "" };
    case "json-query":
      return {
        url: "https://",
        method: "GET",
        expectedStatusCodes: "200-299",
        jsonPath: "status",
        expectedValue: "ok",
        headersText: "",
        body: "",
      };
    case "tcp":
      return { host: "127.0.0.1", port: 80 };
    case "websocket":
      return { url: "ws://127.0.0.1:8080", sendText: "", expectText: "" };
    case "ping":
      return { host: "127.0.0.1" };
    case "dns":
      return { host: "example.com", recordType: "A", expectedContains: "" };
    case "push":
      return { graceSeconds: 0 };
    case "docker":
      return { container: "" };
    case "steam":
      return { host: "127.0.0.1", port: 27015 };
    default:
      return {
        url: "https://",
        method: "GET",
        expectedStatusCodes: "200-299",
        expectedBodyIncludes: "",
        headersText: "",
        body: "",
      };
  }
};

const normalizeMonitorInput = (payload, current = null) => {
  const type = normalizeType(payload.type ?? current?.type ?? "http");
  const currentConfig = safeObject(current?.config);
  const nextConfig = {
    ...defaultConfigForType(type),
    ...currentConfig,
    ...safeObject(payload.config),
  };

  if (type === "http" || type === "keyword" || type === "json-query") {
    nextConfig.url = text(payload.url ?? payload.endpoint ?? nextConfig.url).trim();
    nextConfig.method = text(payload.method ?? nextConfig.method, "GET").trim().toUpperCase();
    nextConfig.headersText = text(payload.headerText ?? nextConfig.headersText);
    nextConfig.body = text(payload.body ?? nextConfig.body);
    nextConfig.expectedStatusCodes = text(payload.expectedStatusCodes ?? payload.acceptedStatusCodes ?? nextConfig.expectedStatusCodes, "200-299").trim();

    if (type === "http") {
      nextConfig.expectedBodyIncludes = text(payload.expectedBodyIncludes ?? nextConfig.expectedBodyIncludes).trim();
    }

    if (type === "keyword") {
      nextConfig.keyword = text(payload.keyword ?? payload.expectedBodyIncludes ?? nextConfig.keyword).trim();
    }

    if (type === "json-query") {
      nextConfig.jsonPath = text(payload.jsonPath ?? nextConfig.jsonPath).trim();
      nextConfig.expectedValue = text(payload.expectedValue ?? nextConfig.expectedValue).trim();
    }
  }

  if (type === "tcp" || type === "steam") {
    nextConfig.host = text(payload.host ?? nextConfig.host).trim();
    nextConfig.port = Math.max(1, Number(payload.port ?? nextConfig.port ?? 80));
  }

  if (type === "websocket") {
    nextConfig.url = text(payload.url ?? nextConfig.url).trim();
    nextConfig.sendText = text(payload.sendText ?? nextConfig.sendText);
    nextConfig.expectText = text(payload.expectText ?? nextConfig.expectText);
  }

  if (type === "ping") {
    nextConfig.host = text(payload.host ?? nextConfig.host).trim();
  }

  if (type === "dns") {
    nextConfig.host = text(payload.host ?? nextConfig.host).trim();
    nextConfig.recordType = text(payload.recordType ?? nextConfig.recordType, "A").trim().toUpperCase();
    nextConfig.expectedContains = text(payload.expectedContains ?? nextConfig.expectedContains).trim();
  }

  if (type === "push") {
    nextConfig.graceSeconds = Math.max(0, Number(payload.graceSeconds ?? nextConfig.graceSeconds ?? 0));
  }

  if (type === "docker") {
    nextConfig.container = text(payload.container ?? nextConfig.container).trim();
  }

  return {
    type,
    name: text(payload.name ?? current?.name).trim(),
    url: deriveDisplayUrl(type, nextConfig),
    method: text(payload.method ?? nextConfig.method ?? current?.method, "GET").trim().toUpperCase(),
    intervalSeconds: Math.max(10, Number(payload.intervalSeconds ?? payload.interval ?? current?.intervalSeconds ?? 60)),
    timeoutMs: Math.max(2_000, Number(payload.timeoutMs ?? current?.timeoutMs ?? 10_000)),
    retries: Math.max(0, Number(payload.retries ?? current?.retries ?? 0)),
    environment: text(payload.environment ?? current?.environment, "production").trim(),
    owner: text(payload.owner ?? current?.owner, "platform").trim(),
    description: text(payload.description ?? payload.notes ?? current?.description).trim(),
    tags: normalizeTags(payload.tags ?? current?.tags),
    config: nextConfig,
    proxyConfig:
      payload.proxyConfig && typeof payload.proxyConfig === "object" && !Array.isArray(payload.proxyConfig)
        ? payload.proxyConfig
        : current?.proxyConfig ?? null,
    notificationPolicy:
      payload.notificationPolicy && typeof payload.notificationPolicy === "object" && !Array.isArray(payload.notificationPolicy)
        ? payload.notificationPolicy
        : current?.notificationPolicy ?? null,
    paused: payload.paused == null ? Boolean(current?.paused) : Boolean(payload.paused),
    status: normalizeMonitorStatus(current?.status ?? "pending"),
    lastCheckedAt: current?.lastCheckedAt ?? null,
    createdAt: current?.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    nextCheckAt: current?.nextCheckAt ?? nowIso(),
    failureStreak: Math.max(0, Number(current?.failureStreak ?? 0)),
    unhealthyStreak: Math.max(0, Number(current?.unhealthyStreak ?? 0)),
    analysisState: text(current?.analysisState, "idle"),
    lastAnalysisId: current?.lastAnalysisId ?? null,
    lastIncidentId: current?.lastIncidentId ?? null,
    lastErrorMessage: current?.lastErrorMessage ?? null,
    expectedStatusCodes: text(payload.expectedStatusCodes ?? current?.expectedStatusCodes ?? nextConfig.expectedStatusCodes ?? "200-299").trim(),
    expectedBodyIncludes: text(payload.expectedBodyIncludes ?? current?.expectedBodyIncludes ?? nextConfig.expectedBodyIncludes ?? nextConfig.keyword ?? "").trim(),
    headerText: text(payload.headerText ?? current?.headerText ?? nextConfig.headersText ?? ""),
    body: text(payload.body ?? current?.body ?? nextConfig.body ?? ""),
    pushToken:
      type === "push"
        ? text(payload.pushToken ?? current?.pushToken ?? createId("push")).trim()
        : current?.pushToken ?? null,
  };
};

const parseHeaderText = (textValue) =>
  text(textValue)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((headers, line) => {
      const separatorIndex = line.indexOf(":");

      if (separatorIndex === -1) {
        return headers;
      }

      const key = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();

      if (key) {
        headers[key] = value;
      }

      return headers;
    }, {});

const matchesExpectedStatus = (statusCode, spec) => {
  const segments = text(spec, "200-299")
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return statusCode >= 200 && statusCode < 300;
  }

  return segments.some((segment) => {
    if (segment.includes("-")) {
      const [min, max] = segment.split("-").map((value) => Number(value.trim()));
      return Number.isFinite(min) && Number.isFinite(max) && statusCode >= min && statusCode <= max;
    }

    const exact = Number(segment);
    return Number.isFinite(exact) && statusCode === exact;
  });
};

const deriveLatencyThreshold = (monitor) => Math.max(750, Math.min(4_000, Math.round(Number(monitor.timeoutMs ?? 10_000) * 0.6)));

const classifyError = (error) => {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes("timed out") || lower.includes("timeout") || lower.includes("abort")) {
    return { classification: "timeout", message: "Request timed out before the endpoint responded." };
  }

  if (lower.includes("dns") || lower.includes("enotfound") || lower.includes("nxdomain")) {
    return { classification: "dns_failure", message: "DNS resolution failed for the monitor target." };
  }

  if (lower.includes("certificate") || lower.includes("tls") || lower.includes("ssl")) {
    return { classification: "tls_error", message: "TLS or certificate validation failed during the request." };
  }

  return { classification: "connection_error", message };
};

const getJsonPathValue = (value, pathExpression) => {
  const pathParts = text(pathExpression)
    .split(".")
    .map((part) => part.trim())
    .filter(Boolean);

  let current = value;
  for (const part of pathParts) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }

    current = current[part];
  }

  return current;
};

const normalizeCheck = (row) =>
  row
    ? {
        id: row.id,
        monitorId: row.monitorId,
        monitorType: row.monitorType ?? "http",
        incidentId: row.incidentId ?? null,
        checkedAt: row.checkedAt,
        startedAt: row.startedAt,
        status: normalizeMonitorStatus(row.status),
        latencyMs: Number(row.latencyMs ?? 0),
        statusCode: row.statusCode == null ? null : Number(row.statusCode),
        classification: text(row.classification),
        message: text(row.message),
        responsePreview: row.responsePreview == null ? null : text(row.responsePreview),
        responseBody: row.responseBody == null ? null : text(row.responseBody),
        responseHeaders: safeObject(row.responseHeaders),
        evidence: safeObject(row.evidence),
        rawResult: safeObject(row.rawResult),
      }
    : null;

const normalizeIncident = (row) =>
  row
    ? {
        id: row.id,
        monitorId: row.monitorId,
        title: text(row.title),
        status: text(row.status, "open"),
        severity: text(row.severity, "medium"),
        summary: text(row.summary),
        classification: text(row.classification),
        openedAt: row.openedAt,
        updatedAt: row.updatedAt,
        resolvedAt: row.resolvedAt ?? null,
        latestCheckId: row.latestCheckId ?? null,
        latestAnalysisId: row.latestAnalysisId ?? null,
        timelineVersion: Number(row.timelineVersion ?? 1),
        lastReportedAt: row.lastReportedAt ?? null,
      }
    : null;

const normalizeAnalysis = (row) =>
  row
    ? {
        id: row.id,
        kind: row.kind ?? "monitor-analysis",
        provider: row.provider ?? "fallback",
        monitorId: row.monitorId ?? null,
        incidentId: row.incidentId ?? null,
        createdAt: row.createdAt,
        source: row.source ?? "automatic",
        mode: row.mode ?? "fallback",
        model: row.model ?? "fallback-rules",
        status: row.status ?? "completed",
        facts: Array.isArray(row.facts) ? row.facts.map((item) => text(item)) : [],
        probableRootCause: text(row.probableRootCause),
        confidence: Number(row.confidence ?? 0),
        blastRadius: text(row.blastRadius),
        recommendedChecks: Array.isArray(row.recommendedChecks) ? row.recommendedChecks.map((item) => text(item)) : [],
        suggestedFixes: Array.isArray(row.suggestedFixes) ? row.suggestedFixes.map((item) => text(item)) : [],
        reportSummary: text(row.reportSummary),
        evidence: Array.isArray(row.evidence) ? row.evidence.map((item) => text(item)) : [],
        prompt: row.prompt ?? null,
        rawResponse: row.rawResponse ?? null,
        parsedResponse: row.parsedResponse ?? null,
        failureReason: row.failureReason ?? null,
        slmConfig: row.slmConfig ?? null,
        citations: Array.isArray(row.citations) ? row.citations.map((item) => text(item)) : [],
        retrievalMatches: Array.isArray(row.retrievalMatches) ? row.retrievalMatches : [],
        timeWindowStart: row.timeWindowStart ?? null,
        timeWindowEnd: row.timeWindowEnd ?? null,
      }
    : null;

const normalizeActivity = (row) =>
  row
    ? {
        id: row.id,
        timestamp: row.timestamp,
        type: text(row.type),
        severity: text(row.severity),
        title: text(row.title),
        message: text(row.message),
        monitorId: row.monitorId ?? null,
        incidentId: row.incidentId ?? null,
        metadata: safeObject(row.metadata),
      }
    : null;

const normalizeReport = (row) =>
  row
    ? {
        id: row.id,
        incidentId: row.incidentId,
        monitorId: row.monitorId,
        analysisId: row.analysisId ?? null,
        version: Number(row.version ?? 1),
        title: text(row.title),
        summary: text(row.summary),
        markdown: text(row.markdown),
        jsonPayload: safeObject(row.jsonPayload),
        fileBasePath: row.fileBasePath ?? null,
        createdAt: row.createdAt,
      }
    : null;

const normalizeMonitorRow = (row) => {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    type: normalizeType(row.type),
    name: text(row.name),
    url: text(row.url),
    method: text(row.method, "GET"),
    intervalSeconds: Math.max(10, Number(row.intervalSeconds ?? 60)),
    timeoutMs: Math.max(2_000, Number(row.timeoutMs ?? 10_000)),
    retries: Math.max(0, Number(row.retries ?? 0)),
    environment: text(row.environment, "production"),
    owner: text(row.owner, "platform"),
    description: text(row.description),
    tags: normalizeTags(row.tags),
    config: safeObject(row.config),
    proxyConfig: row.proxyConfig ?? null,
    notificationPolicy: row.notificationPolicy ?? null,
    pushToken: row.pushToken ?? null,
    paused: Boolean(row.paused),
    status: normalizeMonitorStatus(row.status),
    lastCheckedAt: row.lastCheckedAt ?? null,
    nextCheckAt: row.nextCheckAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    failureStreak: Math.max(0, Number(row.failureStreak ?? 0)),
    unhealthyStreak: Math.max(0, Number(row.unhealthyStreak ?? 0)),
    analysisState: text(row.analysisState, "idle"),
    lastAnalysisId: row.lastAnalysisId ?? null,
    lastIncidentId: row.lastIncidentId ?? null,
    lastErrorMessage: row.lastErrorMessage ?? null,
    expectedStatusCodes: text(row.expectedStatusCodes, "200-299"),
    expectedBodyIncludes: text(row.expectedBodyIncludes),
    headerText: text(row.headerText),
    body: text(row.body),
  };
};

const statusPriority = (monitor) => {
  if (monitor.paused) {
    return 4;
  }

  return { down: 0, degraded: 1, pending: 2, up: 3 }[monitor.status] ?? 5;
};

const summarizeIncident = (incident) =>
  incident
    ? {
        id: incident.id,
        monitorId: incident.monitorId,
        title: incident.title,
        status: incident.status,
        severity: incident.severity,
        summary: incident.summary,
        openedAt: incident.openedAt,
        updatedAt: incident.updatedAt,
        resolvedAt: incident.resolvedAt,
        classification: incident.classification,
      }
    : null;

const summarizeAnalysis = (analysis) =>
  analysis
    ? {
        id: analysis.id,
        createdAt: analysis.createdAt,
        source: analysis.source,
        mode: analysis.mode,
        provider: analysis.provider,
        model: analysis.model,
        status: analysis.status,
        facts: analysis.facts,
        probableRootCause: analysis.probableRootCause,
        confidence: analysis.confidence,
        blastRadius: analysis.blastRadius,
        recommendedChecks: analysis.recommendedChecks,
        suggestedFixes: analysis.suggestedFixes,
        reportSummary: analysis.reportSummary,
        evidence: analysis.evidence,
        citations: analysis.citations,
        retrievalMatches: analysis.retrievalMatches,
        timeWindowStart: analysis.timeWindowStart,
        timeWindowEnd: analysis.timeWindowEnd,
      }
    : null;

const emitChange = (payload = { type: "dashboard-changed" }) => {
  for (const listener of listeners) {
    listener(payload);
  }
};

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const recordActivity = async ({ type, severity, title, message, monitorId = null, incidentId = null, metadata = {} }) => {
  const event = {
    id: createId("evt"),
    timestamp: nowIso(),
    type,
    severity,
    title,
    message,
    monitorId,
    incidentId,
    metadata,
  };

  await query(
    `
      INSERT INTO "activity_events" ("id", "timestamp", "type", "severity", "title", "message", "monitorId", "incidentId", "metadata")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
    `,
    [event.id, event.timestamp, event.type, event.severity, event.title, event.message, monitorId, incidentId, JSON.stringify(metadata)],
  );

  await upsertSearchDocument({
    sourceType: "activity",
    sourceId: event.id,
    monitorId,
    incidentId,
    occurredAt: event.timestamp,
    title: event.title,
    body: event.message,
    metadata,
  });

  if (ACTIVITY_EVENT_RETENTION > 0) {
    const staleRows = await many(
      `
        SELECT "id"
        FROM "activity_events"
        ORDER BY "timestamp" DESC
        OFFSET $1
      `,
      [ACTIVITY_EVENT_RETENTION],
    );

    if (staleRows.length > 0) {
      await query(`DELETE FROM "activity_events" WHERE "id" = ANY($1::text[])`, [staleRows.map((row) => row.id)]);
    }
  }

  return event;
};

const upsertSearchDocument = async ({ sourceType, sourceId, monitorId = null, incidentId = null, occurredAt, title, body, metadata = {} }) => {
  await query(
    `
      INSERT INTO "search_documents" ("id", "sourceType", "sourceId", "monitorId", "incidentId", "occurredAt", "title", "body", "metadata")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      ON CONFLICT ("sourceType", "sourceId")
      DO UPDATE SET
        "monitorId" = EXCLUDED."monitorId",
        "incidentId" = EXCLUDED."incidentId",
        "occurredAt" = EXCLUDED."occurredAt",
        "title" = EXCLUDED."title",
        "body" = EXCLUDED."body",
        "metadata" = EXCLUDED."metadata"
    `,
    [`doc-${sourceType}-${sourceId}`, sourceType, sourceId, monitorId, incidentId, occurredAt, title, body, JSON.stringify(metadata)],
  );
};

const listMonitorRows = async () => (await many(`SELECT * FROM "monitors" ORDER BY "name" ASC`)).map(normalizeMonitorRow).filter(Boolean);

const getMonitorRow = async (monitorId) =>
  normalizeMonitorRow(await one(`SELECT * FROM "monitors" WHERE "id" = $1 LIMIT 1`, [monitorId]));

const listChecksForMonitor = async (monitorId, limit = 80) =>
  (await many(`SELECT * FROM "checks" WHERE "monitorId" = $1 ORDER BY "checkedAt" DESC LIMIT $2`, [monitorId, limit]))
    .map(normalizeCheck)
    .filter(Boolean);

const getLatestCheckForMonitor = async (monitorId) =>
  normalizeCheck(await one(`SELECT * FROM "checks" WHERE "monitorId" = $1 ORDER BY "checkedAt" DESC LIMIT 1`, [monitorId]));

const listAnalysesForMonitor = async (monitorId, limit = 12) =>
  (await many(`SELECT * FROM "analyses" WHERE "monitorId" = $1 ORDER BY "createdAt" DESC LIMIT $2`, [monitorId, limit]))
    .map(normalizeAnalysis)
    .filter(Boolean);

const getLatestAnalysisForMonitor = async (monitorId) =>
  normalizeAnalysis(await one(`SELECT * FROM "analyses" WHERE "monitorId" = $1 ORDER BY "createdAt" DESC LIMIT 1`, [monitorId]));

const listRecentActivity = async (limit = 20) =>
  (await many(`SELECT * FROM "activity_events" ORDER BY "timestamp" DESC LIMIT $1`, [limit])).map(normalizeActivity).filter(Boolean);

const listActivityForMonitor = async (monitorId, limit = 20) =>
  (await many(`SELECT * FROM "activity_events" WHERE "monitorId" = $1 ORDER BY "timestamp" DESC LIMIT $2`, [monitorId, limit]))
    .map(normalizeActivity)
    .filter(Boolean);

const listReportsForIncident = async (incidentId) =>
  (await many(`SELECT * FROM "reports" WHERE "incidentId" = $1 ORDER BY "version" DESC`, [incidentId])).map(normalizeReport).filter(Boolean);

const getOpenIncidentForMonitor = async (monitorId) =>
  normalizeIncident(
    await one(
      `SELECT * FROM "incidents" WHERE "monitorId" = $1 AND "status" <> 'resolved' ORDER BY "openedAt" DESC LIMIT 1`,
      [monitorId],
    ),
  );

const getIncidentHistoryForMonitor = async (monitorId) =>
  (await many(`SELECT * FROM "incidents" WHERE "monitorId" = $1 ORDER BY "openedAt" DESC`, [monitorId]))
    .map(normalizeIncident)
    .filter(Boolean);

const getIncidentRow = async (incidentId) => normalizeIncident(await one(`SELECT * FROM "incidents" WHERE "id" = $1 LIMIT 1`, [incidentId]));

const getUptimePercentage = async (monitorId, sinceIso) => {
  const totals = await one(
    `
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE "status" IN ('up', 'degraded'))::int AS "successful"
      FROM "checks"
      WHERE "monitorId" = $1
        AND "checkedAt" >= $2
    `,
    [monitorId, sinceIso],
  );

  const total = Number(totals?.total ?? 0);
  const successful = Number(totals?.successful ?? 0);
  return total > 0 ? Number(((successful / total) * 100).toFixed(2)) : 0;
};

const getAverageLatency = async (monitorId, limit = 40) => {
  const rows = await many(
    `
      SELECT "latencyMs"
      FROM "checks"
      WHERE "monitorId" = $1
        AND "status" IN ('up', 'degraded')
        AND "latencyMs" > 0
      ORDER BY "checkedAt" DESC
      LIMIT $2
    `,
    [monitorId, limit],
  );

  if (rows.length === 0) {
    return 0;
  }

  return Math.round(rows.reduce((total, row) => total + Number(row.latencyMs ?? 0), 0) / rows.length);
};

const getActiveMaintenances = async (monitorId = null, atIso = nowIso()) => {
  const rows = await many(
    `
      SELECT *
      FROM "maintenances"
      WHERE "isActive" = TRUE
    `,
  );

  const currentDate = new Date(atIso);
  const currentDay = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][currentDate.getUTCDay()];

  return rows.filter((row) => {
    const maintenance = {
      ...row,
      monitorIds: Array.isArray(row.monitorIds) ? row.monitorIds : [],
    };

    if (monitorId && maintenance.monitorIds.length > 0 && !maintenance.monitorIds.includes(monitorId)) {
      return false;
    }

    if (maintenance.scheduleType === "once") {
      return atIso >= maintenance.startsAt && atIso <= maintenance.endsAt;
    }

    if (maintenance.scheduleType === "daily") {
      const startTime = maintenance.startsAt.slice(11, 16);
      const endTime = maintenance.endsAt.slice(11, 16);
      const currentTime = atIso.slice(11, 16);
      return currentTime >= startTime && currentTime <= endTime;
    }

    if (maintenance.scheduleType === "weekly" && maintenance.rrule) {
      const dayMatch = /BYDAY=([^;]+)/i.exec(String(maintenance.rrule));
      const days = dayMatch ? dayMatch[1].split(",").map((item) => item.trim().toUpperCase()) : [];
      const startTime = maintenance.startsAt.slice(11, 16);
      const endTime = maintenance.endsAt.slice(11, 16);
      const currentTime = atIso.slice(11, 16);
      return days.includes(currentDay) && currentTime >= startTime && currentTime <= endTime;
    }

    return false;
  });
};

const isMaintenanceActiveForMonitor = async (monitorId, atIso = nowIso()) => (await getActiveMaintenances(monitorId, atIso)).length > 0;

const extractTlsCertificate = async (hostname, port = 443) =>
  new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: hostname,
        port,
        servername: hostname,
        rejectUnauthorized: false,
        timeout: 5_000,
      },
      async () => {
        try {
          const certificate = socket.getPeerCertificate();

          if (!certificate || Object.keys(certificate).length === 0) {
            socket.end();
            resolve(null);
            return;
          }

          resolve({
            hostname,
            subject: certificate.subject?.CN ?? null,
            issuer: certificate.issuer?.CN ?? null,
            validFrom: certificate.valid_from ? new Date(certificate.valid_from).toISOString() : null,
            validTo: certificate.valid_to ? new Date(certificate.valid_to).toISOString() : null,
          });
        } catch {
          resolve(null);
        } finally {
          socket.end();
        }
      },
    );

    socket.on("error", () => resolve(null));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(null);
    });
  });

const storeCertificateSnapshot = async (monitorId, certificate) => {
  if (!certificate?.validTo) {
    return null;
  }

  const id = createId("crt");
  const daysRemaining = Math.round((new Date(certificate.validTo).getTime() - Date.now()) / (24 * 60 * 60 * 1000));

  await query(
    `
      INSERT INTO "certificates" ("id", "monitorId", "hostname", "subject", "issuer", "validFrom", "validTo", "daysRemaining", "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `,
    [id, monitorId, certificate.hostname, certificate.subject, certificate.issuer, certificate.validFrom, certificate.validTo, daysRemaining, nowIso()],
  );

  return {
    id,
    ...certificate,
    daysRemaining,
  };
};

const classifyHttpResponse = ({ monitor, response, responseBody, latencyMs }) => {
  const statusMatched = matchesExpectedStatus(response.status, monitor.expectedStatusCodes);
  const bodyExpected = text(monitor.expectedBodyIncludes).trim();
  const bodyMatched = bodyExpected ? text(responseBody).toLowerCase().includes(bodyExpected.toLowerCase()) : true;

  if (!statusMatched) {
    return {
      status: "down",
      classification: response.status >= 500 ? "upstream_5xx" : "status_code_mismatch",
      message: `Expected ${monitor.expectedStatusCodes}, got HTTP ${response.status}.`,
    };
  }

  if (!bodyMatched) {
    return {
      status: "down",
      classification: "body_assertion_failed",
      message: `Response body did not include "${bodyExpected}".`,
    };
  }

  if (latencyMs >= deriveLatencyThreshold(monitor)) {
    return {
      status: "degraded",
      classification: "latency_degradation",
      message: `Response time crossed the warning threshold at ${latencyMs}ms.`,
    };
  }

  return {
    status: "up",
    classification: "healthy_response",
    message: `Monitor returned HTTP ${response.status} in ${latencyMs}ms.`,
  };
};

const executeHttpFamilyCheck = async (monitor) => {
  const startedAt = Date.now();
  const headers = parseHeaderText(monitor.headerText || monitor.config.headersText || "");

  try {
    const requestMethod = (monitor.config.method ?? monitor.method ?? "GET").toUpperCase();
    const requestBody = (monitor.config.body || monitor.body || "").trim();
    
    const response = await fetch(monitor.config.url, {
      method: requestMethod,
      headers,
      body: ["GET", "HEAD"].includes(requestMethod) || !requestBody ? undefined : requestBody,
      signal: AbortSignal.timeout(monitor.timeoutMs),
    });
    const responseText = await response.text();
    const latencyMs = Math.max(0, Date.now() - startedAt);
    const responseBody = responseText.slice(0, RESPONSE_BODY_LIMIT);
    const responseHeaders = Object.fromEntries(response.headers.entries());
    let classification = classifyHttpResponse({ monitor, response, responseBody, latencyMs });

    if (monitor.type === "keyword" && monitor.config.keyword) {
      if (!responseBody.toLowerCase().includes(String(monitor.config.keyword).toLowerCase())) {
        classification = {
          status: "down",
          classification: "keyword_missing",
          message: `Response body did not include keyword "${monitor.config.keyword}".`,
        };
      }
    }

    if (monitor.type === "json-query" && monitor.config.jsonPath) {
      try {
        const parsedJson = JSON.parse(responseText);
        const foundValue = getJsonPathValue(parsedJson, monitor.config.jsonPath);
        if (String(foundValue ?? "") !== String(monitor.config.expectedValue ?? "")) {
          classification = {
            status: "down",
            classification: "json_query_mismatch",
            message: `JSON path "${monitor.config.jsonPath}" expected "${monitor.config.expectedValue}" but found "${String(
              foundValue ?? "",
            )}".`,
          };
        }
      } catch {
        classification = {
          status: "down",
          classification: "json_parse_failed",
          message: "Response body was not valid JSON for this json-query monitor.",
        };
      }
    }

    let certificate = null;
    try {
      const url = new URL(monitor.config.url);
      if (url.protocol === "https:") {
        certificate = await storeCertificateSnapshot(monitor.id, await extractTlsCertificate(url.hostname, Number(url.port || 443)));
      }
    } catch {
      // Invalid URL already handled by the request path.
    }

    return normalizeCheck({
      id: createId("chk"),
      monitorId: monitor.id,
      monitorType: monitor.type,
      incidentId: null,
      startedAt: new Date(startedAt).toISOString(),
      checkedAt: nowIso(),
      status: classification.status,
      latencyMs,
      statusCode: response.status,
      classification: classification.classification,
      message: classification.message,
      responsePreview: responseBody.slice(0, 400),
      responseBody,
      responseHeaders,
      evidence: {
        expectedStatusCodes: monitor.expectedStatusCodes,
        expectedBodyIncludes: monitor.expectedBodyIncludes,
        keyword: monitor.config.keyword ?? null,
        jsonPath: monitor.config.jsonPath ?? null,
        expectedValue: monitor.config.expectedValue ?? null,
        certificate,
      },
      rawResult: {
        ok: response.ok,
        statusText: response.statusText,
      },
    });
  } catch (error) {
    const classified = classifyError(error);
    return normalizeCheck({
      id: createId("chk"),
      monitorId: monitor.id,
      monitorType: monitor.type,
      incidentId: null,
      startedAt: new Date(startedAt).toISOString(),
      checkedAt: nowIso(),
      status: "down",
      latencyMs: Math.max(0, Date.now() - startedAt),
      statusCode: null,
      classification: classified.classification,
      message: classified.message,
      responsePreview: null,
      responseBody: null,
      responseHeaders: {},
      evidence: {},
      rawResult: {},
    });
  }
};

const connectTcp = async (host, port, timeoutMs) =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const socket = net.createConnection({ host, port });

    const finalizeError = (error) => {
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(timeoutMs);
    socket.once("timeout", () => finalizeError(new Error("TCP connection timed out.")));
    socket.once("error", finalizeError);
    socket.once("connect", () => {
      const latencyMs = Date.now() - startedAt;
      socket.end();
      resolve(latencyMs);
    });
  });

const executeTcpCheck = async (monitor) => {
  const startedAt = Date.now();

  try {
    const latencyMs = Number(await connectTcp(monitor.config.host, Number(monitor.config.port), monitor.timeoutMs));
    return normalizeCheck({
      id: createId("chk"),
      monitorId: monitor.id,
      monitorType: monitor.type,
      incidentId: null,
      startedAt: new Date(startedAt).toISOString(),
      checkedAt: nowIso(),
      status: latencyMs >= deriveLatencyThreshold(monitor) ? "degraded" : "up",
      latencyMs,
      statusCode: null,
      classification: latencyMs >= deriveLatencyThreshold(monitor) ? "latency_degradation" : "tcp_connect_ok",
      message:
        latencyMs >= deriveLatencyThreshold(monitor)
          ? `TCP connection succeeded but latency rose to ${latencyMs}ms.`
          : `TCP connection succeeded in ${latencyMs}ms.`,
      responsePreview: null,
      responseBody: null,
      responseHeaders: {},
      evidence: { host: monitor.config.host, port: monitor.config.port },
      rawResult: {},
    });
  } catch (error) {
    const classified = classifyError(error);
    return normalizeCheck({
      id: createId("chk"),
      monitorId: monitor.id,
      monitorType: monitor.type,
      incidentId: null,
      startedAt: new Date(startedAt).toISOString(),
      checkedAt: nowIso(),
      status: "down",
      latencyMs: Math.max(0, Date.now() - startedAt),
      statusCode: null,
      classification: classified.classification,
      message: classified.message,
      responsePreview: null,
      responseBody: null,
      responseHeaders: {},
      evidence: { host: monitor.config.host, port: monitor.config.port },
      rawResult: {},
    });
  }
};

const executeDnsCheck = async (monitor) => {
  const startedAt = Date.now();

  try {
    const recordType = monitor.config.recordType || "A";
    const answers = await dns.resolve(monitor.config.host, recordType);
    const latencyMs = Date.now() - startedAt;
    const joined = answers.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join(", ");
    const expectedContains = text(monitor.config.expectedContains).trim();
    const matches = expectedContains ? joined.toLowerCase().includes(expectedContains.toLowerCase()) : true;

    return normalizeCheck({
      id: createId("chk"),
      monitorId: monitor.id,
      monitorType: monitor.type,
      incidentId: null,
      startedAt: new Date(startedAt).toISOString(),
      checkedAt: nowIso(),
      status: matches ? "up" : "down",
      latencyMs,
      statusCode: null,
      classification: matches ? "dns_ok" : "dns_value_mismatch",
      message: matches ? `Resolved ${recordType} records in ${latencyMs}ms.` : `DNS answer did not include "${expectedContains}".`,
      responsePreview: joined.slice(0, 400),
      responseBody: joined,
      responseHeaders: {},
      evidence: { host: monitor.config.host, recordType, answers },
      rawResult: {},
    });
  } catch (error) {
    const classified = classifyError(error);
    return normalizeCheck({
      id: createId("chk"),
      monitorId: monitor.id,
      monitorType: monitor.type,
      incidentId: null,
      startedAt: new Date(startedAt).toISOString(),
      checkedAt: nowIso(),
      status: "down",
      latencyMs: Math.max(0, Date.now() - startedAt),
      statusCode: null,
      classification: classified.classification,
      message: classified.message,
      responsePreview: null,
      responseBody: null,
      responseHeaders: {},
      evidence: { host: monitor.config.host, recordType: monitor.config.recordType },
      rawResult: {},
    });
  }
};

const executePingCheck = async (monitor) => {
  const startedAt = Date.now();

  try {
    const host = monitor.config.host;
    const isWindows = process.platform === "win32";
    const args = isWindows
      ? ["-n", "1", "-w", String(monitor.timeoutMs), host]
      : ["-c", "1", "-W", String(Math.max(1, Math.ceil(monitor.timeoutMs / 1000))), host];
    const { stdout } = await execFile("ping", args, { timeout: monitor.timeoutMs + 1_000 });
    const duration = Date.now() - startedAt;
    const match = /time[=<]\s*(\d+(?:\.\d+)?)\s*ms/i.exec(stdout) || /Average = (\d+)ms/i.exec(stdout);
    const latencyMs = match ? Math.round(Number(match[1])) : duration;

    return normalizeCheck({
      id: createId("chk"),
      monitorId: monitor.id,
      monitorType: monitor.type,
      incidentId: null,
      startedAt: new Date(startedAt).toISOString(),
      checkedAt: nowIso(),
      status: latencyMs >= deriveLatencyThreshold(monitor) ? "degraded" : "up",
      latencyMs,
      statusCode: null,
      classification: latencyMs >= deriveLatencyThreshold(monitor) ? "latency_degradation" : "ping_ok",
      message: `Ping completed in ${latencyMs}ms.`,
      responsePreview: stdout.slice(0, 400),
      responseBody: stdout,
      responseHeaders: {},
      evidence: { host },
      rawResult: {},
    });
  } catch (error) {
    const classified = classifyError(error);
    return normalizeCheck({
      id: createId("chk"),
      monitorId: monitor.id,
      monitorType: monitor.type,
      incidentId: null,
      startedAt: new Date(startedAt).toISOString(),
      checkedAt: nowIso(),
      status: "down",
      latencyMs: Math.max(0, Date.now() - startedAt),
      statusCode: null,
      classification: classified.classification,
      message: classified.message,
      responsePreview: null,
      responseBody: null,
      responseHeaders: {},
      evidence: { host: monitor.config.host },
      rawResult: {},
    });
  }
};

const executeWebSocketCheck = async (monitor) => {
  const startedAt = Date.now();

  try {
    const result = await new Promise((resolve, reject) => {
      const socket = new WebSocket(monitor.config.url);
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.close();
          reject(new Error("WebSocket connection timed out."));
        }
      }, monitor.timeoutMs);

      const finish = (value) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        resolve(value);
      };

      socket.addEventListener("open", () => {
        if (monitor.config.sendText) {
          socket.send(monitor.config.sendText);
        }

        if (!monitor.config.expectText) {
          finish({ message: "WebSocket connection opened successfully." });
          socket.close();
        }
      });

      socket.addEventListener("message", (event) => {
        const received = typeof event.data === "string" ? event.data : "";

        if (!monitor.config.expectText || received.includes(monitor.config.expectText)) {
          finish({ message: "WebSocket received the expected response.", received });
          socket.close();
        }
      });

      socket.addEventListener("error", () => reject(new Error("WebSocket connection failed.")));
    });

    const latencyMs = Math.max(0, Date.now() - startedAt);
    return normalizeCheck({
      id: createId("chk"),
      monitorId: monitor.id,
      monitorType: monitor.type,
      incidentId: null,
      startedAt: new Date(startedAt).toISOString(),
      checkedAt: nowIso(),
      status: latencyMs >= deriveLatencyThreshold(monitor) ? "degraded" : "up",
      latencyMs,
      statusCode: null,
      classification: latencyMs >= deriveLatencyThreshold(monitor) ? "latency_degradation" : "websocket_ok",
      message: result.message,
      responsePreview: result.received?.slice(0, 400) ?? null,
      responseBody: result.received ?? null,
      responseHeaders: {},
      evidence: { url: monitor.config.url },
      rawResult: {},
    });
  } catch (error) {
    const classified = classifyError(error);
    return normalizeCheck({
      id: createId("chk"),
      monitorId: monitor.id,
      monitorType: monitor.type,
      incidentId: null,
      startedAt: new Date(startedAt).toISOString(),
      checkedAt: nowIso(),
      status: "down",
      latencyMs: Math.max(0, Date.now() - startedAt),
      statusCode: null,
      classification: classified.classification,
      message: classified.message,
      responsePreview: null,
      responseBody: null,
      responseHeaders: {},
      evidence: { url: monitor.config.url },
      rawResult: {},
    });
  }
};

const executePushMonitorCheck = async (monitor) => {
  const latest = await getLatestCheckForMonitor(monitor.id);
  const graceSeconds = Math.max(0, Number(monitor.config.graceSeconds ?? 0));
  const allowedGapMs = (monitor.intervalSeconds + graceSeconds) * 1000;
  const lastHealthyAt = latest?.checkedAt ?? monitor.lastCheckedAt;

  if (!lastHealthyAt || Date.now() - new Date(lastHealthyAt).getTime() > allowedGapMs) {
    return normalizeCheck({
      id: createId("chk"),
      monitorId: monitor.id,
      monitorType: monitor.type,
      incidentId: null,
      startedAt: nowIso(),
      checkedAt: nowIso(),
      status: "down",
      latencyMs: 0,
      statusCode: null,
      classification: "push_timeout",
      message: "No push heartbeat arrived before the expected deadline.",
      responsePreview: null,
      responseBody: null,
      responseHeaders: {},
      evidence: { graceSeconds },
      rawResult: {},
    });
  }

  return normalizeCheck({
    id: createId("chk"),
    monitorId: monitor.id,
    monitorType: monitor.type,
    incidentId: null,
    startedAt: nowIso(),
    checkedAt: nowIso(),
    status: "up",
    latencyMs: 0,
    statusCode: null,
    classification: "push_recent",
    message: "Push heartbeat is still within the allowed interval.",
    responsePreview: null,
    responseBody: null,
    responseHeaders: {},
    evidence: { graceSeconds, lastHealthyAt },
    rawResult: {},
  });
};

const executePlaceholderCheck = async (monitor, type) =>
  normalizeCheck({
    id: createId("chk"),
    monitorId: monitor.id,
    monitorType: type,
    incidentId: null,
    startedAt: nowIso(),
    checkedAt: nowIso(),
    status: "down",
    latencyMs: 0,
    statusCode: null,
    classification: `${type}_not_implemented`,
    message: `${type} monitor support is planned but not yet active in this runtime.`,
    responsePreview: null,
    responseBody: null,
    responseHeaders: {},
    evidence: monitor.config,
    rawResult: {},
  });

const executeCheckOnce = async (monitor) => {
  switch (monitor.type) {
    case "http":
    case "keyword":
    case "json-query":
      return executeHttpFamilyCheck(monitor);
    case "tcp":
      return executeTcpCheck(monitor);
    case "websocket":
      return executeWebSocketCheck(monitor);
    case "ping":
      return executePingCheck(monitor);
    case "dns":
      return executeDnsCheck(monitor);
    case "push":
      return executePushMonitorCheck(monitor);
    case "docker":
    case "steam":
      return executePlaceholderCheck(monitor, monitor.type);
    default:
      return executeHttpFamilyCheck(monitor);
  }
};

const executeCheckWithRetries = async (monitor) => {
  let lastCheck = null;
  const maxAttempts = Math.max(1, monitor.retries + 1);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    lastCheck = await executeCheckOnce(monitor);
    if (lastCheck.status !== "down") {
      return lastCheck;
    }
  }

  return lastCheck;
};

const calculateSeverity = (check) => {
  if (check.status === "down") {
    if (check.classification === "push_timeout" || check.classification === "dns_failure" || check.classification === "timeout") {
      return "critical";
    }
    return "high";
  }

  return "medium";
};

const buildIncidentTitle = (monitor, check) => {
  if (check.status === "degraded") {
    return `${monitor.name} is degraded`;
  }

  switch (check.classification) {
    case "timeout":
      return `${monitor.name} is timing out`;
    case "dns_failure":
      return `${monitor.name} has DNS failures`;
    case "tls_error":
      return `${monitor.name} has TLS failures`;
    case "push_timeout":
      return `${monitor.name} stopped sending heartbeats`;
    default:
      return `${monitor.name} is down`;
  }
};

const shouldTriggerAnalysis = (previousIncident, nextIncident, check) => {
  if (!nextIncident) {
    return false;
  }

  if (!previousIncident) {
    return true;
  }

  return (
    previousIncident.status !== nextIncident.status ||
    previousIncident.summary !== nextIncident.summary ||
    previousIncident.classification !== nextIncident.classification ||
    check.status !== "up"
  );
};

const pruneMonitorHistory = async (monitorId) => {
  if (CHECK_RETENTION_PER_MONITOR > 0) {
    const staleChecks = await many(
      `
        SELECT "id"
        FROM "checks"
        WHERE "monitorId" = $1
        ORDER BY "checkedAt" DESC
        OFFSET $2
      `,
      [monitorId, CHECK_RETENTION_PER_MONITOR],
    );

    if (staleChecks.length > 0) {
      await query(`DELETE FROM "checks" WHERE "id" = ANY($1::text[])`, [staleChecks.map((row) => row.id)]);
    }
  }

  if (ANALYSIS_RETENTION_PER_MONITOR > 0) {
    const staleAnalyses = await many(
      `
        SELECT "id"
        FROM "analyses"
        WHERE "monitorId" = $1
        ORDER BY "createdAt" DESC
        OFFSET $2
      `,
      [monitorId, ANALYSIS_RETENTION_PER_MONITOR],
    );

    if (staleAnalyses.length > 0) {
      await query(`DELETE FROM "analyses" WHERE "id" = ANY($1::text[])`, [staleAnalyses.map((row) => row.id)]);
    }
  }
};

const enqueueJob = async ({ type, priority = 100, runAt = nowIso(), payload = {}, dedupeKey = null, maxAttempts = 6 }) => {
  const job = {
    id: createId("job"),
    type,
    status: "pending",
    priority,
    runAt,
    payload,
    dedupeKey,
    attempts: 0,
    maxAttempts,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  try {
    await query(
      `
        INSERT INTO "jobs" ("id", "type", "status", "priority", "runAt", "payload", "dedupeKey", "attempts", "maxAttempts", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)
      `,
      [
        job.id,
        job.type,
        job.status,
        job.priority,
        job.runAt,
        JSON.stringify(job.payload),
        job.dedupeKey,
        job.attempts,
        job.maxAttempts,
        job.createdAt,
        job.updatedAt,
      ],
    );
    return job;
  } catch (error) {
    if (error?.code === "23505") {
      return null;
    }

    throw error;
  }
};

const claimNextJob = async (type, leaseMs = 30_000) =>
  withTransaction(async (client) => {
    const row = await one(
      `
        WITH candidate AS (
          SELECT "id"
          FROM "jobs"
          WHERE "type" = $1
            AND "runAt" <= $2
            AND (
              "status" = 'pending'
              OR ("status" = 'leased' AND ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" < $2))
            )
          ORDER BY "priority" ASC, "runAt" ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE "jobs"
        SET
          "status" = 'leased',
          "workerId" = $3,
          "leaseExpiresAt" = $4,
          "updatedAt" = $2,
          "attempts" = "jobs"."attempts" + 1
        WHERE "id" IN (SELECT "id" FROM candidate)
        RETURNING *
      `,
      [type, nowIso(), workerIdentity, new Date(Date.now() + leaseMs).toISOString()],
      client,
    );

    return row ?? null;
  });

const completeJob = async (jobId) => {
  await query(
    `
      UPDATE "jobs"
      SET "status" = 'completed', "completedAt" = $2, "updatedAt" = $2, "leaseExpiresAt" = NULL
      WHERE "id" = $1
    `,
    [jobId, nowIso()],
  );
};

const failJob = async (job, error) => {
  const attempts = Number(job.attempts ?? 1);
  const maxAttempts = Number(job.maxAttempts ?? 6);
  const nextStatus = attempts >= maxAttempts ? "failed" : "pending";
  const nextRunAt = new Date(Date.now() + Math.min(60_000, 2 ** Math.min(attempts, 6) * 1_000)).toISOString();

  await query(
    `
      UPDATE "jobs"
      SET
        "status" = $2,
        "runAt" = $3,
        "leaseExpiresAt" = NULL,
        "updatedAt" = $4,
        "lastError" = $5
      WHERE "id" = $1
    `,
    [job.id, nextStatus, nextStatus === "failed" ? job.runAt : nextRunAt, nowIso(), error instanceof Error ? error.message : String(error)],
  );
};

const getQueueState = async () => {
  const row = await one(
    `
      SELECT
        COUNT(*) FILTER (WHERE "type" = 'monitor.analysis' AND "status" IN ('pending', 'leased'))::int AS "analysisDepth",
        COUNT(*) FILTER (WHERE "type" = 'monitor.analysis' AND "status" = 'leased')::int AS "analysisRunning"
      FROM "jobs"
    `,
  );

  return {
    depth: Number(row?.analysisDepth ?? 0),
    running: Number(row?.analysisRunning ?? 0),
    concurrency: ANALYSIS_WORKER_CONCURRENCY,
  };
};

const upsertMonitorRow = async (monitor) => {
  await query(
    `
      INSERT INTO "monitors" (
        "id", "type", "name", "url", "method", "intervalSeconds", "timeoutMs", "retries", "environment", "owner",
        "description", "tags", "config", "proxyConfig", "notificationPolicy", "pushToken", "expectedStatusCodes",
        "expectedBodyIncludes", "headerText", "body", "paused", "status", "lastCheckedAt", "nextCheckAt",
        "createdAt", "updatedAt", "failureStreak", "unhealthyStreak", "analysisState", "lastAnalysisId",
        "lastIncidentId", "lastErrorMessage"
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        $11, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb, $16, $17,
        $18, $19, $20, $21, $22, $23, $24,
        $25, $26, $27, $28, $29, $30,
        $31, $32
      )
      ON CONFLICT ("id")
      DO UPDATE SET
        "type" = EXCLUDED."type",
        "name" = EXCLUDED."name",
        "url" = EXCLUDED."url",
        "method" = EXCLUDED."method",
        "intervalSeconds" = EXCLUDED."intervalSeconds",
        "timeoutMs" = EXCLUDED."timeoutMs",
        "retries" = EXCLUDED."retries",
        "environment" = EXCLUDED."environment",
        "owner" = EXCLUDED."owner",
        "description" = EXCLUDED."description",
        "tags" = EXCLUDED."tags",
        "config" = EXCLUDED."config",
        "proxyConfig" = EXCLUDED."proxyConfig",
        "notificationPolicy" = EXCLUDED."notificationPolicy",
        "pushToken" = EXCLUDED."pushToken",
        "expectedStatusCodes" = EXCLUDED."expectedStatusCodes",
        "expectedBodyIncludes" = EXCLUDED."expectedBodyIncludes",
        "headerText" = EXCLUDED."headerText",
        "body" = EXCLUDED."body",
        "paused" = EXCLUDED."paused",
        "status" = EXCLUDED."status",
        "lastCheckedAt" = EXCLUDED."lastCheckedAt",
        "nextCheckAt" = EXCLUDED."nextCheckAt",
        "updatedAt" = EXCLUDED."updatedAt",
        "failureStreak" = EXCLUDED."failureStreak",
        "unhealthyStreak" = EXCLUDED."unhealthyStreak",
        "analysisState" = EXCLUDED."analysisState",
        "lastAnalysisId" = EXCLUDED."lastAnalysisId",
        "lastIncidentId" = EXCLUDED."lastIncidentId",
        "lastErrorMessage" = EXCLUDED."lastErrorMessage"
    `,
    [
      monitor.id,
      monitor.type,
      monitor.name,
      monitor.url,
      monitor.method,
      monitor.intervalSeconds,
      monitor.timeoutMs,
      monitor.retries,
      monitor.environment,
      monitor.owner,
      monitor.description,
      JSON.stringify(monitor.tags),
      JSON.stringify(monitor.config),
      JSON.stringify(monitor.proxyConfig),
      JSON.stringify(monitor.notificationPolicy),
      monitor.pushToken,
      monitor.expectedStatusCodes,
      monitor.expectedBodyIncludes,
      monitor.headerText,
      monitor.body,
      monitor.paused,
      monitor.status,
      monitor.lastCheckedAt,
      monitor.nextCheckAt,
      monitor.createdAt,
      monitor.updatedAt,
      monitor.failureStreak,
      monitor.unhealthyStreak,
      monitor.analysisState,
      monitor.lastAnalysisId,
      monitor.lastIncidentId,
      monitor.lastErrorMessage,
    ],
  );
};

const buildNextMonitorState = (monitor, check) => ({
  ...monitor,
  lastCheckedAt: check.checkedAt,
  nextCheckAt: new Date(new Date(check.checkedAt).getTime() + monitor.intervalSeconds * 1000).toISOString(),
  updatedAt: check.checkedAt,
  status: check.status,
  lastErrorMessage: check.status === "down" ? check.message : null,
  failureStreak: check.status === "down" ? monitor.failureStreak + 1 : 0,
  unhealthyStreak: check.status === "up" ? 0 : monitor.unhealthyStreak + 1,
});

const insertCheck = async (check) => {
  await query(
    `
      INSERT INTO "checks" (
        "id", "monitorId", "monitorType", "incidentId", "startedAt", "checkedAt", "status", "latencyMs", "statusCode",
        "classification", "message", "responsePreview", "responseBody", "responseHeaders", "evidence", "rawResult"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb, $16::jsonb)
    `,
    [
      check.id,
      check.monitorId,
      check.monitorType,
      check.incidentId,
      check.startedAt,
      check.checkedAt,
      check.status,
      check.latencyMs,
      check.statusCode,
      check.classification,
      check.message,
      check.responsePreview,
      check.responseBody,
      JSON.stringify(check.responseHeaders ?? {}),
      JSON.stringify(check.evidence ?? {}),
      JSON.stringify(check.rawResult ?? {}),
    ],
  );
};

const syncIncidentState = async (monitor, check) => {
  const openIncident = await getOpenIncidentForMonitor(monitor.id);
  const nextSeverity = calculateSeverity(check);

  if (check.status === "up") {
    if (!openIncident) {
      return null;
    }

    const resolvedAt = nowIso();
    const nextIncident = {
      ...openIncident,
      status: "resolved",
      summary: `Recovered: ${check.message}`,
      updatedAt: resolvedAt,
      resolvedAt,
      latestCheckId: check.id,
      timelineVersion: Number(openIncident.timelineVersion ?? 1) + 1,
    };

    await query(
      `
        UPDATE "incidents"
        SET "status" = 'resolved', "summary" = $2, "updatedAt" = $3, "resolvedAt" = $3, "latestCheckId" = $4, "timelineVersion" = $5
        WHERE "id" = $1
      `,
      [openIncident.id, nextIncident.summary, resolvedAt, check.id, nextIncident.timelineVersion],
    );
    await recordActivity({
      type: "incident",
      severity: "info",
      title: `${monitor.name} recovered`,
      message: check.message,
      monitorId: monitor.id,
      incidentId: openIncident.id,
    });

    await enqueueJob({
      type: "notification.delivery",
      priority: 60,
      dedupeKey: `notify:recovery:${openIncident.id}:${nextIncident.timelineVersion}`,
      payload: { eventType: "recovered", incidentId: openIncident.id, monitorId: monitor.id },
    });
    await enqueueJob({
      type: "monitor.analysis",
      priority: 70,
      dedupeKey: `analysis:recovery:${monitor.id}:${openIncident.id}`,
      payload: { monitorId: monitor.id, incidentId: openIncident.id, source: "automatic", eventType: "recovered" },
    });

    return nextIncident;
  }

  if (!openIncident) {
    const incident = normalizeIncident({
      id: createId("inc"),
      monitorId: monitor.id,
      title: buildIncidentTitle(monitor, check),
      status: "open",
      severity: nextSeverity,
      summary: check.message,
      classification: check.classification,
      openedAt: check.checkedAt,
      updatedAt: check.checkedAt,
      resolvedAt: null,
      latestCheckId: check.id,
      latestAnalysisId: null,
      timelineVersion: 1,
      lastReportedAt: null,
    });

    await query(
      `
        INSERT INTO "incidents" ("id", "monitorId", "title", "status", "severity", "summary", "classification", "openedAt", "updatedAt", "resolvedAt", "latestCheckId", "latestAnalysisId", "timelineVersion", "lastReportedAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8, NULL, $9, NULL, 1, NULL)
      `,
      [incident.id, incident.monitorId, incident.title, incident.status, incident.severity, incident.summary, incident.classification, incident.openedAt, incident.latestCheckId],
    );

    await recordActivity({
      type: "incident",
      severity: incident.severity,
      title: incident.title,
      message: incident.summary,
      monitorId: monitor.id,
      incidentId: incident.id,
    });

    await enqueueJob({
      type: "monitor.analysis",
      priority: 20,
      dedupeKey: `analysis:incident-open:${monitor.id}:${incident.id}`,
      payload: { monitorId: monitor.id, incidentId: incident.id, source: "automatic", eventType: "opened" },
    });
    await enqueueJob({
      type: "notification.delivery",
      priority: 30,
      dedupeKey: `notify:opened:${incident.id}:1`,
      payload: { eventType: "opened", incidentId: incident.id, monitorId: monitor.id },
    });

    return incident;
  }

  const updated = {
    ...openIncident,
    title: buildIncidentTitle(monitor, check),
    status: check.status === "degraded" ? "investigating" : "open",
    severity: nextSeverity,
    summary: check.message,
    classification: check.classification,
    updatedAt: check.checkedAt,
    latestCheckId: check.id,
    timelineVersion:
      openIncident.summary !== check.message || openIncident.classification !== check.classification || openIncident.status !== check.status
        ? Number(openIncident.timelineVersion ?? 1) + 1
        : Number(openIncident.timelineVersion ?? 1),
  };

  await query(
    `
      UPDATE "incidents"
      SET
        "title" = $2,
        "status" = $3,
        "severity" = $4,
        "summary" = $5,
        "classification" = $6,
        "updatedAt" = $7,
        "latestCheckId" = $8,
        "timelineVersion" = $9
      WHERE "id" = $1
    `,
    [openIncident.id, updated.title, updated.status, updated.severity, updated.summary, updated.classification, updated.updatedAt, updated.latestCheckId, updated.timelineVersion],
  );

  if (shouldTriggerAnalysis(openIncident, updated, check)) {
    await recordActivity({
      type: "incident",
      severity: updated.severity,
      title: `${monitor.name} incident updated`,
      message: updated.summary,
      monitorId: monitor.id,
      incidentId: updated.id,
    });
    await enqueueJob({
      type: "monitor.analysis",
      priority: 40,
      dedupeKey: `analysis:incident-update:${monitor.id}:${updated.id}:${updated.timelineVersion}`,
      payload: { monitorId: monitor.id, incidentId: updated.id, source: "automatic", eventType: "updated" },
    });
    await enqueueJob({
      type: "notification.delivery",
      priority: 50,
      dedupeKey: `notify:updated:${updated.id}:${updated.timelineVersion}`,
      payload: { eventType: "updated", incidentId: updated.id, monitorId: monitor.id },
    });
  }

  return updated;
};

const fetchNotificationChannels = async () => await many(`SELECT * FROM "notification_channels" ORDER BY "createdAt" DESC`);

const matchRule = ({ rule, incident, monitor, eventType }) => {
  const monitorIds = Array.isArray(rule.monitorIds) ? rule.monitorIds : [];
  const tags = Array.isArray(rule.tags) ? rule.tags : [];
  const eventTypes = Array.isArray(rule.eventTypes) ? rule.eventTypes : [];
  const severities = Array.isArray(rule.severities) ? rule.severities : [];

  if (monitorIds.length > 0 && !monitorIds.includes(monitor.id)) {
    return false;
  }

  if (tags.length > 0 && !monitor.tags.some((tag) => tags.includes(tag))) {
    return false;
  }

  if (eventTypes.length > 0 && !eventTypes.includes(eventType)) {
    return false;
  }

  if (severities.length > 0 && !severities.includes(incident.severity)) {
    return false;
  }

  return Boolean(rule.isEnabled);
};

const queueNotificationsForIncident = async ({ eventType, incident, monitor }) => {
  if (await isMaintenanceActiveForMonitor(monitor.id)) {
    return [];
  }

  const rules = await many(`SELECT * FROM "notification_rules" WHERE "isEnabled" = TRUE ORDER BY "createdAt" DESC`);
  const matchingRules = rules.filter((rule) => matchRule({ rule, incident, monitor, eventType }));
  const deliveries = [];

  for (const rule of matchingRules) {
    const channelIds = Array.isArray(rule.channelIds) ? rule.channelIds : [];
    for (const channelId of channelIds) {
      const deliveryId = createId("ntf");
      await query(
        `
          INSERT INTO "notification_deliveries" ("id", "channelId", "ruleId", "monitorId", "incidentId", "eventType", "status", "attempts", "responseSummary", "payloadSnapshot", "createdAt", "updatedAt", "deliveredAt")
          VALUES ($1, $2, $3, $4, $5, $6, 'pending', 0, NULL, $7::jsonb, $8, $8, NULL)
        `,
        [deliveryId, channelId, rule.id, monitor.id, incident.id, eventType, JSON.stringify({ monitorId: monitor.id, incidentId: incident.id, eventType }), nowIso()],
      );
      deliveries.push(deliveryId);
      await enqueueJob({
        type: "notification.delivery",
        priority: 40,
        dedupeKey: `delivery:${deliveryId}`,
        payload: { deliveryId },
      });
    }
  }

  return deliveries;
};

const buildAnalysisContext = async (monitorId, incidentId = null) => {
  const monitor = await getMonitorDetail(monitorId);
  const incident = incidentId ? await getIncidentRow(incidentId) : await getOpenIncidentForMonitor(monitorId);
  const relatedActivity = await listActivityForMonitor(monitorId, 12);
  const retrievalMatches = incident
    ? await searchHistoricalEvidence(`incident ${incident.title} ${incident.summary}`, { monitorId, incidentId: incident.id, limit: 6 })
    : [];

  return {
    monitor: monitor?.monitor ?? null,
    incident: summarizeIncident(incident),
    recentChecks: monitor?.recentChecks ?? [],
    relatedActivity,
    retrievalMatches,
    timeWindow: incident ? { start: incident.openedAt, end: incident.resolvedAt ?? incident.updatedAt } : null,
  };
};

const createIncidentReportVersion = async ({ incidentId, analysisId = null }) => {
  const incident = await getIncidentRow(incidentId);
  if (!incident) {
    return null;
  }

  const monitor = await getMonitorRow(incident.monitorId);
  const analysis = analysisId
    ? normalizeAnalysis(await one(`SELECT * FROM "analyses" WHERE "id" = $1 LIMIT 1`, [analysisId]))
    : normalizeAnalysis(await one(`SELECT * FROM "analyses" WHERE "incidentId" = $1 ORDER BY "createdAt" DESC LIMIT 1`, [incidentId]));
  const timeline = (await many(`SELECT * FROM "activity_events" WHERE "incidentId" = $1 ORDER BY "timestamp" ASC`, [incidentId])).map(normalizeActivity);
  const currentVersion = await one(`SELECT COALESCE(MAX("version"), 0)::int AS "version" FROM "reports" WHERE "incidentId" = $1`, [incidentId]);
  const version = Number(currentVersion?.version ?? 0) + 1;
  const report = buildIncidentReport({ incident, monitor, analysis, timeline });
  const fileBasePath = await writeReportArtifacts({ incidentId, version, report });
  const reportId = createId("rpt");

  await query(
    `
      INSERT INTO "reports" ("id", "incidentId", "monitorId", "analysisId", "version", "title", "summary", "markdown", "jsonPayload", "fileBasePath", "createdAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
    `,
    [reportId, incidentId, incident.monitorId, analysis?.id ?? analysisId, version, report.title, report.summary, report.markdown, JSON.stringify(report.jsonPayload), fileBasePath, nowIso()],
  );

  await query(`UPDATE "incidents" SET "lastReportedAt" = $2 WHERE "id" = $1`, [incidentId, nowIso()]);
  await upsertSearchDocument({
    sourceType: "report",
    sourceId: reportId,
    monitorId: incident.monitorId,
    incidentId,
    occurredAt: nowIso(),
    title: report.title,
    body: `${report.summary}\n${report.markdown}`,
    metadata: { version, analysisId: analysis?.id ?? null },
  });

  return normalizeReport(await one(`SELECT * FROM "reports" WHERE "id" = $1 LIMIT 1`, [reportId]));
};

const createAnalysisRow = async ({ monitorId, incidentId = null, source = "automatic", eventType = "updated" }) => {
  const context = await buildAnalysisContext(monitorId, incidentId);
  if (!context.monitor) {
    throw new Error("Monitor not found.");
  }

  const analysisResult = await generateMonitorAnalysis(context);
  const row = normalizeAnalysis({
    id: createId("ana"),
    kind: "monitor-analysis",
    provider: analysisResult.provider ?? "fallback",
    monitorId,
    incidentId,
    createdAt: nowIso(),
    source,
    mode: analysisResult.mode,
    model: analysisResult.model,
    status: analysisResult.status,
    facts: analysisResult.facts,
    probableRootCause: analysisResult.probableRootCause,
    confidence: analysisResult.confidence,
    blastRadius: analysisResult.blastRadius,
    recommendedChecks: analysisResult.recommendedChecks,
    suggestedFixes: analysisResult.suggestedFixes,
    reportSummary: analysisResult.reportSummary,
    evidence: analysisResult.evidence,
    prompt: analysisResult.prompt,
    rawResponse: analysisResult.rawResponse,
    parsedResponse: analysisResult.parsedResponse,
    failureReason: analysisResult.failureReason,
    slmConfig: analysisResult.slmConfig,
    citations: analysisResult.citations ?? [],
    retrievalMatches: analysisResult.retrievalMatches ?? [],
    timeWindowStart: analysisResult.timeWindowStart ?? null,
    timeWindowEnd: analysisResult.timeWindowEnd ?? null,
  });

  await query(
    `
      INSERT INTO "analyses" (
        "id", "kind", "provider", "monitorId", "incidentId", "createdAt", "source", "mode", "model", "status", "facts",
        "probableRootCause", "confidence", "blastRadius", "recommendedChecks", "suggestedFixes", "reportSummary", "evidence",
        "prompt", "rawResponse", "parsedResponse", "failureReason", "slmConfig", "contextSnapshot", "citations", "retrievalMatches",
        "timeWindowStart", "timeWindowEnd"
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb,
        $12, $13, $14, $15::jsonb, $16::jsonb, $17, $18::jsonb,
        $19, $20, $21::jsonb, $22, $23::jsonb, $24::jsonb, $25::jsonb, $26::jsonb,
        $27, $28
      )
    `,
    [
      row.id,
      row.kind,
      row.provider,
      row.monitorId,
      row.incidentId,
      row.createdAt,
      row.source,
      row.mode,
      row.model,
      row.status,
      JSON.stringify(row.facts),
      row.probableRootCause,
      row.confidence,
      row.blastRadius,
      JSON.stringify(row.recommendedChecks),
      JSON.stringify(row.suggestedFixes),
      row.reportSummary,
      JSON.stringify(row.evidence),
      row.prompt,
      row.rawResponse,
      JSON.stringify(row.parsedResponse),
      row.failureReason,
      JSON.stringify(row.slmConfig),
      JSON.stringify(context),
      JSON.stringify(row.citations),
      JSON.stringify(row.retrievalMatches),
      row.timeWindowStart,
      row.timeWindowEnd,
    ],
  );

  await query(`UPDATE "monitors" SET "analysisState" = 'completed', "lastAnalysisId" = $2, "updatedAt" = $3 WHERE "id" = $1`, [monitorId, row.id, nowIso()]);

  if (incidentId) {
    await query(`UPDATE "incidents" SET "latestAnalysisId" = $2, "updatedAt" = $3 WHERE "id" = $1`, [incidentId, row.id, nowIso()]);
  }

  await recordActivity({
    type: "analysis",
    severity: eventType === "recovered" ? "info" : row.mode === "live" ? "info" : "medium",
    title: `${context.monitor.name} analysis refreshed`,
    message: row.reportSummary,
    monitorId,
    incidentId,
    metadata: { analysisId: row.id, mode: row.mode, provider: row.provider },
  });

  await upsertSearchDocument({
    sourceType: "analysis",
    sourceId: row.id,
    monitorId,
    incidentId,
    occurredAt: row.createdAt,
    title: `${context.monitor.name} analysis`,
    body: `${row.reportSummary}\n${row.probableRootCause}\n${row.suggestedFixes.join("\n")}`,
    metadata: { citations: row.citations },
  });

  if (incidentId) {
    await createIncidentReportVersion({ incidentId, analysisId: row.id });
  }

  await pruneMonitorHistory(monitorId);
  return row;
};

const processNotificationDelivery = async (deliveryId) => {
  const delivery = await one(`SELECT * FROM "notification_deliveries" WHERE "id" = $1 LIMIT 1`, [deliveryId]);
  if (!delivery) {
    return null;
  }

  const channel = await one(`SELECT * FROM "notification_channels" WHERE "id" = $1 LIMIT 1`, [delivery.channelId]);
  const incident = await getIncidentRow(delivery.incidentId);
  const monitor = await getMonitorRow(delivery.monitorId);
  const report = incident ? (await listReportsForIncident(incident.id))[0] ?? null : null;

  if (!channel || !monitor || !incident) {
    await query(`UPDATE "notification_deliveries" SET "status" = 'failed', "responseSummary" = $2, "updatedAt" = $3 WHERE "id" = $1`, [
      deliveryId,
      "Delivery context is incomplete.",
      nowIso(),
    ]);
    return null;
  }

  try {
    const result = await deliverNotification({
      channel,
      payload: { eventType: delivery.eventType, incident, monitor, report, dashboardUrl: DASHBOARD_URL },
    });

    await query(
      `
        UPDATE "notification_deliveries"
        SET "status" = 'delivered', "attempts" = "attempts" + 1, "responseSummary" = $2, "updatedAt" = $3, "deliveredAt" = $3
        WHERE "id" = $1
      `,
      [deliveryId, result.summary, nowIso()],
    );

    await recordActivity({
      type: "notification",
      severity: "info",
      title: `${monitor.name} notification sent`,
      message: `${channel.name} accepted the ${delivery.eventType} notification.`,
      monitorId: monitor.id,
      incidentId: incident.id,
      metadata: { channelId: channel.id, deliveryId },
    });
    return result;
  } catch (error) {
    const failureReason = error instanceof Error ? error.message : "Unknown notification failure.";
    await query(
      `
        UPDATE "notification_deliveries"
        SET "status" = 'failed', "attempts" = "attempts" + 1, "responseSummary" = $2, "updatedAt" = $3
        WHERE "id" = $1
      `,
      [deliveryId, failureReason, nowIso()],
    );
    await recordActivity({
      type: "notification",
      severity: "high",
      title: `${monitor.name} notification failed`,
      message: failureReason,
      monitorId: monitor.id,
      incidentId: incident.id,
      metadata: { channelId: channel.id, deliveryId },
    });
    await enqueueJob({
      type: "monitor.analysis",
      priority: 45,
      dedupeKey: `analysis:notification-failure:${incident.id}:${deliveryId}`,
      payload: { monitorId: monitor.id, incidentId: incident.id, source: "automatic", eventType: "notification-failed" },
    });
    throw error;
  }
};

const getDueMonitors = async () =>
  (await many(
    `
      SELECT *
      FROM "monitors"
      WHERE "paused" = FALSE
        AND ("nextCheckAt" IS NULL OR "nextCheckAt" <= $1)
      ORDER BY COALESCE("nextCheckAt", "createdAt") ASC
    `,
    [nowIso()],
  ))
    .map(normalizeMonitorRow)
    .filter(Boolean);

const enqueueDueMonitorJobs = async () => {
  const monitors = await getDueMonitors();

  if (monitors.length > 0) {
    await setMeta("lastSweepAt", nowIso());
  }

  for (const monitor of monitors) {
    await enqueueJob({
      type: "monitor.check",
      priority: statusPriority(monitor) * 10 + 10,
      dedupeKey: `check:${monitor.id}`,
      payload: { monitorId: monitor.id, reason: "scheduler" },
    });
  }
};

const performCheck = async (monitorId, reason = "manual") => {
  const existing = activeChecks.get(monitorId);
  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const monitor = await getMonitorRow(monitorId);
    if (!monitor) {
      throw new Error("Monitor not found.");
    }

    const check = await executeCheckWithRetries(monitor);
    const nextIncident = await syncIncidentState(monitor, check);
    check.incidentId = nextIncident?.id ?? null;
    await insertCheck(check);
    await upsertSearchDocument({
      sourceType: "check",
      sourceId: check.id,
      monitorId: monitor.id,
      incidentId: nextIncident?.id ?? null,
      occurredAt: check.checkedAt,
      title: `${monitor.name} ${check.status} check`,
      body: `${check.message}\n${check.responsePreview ?? ""}`,
      metadata: { classification: check.classification, statusCode: check.statusCode },
    });

    const nextMonitorState = buildNextMonitorState(monitor, check);
    nextMonitorState.lastIncidentId = nextIncident?.id ?? monitor.lastIncidentId ?? null;
    await upsertMonitorRow(nextMonitorState);

    await recordActivity({
      type: "check",
      severity: check.status === "down" ? "high" : check.status === "degraded" ? "medium" : "info",
      title: `${monitor.name} ${check.status === "up" ? "checked healthy" : check.status === "degraded" ? "is degraded" : "check failed"}`,
      message: check.message,
      monitorId: monitor.id,
      incidentId: nextIncident?.id ?? null,
      metadata: { reason, checkId: check.id },
    });

    if (nextIncident) {
      await query(`UPDATE "checks" SET "incidentId" = $2 WHERE "id" = $1`, [check.id, nextIncident.id]);
      await upsertSearchDocument({
        sourceType: "incident",
        sourceId: nextIncident.id,
        monitorId: monitor.id,
        incidentId: nextIncident.id,
        occurredAt: nextIncident.updatedAt,
        title: nextIncident.title,
        body: nextIncident.summary,
        metadata: { severity: nextIncident.severity, status: nextIncident.status },
      });
      await queueNotificationsForIncident({
        eventType: nextIncident.status === "resolved" ? "recovered" : nextIncident.timelineVersion <= 1 ? "opened" : "updated",
        incident: nextIncident,
        monitor: nextMonitorState,
      });
    }

    await pruneMonitorHistory(monitor.id);
    emitChange({ type: "check-completed", monitorId: monitor.id, reason });

    // Trigger analysis for healthy monitors if no analysis exists yet
    if (check.status === "up" && !nextIncident && !monitor.lastAnalysisId) {
      await enqueueJob({
        type: "monitor.analysis",
        priority: 100,
        dedupeKey: `analysis:healthy-first:${monitor.id}`,
        payload: { monitorId: monitor.id, incidentId: null, source: "automatic", eventType: "healthy" },
      });
    }

    return {
      monitor: await summarizeMonitor(await getMonitorRow(monitor.id)),
      check,
      incident: summarizeIncident(nextIncident),
    };
  })();

  activeChecks.set(monitorId, promise);
  promise.finally(() => {
    activeChecks.delete(monitorId);
  });

  return promise;
};

const pumpMonitorJobs = async () => {
  while (checkWorkersRunning < CHECK_WORKER_CONCURRENCY) {
    const job = await claimNextJob("monitor.check", 30_000);
    if (!job) {
      return;
    }

    checkWorkersRunning += 1;
    void performCheck(job.payload.monitorId, job.payload.reason ?? "scheduler")
      .then(() => completeJob(job.id))
      .catch((error) => failJob(job, error))
      .finally(() => {
        checkWorkersRunning -= 1;
        void pumpMonitorJobs();
      });
  }
};

const pumpAnalysisJobs = async () => {
  while (analysisWorkersRunning < ANALYSIS_WORKER_CONCURRENCY) {
    const job = await claimNextJob("monitor.analysis", 60_000);
    if (!job) {
      return;
    }

    analysisWorkersRunning += 1;
    void createAnalysisRow({
      monitorId: job.payload.monitorId,
      incidentId: job.payload.incidentId ?? null,
      source: job.payload.source ?? "automatic",
      eventType: job.payload.eventType ?? "updated",
    })
      .then(() => completeJob(job.id))
      .catch((error) => failJob(job, error))
      .finally(() => {
        analysisWorkersRunning -= 1;
        void pumpAnalysisJobs();
        emitChange({ type: "analysis-completed", monitorId: job.payload.monitorId });
      });
  }
};

const pumpNotificationJobs = async () => {
  while (notificationWorkersRunning < NOTIFICATION_WORKER_CONCURRENCY) {
    const job = await claimNextJob("notification.delivery", 60_000);
    if (!job) {
      return;
    }

    notificationWorkersRunning += 1;
    void processNotificationDelivery(job.payload.deliveryId)
      .then(() => completeJob(job.id))
      .catch((error) => failJob(job, error))
      .finally(() => {
        notificationWorkersRunning -= 1;
        void pumpNotificationJobs();
      });
  }
};

const summarizeMonitor = async (monitor) => {
  const [recentChecks, latestAnalysis, openIncident, uptime24h, uptime30d, avgLatencyMs, activeMaintenances] = await Promise.all([
    listChecksForMonitor(monitor.id, 80),
    getLatestAnalysisForMonitor(monitor.id),
    getOpenIncidentForMonitor(monitor.id),
    getUptimePercentage(monitor.id, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    getUptimePercentage(monitor.id, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    getAverageLatency(monitor.id, 40),
    getActiveMaintenances(monitor.id),
  ]);
  const latestCheck = recentChecks[0] ?? null;

  return {
    id: monitor.id,
    type: monitor.type,
    name: monitor.name,
    url: monitor.url,
    method: monitor.method,
    intervalSeconds: monitor.intervalSeconds,
    timeoutMs: monitor.timeoutMs,
    retries: monitor.retries,
    environment: monitor.environment,
    owner: monitor.owner,
    description: monitor.description,
    tags: monitor.tags,
    config: monitor.config,
    proxyConfig: monitor.proxyConfig,
    notificationPolicy: monitor.notificationPolicy,
    pushToken: monitor.pushToken,
    paused: monitor.paused,
    status: monitor.status,
    lastCheckedAt: monitor.lastCheckedAt,
    nextCheckAt: monitor.nextCheckAt,
    avgLatencyMs,
    lastLatencyMs: latestCheck?.latencyMs ?? 0,
    uptime24h,
    uptime30d,
    expectedStatusCodes: monitor.expectedStatusCodes,
    expectedBodyIncludes: monitor.expectedBodyIncludes,
    analysisState: monitor.analysisState,
    latestAnalysis: summarizeAnalysis(latestAnalysis),
    openIncident: summarizeIncident(openIncident),
    recentHeartbeats: recentChecks.slice(0, 36).reverse(),
    activeMaintenances: activeMaintenances.map((maintenance) => ({
      id: maintenance.id,
      name: maintenance.name,
      startsAt: maintenance.startsAt,
      endsAt: maintenance.endsAt,
    })),
    summary:
      latestAnalysis?.reportSummary ??
      openIncident?.summary ??
      latestCheck?.message ??
      (monitor.paused ? "Monitoring paused." : "Waiting for the first successful check."),
  };
};

const getDashboardSnapshot = async () => {
  await ensureSchema();
  const monitorRows = await listMonitorRows();
  const monitors = (await Promise.all(monitorRows.map((monitor) => summarizeMonitor(monitor)))).sort((left, right) => {
    const leftPriority = statusPriority(left);
    const rightPriority = statusPriority(right);

    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    return left.name.localeCompare(right.name);
  });

  const [incidents, activityFeed, lastSweepAt, queueState] = await Promise.all([
    many(`SELECT * FROM "incidents" ORDER BY "openedAt" DESC LIMIT 30`),
    listRecentActivity(20),
    getMeta("lastSweepAt"),
    getQueueState(),
  ]);

  return {
    generatedAt: nowIso(),
    summary: {
      total: monitors.length,
      up: monitors.filter((monitor) => monitor.status === "up").length,
      down: monitors.filter((monitor) => monitor.status === "down").length,
      degraded: monitors.filter((monitor) => monitor.status === "degraded").length,
      pending: monitors.filter((monitor) => monitor.status === "pending").length,
      paused: monitors.filter((monitor) => monitor.paused).length,
      openIncidents: incidents.filter((incident) => incident.status !== "resolved").length,
      avgUptime24h:
        monitors.length > 0
          ? Number((monitors.reduce((total, monitor) => total + monitor.uptime24h, 0) / monitors.length).toFixed(2))
          : 0,
      meanLatencyMs:
        monitors.length > 0 ? Math.round(monitors.reduce((total, monitor) => total + monitor.avgLatencyMs, 0) / monitors.length) : 0,
      lastSweepAt,
    },
    monitors,
    incidents: incidents.map((item) => summarizeIncident(normalizeIncident(item))),
    activityFeed,
    queue: queueState,
  };
};

const getMonitorDetail = async (monitorId) => {
  await ensureSchema();
  const monitor = await getMonitorRow(monitorId);
  if (!monitor) {
    return null;
  }

  const [monitorSummary, recentChecks, incidentHistory, recentEvents, analysisHistory, reports, latestCertificate, checksCount, incidentsCount, analysesCount, activityCount] =
    await Promise.all([
      summarizeMonitor(monitor),
      listChecksForMonitor(monitorId, 100),
      getIncidentHistoryForMonitor(monitorId),
      listActivityForMonitor(monitorId, 30),
      listAnalysesForMonitor(monitorId, 20),
      many(
        `
          SELECT r.*
          FROM "reports" r
          JOIN "incidents" i ON i."id" = r."incidentId"
          WHERE r."monitorId" = $1
          ORDER BY r."createdAt" DESC
          LIMIT 12
        `,
        [monitorId],
      ),
      one(`SELECT * FROM "certificates" WHERE "monitorId" = $1 ORDER BY "createdAt" DESC LIMIT 1`, [monitorId]),
      one(`SELECT COUNT(*)::int AS "count" FROM "checks" WHERE "monitorId" = $1`, [monitorId]),
      one(`SELECT COUNT(*)::int AS "count" FROM "incidents" WHERE "monitorId" = $1`, [monitorId]),
      one(`SELECT COUNT(*)::int AS "count" FROM "analyses" WHERE "monitorId" = $1`, [monitorId]),
      one(`SELECT COUNT(*)::int AS "count" FROM "activity_events" WHERE "monitorId" = $1`, [monitorId]),
    ]);

  return {
    generatedAt: nowIso(),
    monitor: monitorSummary,
    recentChecks,
    incidentHistory: incidentHistory.map(summarizeIncident),
    recentEvents,
    latestAnalysis: summarizeAnalysis(analysisHistory[0] ?? null),
    analysisHistory,
    reportHistory: reports.map(normalizeReport),
    latestCertificate: latestCertificate
      ? {
          id: latestCertificate.id,
          hostname: latestCertificate.hostname,
          subject: latestCertificate.subject,
          issuer: latestCertificate.issuer,
          validFrom: latestCertificate.validFrom,
          validTo: latestCertificate.validTo,
          daysRemaining: latestCertificate.daysRemaining,
          createdAt: latestCertificate.createdAt,
        }
      : null,
    historyTotals: {
      checks: Number(checksCount?.count ?? 0),
      incidents: Number(incidentsCount?.count ?? 0),
      analyses: Number(analysesCount?.count ?? 0),
      activityEvents: Number(activityCount?.count ?? 0),
    },
    config: {
      expectedStatusCodes: monitor.expectedStatusCodes,
      expectedBodyIncludes: monitor.expectedBodyIncludes,
      headerText: monitor.headerText,
      body: monitor.body,
      retries: monitor.retries,
      intervalSeconds: monitor.intervalSeconds,
      timeoutMs: monitor.timeoutMs,
      environment: monitor.environment,
      owner: monitor.owner,
      type: monitor.type,
      config: monitor.config,
      proxyConfig: monitor.proxyConfig,
      notificationPolicy: monitor.notificationPolicy,
      pushToken: monitor.pushToken,
    },
  };
};

const createMonitor = async (payload) => {
  await ensureSchema();
  const monitor = normalizeMonitorInput(payload);
  if (!monitor.name) {
    throw new Error("Monitor name is required.");
  }

  monitor.id = createId("mon");
  monitor.createdAt = nowIso();
  monitor.updatedAt = monitor.createdAt;
  monitor.nextCheckAt = nowIso();

  await upsertMonitorRow(monitor);
  await recordActivity({
    type: "monitor",
    severity: "info",
    title: "Monitor added",
    message: `${monitor.name} was added and queued for its first live check.`,
    monitorId: monitor.id,
  });
  emitChange({ type: "monitor-created", monitorId: monitor.id });

  queueMicrotask(() => {
    void performCheck(monitor.id, "created").catch(() => {
      // First check runs best effort after creation.
    });
  });

  return summarizeMonitor(monitor);
};

const updateMonitor = async (monitorId, payload) => {
  await ensureSchema();
  const current = await getMonitorRow(monitorId);
  if (!current) {
    return null;
  }

  const next = normalizeMonitorInput({ ...current, ...payload }, current);
  next.id = current.id;
  next.createdAt = current.createdAt;
  next.updatedAt = nowIso();
  next.status = current.status;
  next.lastCheckedAt = current.lastCheckedAt;
  next.nextCheckAt = payload.intervalSeconds ? nowIso() : current.nextCheckAt;
  next.failureStreak = current.failureStreak;
  next.unhealthyStreak = current.unhealthyStreak;
  next.analysisState = current.analysisState;
  next.lastAnalysisId = current.lastAnalysisId;
  next.lastIncidentId = current.lastIncidentId;
  next.lastErrorMessage = current.lastErrorMessage;

  await upsertMonitorRow(next);

  if (payload.paused != null) {
    await recordActivity({
      type: "monitor",
      severity: "info",
      title: `${current.name} ${payload.paused ? "paused" : "resumed"}`,
      message: payload.paused ? "Scheduled checks are paused for this monitor." : "Scheduled checks have resumed for this monitor.",
      monitorId,
    });
  }

  emitChange({ type: "monitor-updated", monitorId });
  return summarizeMonitor(await getMonitorRow(monitorId));
};

const deleteMonitor = async (monitorId) => {
  await ensureSchema();
  const monitor = await getMonitorRow(monitorId);
  if (!monitor) {
    return false;
  }

  await Promise.all([
    query(`DELETE FROM "monitors" WHERE "id" = $1`, [monitorId]),
    query(`DELETE FROM "checks" WHERE "monitorId" = $1`, [monitorId]),
    query(`DELETE FROM "analyses" WHERE "monitorId" = $1`, [monitorId]),
    query(`DELETE FROM "incidents" WHERE "monitorId" = $1`, [monitorId]),
    query(`DELETE FROM "activity_events" WHERE "monitorId" = $1`, [monitorId]),
    query(`DELETE FROM "reports" WHERE "monitorId" = $1`, [monitorId]),
    query(`DELETE FROM "ops_queries" WHERE "monitorId" = $1`, [monitorId]),
    query(`DELETE FROM "notification_deliveries" WHERE "monitorId" = $1`, [monitorId]),
    query(`DELETE FROM "search_documents" WHERE "monitorId" = $1`, [monitorId]),
  ]);

  emitChange({ type: "monitor-deleted", monitorId });
  return true;
};

const runMonitorCheck = async (monitorId, { reason = "manual" } = {}) => performCheck(monitorId, reason);

const requestMonitorAnalysis = async (monitorId, { source = "manual", wait = false, incidentId = null, eventType = "manual" } = {}) => {
  await ensureSchema();
  const monitor = await getMonitorRow(monitorId);
  if (!monitor) {
    throw new Error("Monitor not found.");
  }

  await query(`UPDATE "monitors" SET "analysisState" = 'queued', "updatedAt" = $2 WHERE "id" = $1`, [monitorId, nowIso()]);
  emitChange({ type: "analysis-queued", monitorId });

  if (wait) {
    return createAnalysisRow({ monitorId, incidentId, source, eventType });
  }

  await enqueueJob({
    type: "monitor.analysis",
    priority: 30,
    dedupeKey: `analysis:manual:${monitorId}:${incidentId ?? "none"}`,
    payload: { monitorId, incidentId, source, eventType },
  });

  return null;
};

const runSyntheticSweep = async () => {
  await ensureSchema();
  const sweepTime = nowIso();
  await setMeta("lastSweepAt", sweepTime);
  emitChange({ type: "sweep-started", sweepTime });

  const monitors = (await listMonitorRows()).filter((monitor) => !monitor.paused);
  await Promise.allSettled(monitors.map((monitor) => performCheck(monitor.id, "manual-sweep")));
  return getDashboardSnapshot();
};

const listIncidents = async () => {
  await ensureSchema();
  const rows = await many(`SELECT * FROM "incidents" ORDER BY "updatedAt" DESC`);
  return rows.map(normalizeIncident).filter(Boolean);
};

const getIncidentDetail = async (incidentId) => {
  await ensureSchema();
  const incident = await getIncidentRow(incidentId);
  if (!incident) {
    return null;
  }

  const [monitor, timeline, reports, analyses] = await Promise.all([
    getMonitorDetail(incident.monitorId),
    many(`SELECT * FROM "activity_events" WHERE "incidentId" = $1 ORDER BY "timestamp" ASC`, [incidentId]),
    listReportsForIncident(incidentId),
    many(`SELECT * FROM "analyses" WHERE "incidentId" = $1 ORDER BY "createdAt" DESC`, [incidentId]),
  ]);

  return {
    incident: summarizeIncident(incident),
    monitor: monitor?.monitor ?? null,
    timeline: timeline.map(normalizeActivity),
    reports,
    analyses: analyses.map(normalizeAnalysis),
  };
};

const listNotificationChannels = async () => {
  const rows = await fetchNotificationChannels();
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    isEnabled: Boolean(row.isEnabled),
    configPreview: row.configPreview ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastTestedAt: row.lastTestedAt ?? null,
    lastError: row.lastError ?? null,
  }));
};

const saveNotificationChannel = async (payload) => {
  const row = {
    id: payload.id ?? createId("chn"),
    name: text(payload.name).trim(),
    type: text(payload.type).trim().toLowerCase(),
    isEnabled: payload.isEnabled == null ? true : Boolean(payload.isEnabled),
    createdAt: payload.id ? payload.createdAt ?? nowIso() : nowIso(),
    updatedAt: nowIso(),
  };

  const serialized = serializeChannelConfig(payload.config ?? {});

  await query(
    `
      INSERT INTO "notification_channels" ("id", "name", "type", "isEnabled", "configEncrypted", "configPreview", "createdAt", "updatedAt", "lastTestedAt", "lastError")
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, NULL, NULL)
      ON CONFLICT ("id")
      DO UPDATE SET
        "name" = EXCLUDED."name",
        "type" = EXCLUDED."type",
        "isEnabled" = EXCLUDED."isEnabled",
        "configEncrypted" = EXCLUDED."configEncrypted",
        "configPreview" = EXCLUDED."configPreview",
        "updatedAt" = EXCLUDED."updatedAt"
    `,
    [row.id, row.name, row.type, row.isEnabled, serialized.configEncrypted, JSON.stringify(serialized.configPreview), row.createdAt, row.updatedAt],
  );

  emitChange({ type: "notification-channel-saved", channelId: row.id });
  return (await listNotificationChannels()).find((channel) => channel.id === row.id) ?? null;
};

const deleteNotificationChannel = async (channelId) => {
  await query(`DELETE FROM "notification_channels" WHERE "id" = $1`, [channelId]);
  await query(`DELETE FROM "notification_deliveries" WHERE "channelId" = $1`, [channelId]);
  emitChange({ type: "notification-channel-deleted", channelId });
};

const testNotificationChannel = async (channelId) => {
  const channel = await one(`SELECT * FROM "notification_channels" WHERE "id" = $1 LIMIT 1`, [channelId]);
  if (!channel) {
    throw new Error("Notification channel not found.");
  }

  const result = await deliverNotification({
    channel,
    payload: {
      eventType: "test",
      incident: { severity: "low", summary: "This is a test notification from Auto-Ops Sentinel." },
      monitor: { name: "Test Delivery", type: "system", status: "up", url: null, summary: "Notification test" },
      report: { summary: "Notification path is working.", version: 1 },
      dashboardUrl: DASHBOARD_URL,
    },
  });

  await query(`UPDATE "notification_channels" SET "lastTestedAt" = $2, "lastError" = NULL WHERE "id" = $1`, [channelId, nowIso()]);
  return result;
};

const listNotificationRules = async () => await many(`SELECT * FROM "notification_rules" ORDER BY "createdAt" DESC`);

const saveNotificationRule = async (payload) => {
  const row = {
    id: payload.id ?? createId("nrl"),
    name: text(payload.name).trim() || "Default Notification Rule",
    monitorIds: Array.isArray(payload.monitorIds) ? payload.monitorIds : [],
    tags: Array.isArray(payload.tags) ? payload.tags : [],
    eventTypes: Array.isArray(payload.eventTypes) ? payload.eventTypes : ["opened", "updated", "recovered"],
    severities: Array.isArray(payload.severities) ? payload.severities : [],
    channelIds: Array.isArray(payload.channelIds) ? payload.channelIds : [],
    isEnabled: payload.isEnabled == null ? true : Boolean(payload.isEnabled),
    createdAt: payload.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };

  await query(
    `
      INSERT INTO "notification_rules" ("id", "name", "monitorIds", "tags", "eventTypes", "severities", "channelIds", "isEnabled", "createdAt", "updatedAt")
      VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10)
      ON CONFLICT ("id")
      DO UPDATE SET
        "name" = EXCLUDED."name",
        "monitorIds" = EXCLUDED."monitorIds",
        "tags" = EXCLUDED."tags",
        "eventTypes" = EXCLUDED."eventTypes",
        "severities" = EXCLUDED."severities",
        "channelIds" = EXCLUDED."channelIds",
        "isEnabled" = EXCLUDED."isEnabled",
        "updatedAt" = EXCLUDED."updatedAt"
    `,
    [row.id, row.name, JSON.stringify(row.monitorIds), JSON.stringify(row.tags), JSON.stringify(row.eventTypes), JSON.stringify(row.severities), JSON.stringify(row.channelIds), row.isEnabled, row.createdAt, row.updatedAt],
  );

  emitChange({ type: "notification-rule-saved", ruleId: row.id });
  return row;
};

const deleteNotificationRule = async (ruleId) => {
  await query(`DELETE FROM "notification_rules" WHERE "id" = $1`, [ruleId]);
  emitChange({ type: "notification-rule-deleted", ruleId });
};

const listMaintenances = async () => await many(`SELECT * FROM "maintenances" ORDER BY "startsAt" DESC`);

const saveMaintenance = async (payload) => {
  const row = {
    id: payload.id ?? createId("mnt"),
    name: text(payload.name).trim() || "Maintenance",
    description: text(payload.description),
    monitorIds: Array.isArray(payload.monitorIds) ? payload.monitorIds : [],
    scheduleType: text(payload.scheduleType, "once"),
    startsAt: text(payload.startsAt, nowIso()),
    endsAt: text(payload.endsAt, new Date(Date.now() + 60 * 60 * 1000).toISOString()),
    timezone: text(payload.timezone, "UTC"),
    rrule: payload.rrule ? text(payload.rrule) : null,
    suppressNotifications: payload.suppressNotifications == null ? true : Boolean(payload.suppressNotifications),
    isActive: payload.isActive == null ? true : Boolean(payload.isActive),
    createdAt: payload.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };

  await query(
    `
      INSERT INTO "maintenances" ("id", "name", "description", "monitorIds", "scheduleType", "startsAt", "endsAt", "timezone", "rrule", "suppressNotifications", "isActive", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT ("id")
      DO UPDATE SET
        "name" = EXCLUDED."name",
        "description" = EXCLUDED."description",
        "monitorIds" = EXCLUDED."monitorIds",
        "scheduleType" = EXCLUDED."scheduleType",
        "startsAt" = EXCLUDED."startsAt",
        "endsAt" = EXCLUDED."endsAt",
        "timezone" = EXCLUDED."timezone",
        "rrule" = EXCLUDED."rrule",
        "suppressNotifications" = EXCLUDED."suppressNotifications",
        "isActive" = EXCLUDED."isActive",
        "updatedAt" = EXCLUDED."updatedAt"
    `,
    [row.id, row.name, row.description, JSON.stringify(row.monitorIds), row.scheduleType, row.startsAt, row.endsAt, row.timezone, row.rrule, row.suppressNotifications, row.isActive, row.createdAt, row.updatedAt],
  );

  emitChange({ type: "maintenance-saved", maintenanceId: row.id });
  return row;
};

const deleteMaintenance = async (maintenanceId) => {
  await query(`DELETE FROM "maintenances" WHERE "id" = $1`, [maintenanceId]);
  emitChange({ type: "maintenance-deleted", maintenanceId });
};

const normalizeStatusPage = (row) =>
  row
    ? {
        id: row.id,
        name: row.name,
        slug: row.slug,
        headline: row.headline,
        description: row.description,
        isPublic: Boolean(row.isPublic),
        customDomain: row.customDomain ?? null,
        showHistory: Boolean(row.showHistory),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }
    : null;

const listStatusPages = async () => {
  const pages = await many(`SELECT * FROM "status_pages" ORDER BY "createdAt" DESC`);
  return Promise.all(
    pages.map(async (page) => {
      const links = await many(`SELECT "monitorId" FROM "status_page_monitors" WHERE "statusPageId" = $1 ORDER BY "position" ASC`, [page.id]);
      return {
        ...normalizeStatusPage(page),
        monitorIds: links.map((item) => item.monitorId),
      };
    }),
  );
};

const saveStatusPage = async (payload) => {
  const row = {
    id: payload.id ?? createId("stp"),
    name: text(payload.name).trim() || "Status Page",
    slug: text(payload.slug).trim().toLowerCase() || `status-${Math.random().toString(16).slice(2, 6)}`,
    headline: text(payload.headline),
    description: text(payload.description),
    isPublic: payload.isPublic == null ? true : Boolean(payload.isPublic),
    customDomain: payload.customDomain ? text(payload.customDomain).trim() : null,
    showHistory: payload.showHistory == null ? true : Boolean(payload.showHistory),
    createdAt: payload.createdAt ?? nowIso(),
    updatedAt: nowIso(),
  };

  await query(
    `
      INSERT INTO "status_pages" ("id", "name", "slug", "headline", "description", "isPublic", "customDomain", "showHistory", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT ("id")
      DO UPDATE SET
        "name" = EXCLUDED."name",
        "slug" = EXCLUDED."slug",
        "headline" = EXCLUDED."headline",
        "description" = EXCLUDED."description",
        "isPublic" = EXCLUDED."isPublic",
        "customDomain" = EXCLUDED."customDomain",
        "showHistory" = EXCLUDED."showHistory",
        "updatedAt" = EXCLUDED."updatedAt"
    `,
    [row.id, row.name, row.slug, row.headline, row.description, row.isPublic, row.customDomain, row.showHistory, row.createdAt, row.updatedAt],
  );

  if (Array.isArray(payload.monitorIds)) {
    await query(`DELETE FROM "status_page_monitors" WHERE "statusPageId" = $1`, [row.id]);
    for (const [position, monitorId] of payload.monitorIds.entries()) {
      await query(`INSERT INTO "status_page_monitors" ("statusPageId", "monitorId", "position") VALUES ($1, $2, $3)`, [row.id, monitorId, position]);
    }
  }

  emitChange({ type: "status-page-saved", statusPageId: row.id });
  return (await listStatusPages()).find((page) => page.id === row.id) ?? null;
};

const deleteStatusPage = async (statusPageId) => {
  await Promise.all([
    query(`DELETE FROM "status_page_monitors" WHERE "statusPageId" = $1`, [statusPageId]),
    query(`DELETE FROM "status_pages" WHERE "id" = $1`, [statusPageId]),
  ]);
  emitChange({ type: "status-page-deleted", statusPageId });
};

const getPublicStatusPage = async (slug, hostHeader = null) => {
  const page = normalizeStatusPage(
    await one(
      `
        SELECT *
        FROM "status_pages"
        WHERE "isPublic" = TRUE
          AND ("slug" = $1 OR ("customDomain" IS NOT NULL AND "customDomain" = $2))
        LIMIT 1
      `,
      [slug, hostHeader],
    ),
  );

  if (!page) {
    return null;
  }

  const monitorLinks = await many(
    `
      SELECT m.*
      FROM "status_page_monitors" spm
      JOIN "monitors" m ON m."id" = spm."monitorId"
      WHERE spm."statusPageId" = $1
      ORDER BY spm."position" ASC
    `,
    [page.id],
  );

  const monitors = await Promise.all(monitorLinks.map((row) => summarizeMonitor(normalizeMonitorRow(row))));
  const incidents = await many(
    `
      SELECT i.*
      FROM "incidents" i
      WHERE i."monitorId" = ANY($1::text[])
      ORDER BY i."updatedAt" DESC
      LIMIT 20
    `,
    [monitors.map((monitor) => monitor.id)],
  );
  const maintenances = await getActiveMaintenances(null);

  return {
    page,
    summary: {
      total: monitors.length,
      up: monitors.filter((monitor) => monitor.status === "up").length,
      down: monitors.filter((monitor) => monitor.status === "down").length,
      degraded: monitors.filter((monitor) => monitor.status === "degraded").length,
      openIncidents: incidents.filter((incident) => incident.status !== "resolved").length,
    },
    monitors,
    incidents: incidents.map((incident) => summarizeIncident(normalizeIncident(incident))),
    maintenances: maintenances.map((maintenance) => ({
      id: maintenance.id,
      name: maintenance.name,
      startsAt: maintenance.startsAt,
      endsAt: maintenance.endsAt,
      scheduleType: maintenance.scheduleType,
    })),
  };
};

const extractTimeWindow = (question) => {
  const isoMatch = String(question).match(/\b(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z?)?)\b/);
  if (isoMatch) {
    const exact = new Date(isoMatch[1]);
    if (!Number.isNaN(exact.getTime())) {
      return {
        start: new Date(exact.getTime() - 5 * 60 * 1000).toISOString(),
        end: new Date(exact.getTime() + 5 * 60 * 1000).toISOString(),
      };
    }
  }

  const timeMatch = String(question).match(/\b(\d{1,2}):(\d{2})(?:\s*([AaPp][Mm]))?\b/);
  if (!timeMatch) {
    return null;
  }

  let hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const meridiem = timeMatch[3]?.toLowerCase();
  if (meridiem === "pm" && hours < 12) {
    hours += 12;
  }
  if (meridiem === "am" && hours === 12) {
    hours = 0;
  }

  const base = new Date();
  base.setHours(hours, minutes, 0, 0);
  return {
    start: new Date(base.getTime() - 5 * 60 * 1000).toISOString(),
    end: new Date(base.getTime() + 5 * 60 * 1000).toISOString(),
  };
};

const searchHistoricalEvidence = async (question, { monitorId = null, incidentId = null, limit = 8 } = {}) => {
  const timeWindow = extractTimeWindow(question);
  const results = [];

  if (timeWindow) {
    const rows = await many(
      `
        SELECT *
        FROM "search_documents"
        WHERE "occurredAt" BETWEEN $1 AND $2
          AND ($3::text IS NULL OR "monitorId" = $3)
          AND ($4::text IS NULL OR "incidentId" = $4)
        ORDER BY "occurredAt" ASC
        LIMIT $5
      `,
      [timeWindow.start, timeWindow.end, monitorId, incidentId, limit],
    );

    for (const row of rows) {
      results.push({
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        monitorId: row.monitorId,
        incidentId: row.incidentId,
        occurredAt: row.occurredAt,
        title: row.title,
        snippet: text(row.body).slice(0, 220),
        metadata: safeObject(row.metadata),
        score: 1,
      });
    }
  }

  const queryText = text(question).trim();
  if (queryText) {
    try {
      const semanticRows = await many(
        `
          SELECT
            *,
            ts_rank_cd(
              to_tsvector('simple', COALESCE("title", '') || ' ' || COALESCE("body", '')),
              websearch_to_tsquery('simple', $1)
            ) AS "rank"
          FROM "search_documents"
          WHERE to_tsvector('simple', COALESCE("title", '') || ' ' || COALESCE("body", '')) @@ websearch_to_tsquery('simple', $1)
            AND ($2::text IS NULL OR "monitorId" = $2)
            AND ($3::text IS NULL OR "incidentId" = $3)
          ORDER BY "rank" DESC, "occurredAt" DESC
          LIMIT $4
        `,
        [queryText, monitorId, incidentId, limit],
      );

      for (const row of semanticRows) {
        if (!results.some((existing) => existing.sourceType === row.sourceType && existing.sourceId === row.sourceId)) {
          results.push({
            sourceType: row.sourceType,
            sourceId: row.sourceId,
            monitorId: row.monitorId,
            incidentId: row.incidentId,
            occurredAt: row.occurredAt,
            title: row.title,
            snippet: text(row.body).slice(0, 220),
            metadata: safeObject(row.metadata),
            score: Number(row.rank ?? 0),
          });
        }
      }
    } catch {
      // Keep time-window results if full-text search is unavailable for this query.
    }
  }

  return results.slice(0, limit);
};

const answerQuestionAcrossHistory = async ({ question, monitorId = null, incidentId = null }) => {
  const [dashboardSnapshot, monitorContext, incidentContext, retrievalMatches] = await Promise.all([
    getDashboardSnapshot(),
    monitorId ? getMonitorDetail(monitorId) : Promise.resolve(null),
    incidentId ? getIncidentDetail(incidentId) : Promise.resolve(null),
    searchHistoricalEvidence(question, { monitorId, incidentId, limit: 8 }),
  ]);
  const timeWindow = extractTimeWindow(question);
  const answer = await answerOpsQuestion({
    question,
    dashboardSnapshot,
    monitorContext,
    incidentContext,
    retrievalMatches,
    timeWindow,
  });

  const queryId = createId("qry");
  await query(
    `
      INSERT INTO "ops_queries" ("id", "monitorId", "incidentId", "createdAt", "question", "answer", "mode", "model", "citations", "retrievalMatches", "timeWindowStart", "timeWindowEnd", "prompt", "rawResponse", "failureReason", "slmConfig")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15, $16::jsonb)
    `,
    [
      queryId,
      monitorId,
      incidentId,
      nowIso(),
      question,
      answer.answer,
      answer.mode,
      answer.model,
      JSON.stringify(answer.citations ?? []),
      JSON.stringify(answer.retrievalMatches ?? []),
      answer.timeWindow?.start ?? null,
      answer.timeWindow?.end ?? null,
      answer.prompt ?? null,
      answer.rawResponse ?? null,
      answer.failureReason ?? null,
      JSON.stringify(answer.slmConfig ?? {}),
    ],
  );

  await upsertSearchDocument({
    sourceType: "ops-query",
    sourceId: queryId,
    monitorId,
    incidentId,
    occurredAt: nowIso(),
    title: `Ops question: ${question.slice(0, 80)}`,
    body: `${question}\n${answer.answer}`,
    metadata: { citations: answer.citations },
  });

  return { ...answer, id: queryId };
};

const listOpsQueryHistory = async ({ monitorId = null, incidentId = null, limit = 20 } = {}) =>
  await many(
    `
      SELECT *
      FROM "ops_queries"
      WHERE ($1::text IS NULL OR "monitorId" = $1)
        AND ($2::text IS NULL OR "incidentId" = $2)
      ORDER BY "createdAt" DESC
      LIMIT $3
    `,
    [monitorId, incidentId, limit],
  );

const recordPushHeartbeat = async (token, payload = {}) => {
  const monitor = normalizeMonitorRow(await one(`SELECT * FROM "monitors" WHERE "pushToken" = $1 LIMIT 1`, [token]));
  if (!monitor) {
    return null;
  }

  const check = normalizeCheck({
    id: createId("chk"),
    monitorId: monitor.id,
    monitorType: monitor.type,
    incidentId: null,
    startedAt: nowIso(),
    checkedAt: nowIso(),
    status: "up",
    latencyMs: 0,
    statusCode: null,
    classification: "push_heartbeat",
    message: "Push heartbeat accepted.",
    responsePreview: payload.message ? text(payload.message).slice(0, 400) : null,
    responseBody: coerceJsonStringValue(payload) ?? null,
    responseHeaders: {},
    evidence: payload,
    rawResult: payload,
  });

  await insertCheck(check);
  await upsertSearchDocument({
    sourceType: "check",
    sourceId: check.id,
    monitorId: monitor.id,
    incidentId: null,
    occurredAt: check.checkedAt,
    title: `${monitor.name} push heartbeat`,
    body: check.responseBody ?? check.message,
    metadata: payload,
  });

  const nextMonitorState = buildNextMonitorState(monitor, check);
  await upsertMonitorRow(nextMonitorState);

  await recordActivity({
    type: "push",
    severity: "info",
    title: `${monitor.name} push heartbeat received`,
    message: check.responsePreview ?? check.message,
    monitorId: monitor.id,
    metadata: payload,
  });

  emitChange({ type: "push-heartbeat", monitorId: monitor.id });
  return { ok: true, monitorId: monitor.id, checkedAt: check.checkedAt };
};

const renderPrometheusMetrics = async () => {
  const dashboard = await getDashboardSnapshot();
  const lines = [
    "# HELP sentinel_monitors_total Total monitors configured.",
    "# TYPE sentinel_monitors_total gauge",
    `sentinel_monitors_total ${dashboard.summary.total}`,
    "# HELP sentinel_incidents_open Current open incidents.",
    "# TYPE sentinel_incidents_open gauge",
    `sentinel_incidents_open ${dashboard.summary.openIncidents}`,
  ];

  for (const monitor of dashboard.monitors) {
    const labels = `monitor_id="${monitor.id}",monitor_name="${monitor.name.replace(/"/g, '\\"')}",monitor_type="${monitor.type}"`;
    const statusValue = monitor.status === "up" ? 1 : monitor.status === "degraded" ? 0.5 : monitor.status === "down" ? 0 : -1;
    lines.push(`# TYPE sentinel_monitor_status gauge`);
    lines.push(`sentinel_monitor_status{${labels}} ${statusValue}`);
    lines.push(`# TYPE sentinel_monitor_latency_ms gauge`);
    lines.push(`sentinel_monitor_latency_ms{${labels}} ${monitor.lastLatencyMs}`);
    lines.push(`# TYPE sentinel_monitor_uptime_24h gauge`);
    lines.push(`sentinel_monitor_uptime_24h{${labels}} ${monitor.uptime24h}`);
  }

  return `${lines.join("\n")}\n`;
};

const renderMonitorBadge = async (monitorId, kind = "status") => {
  const monitorRow = await getMonitorRow(monitorId);
  if (!monitorRow) {
    return null;
  }

  const monitor = await summarizeMonitor(monitorRow);
  const label = kind === "uptime" ? "uptime" : kind === "latency" ? "latency" : "status";
  const value = kind === "uptime" ? `${monitor.uptime24h.toFixed(2)}%` : kind === "latency" ? `${monitor.lastLatencyMs}ms` : monitor.status.toUpperCase();
  const color = monitor.status === "up" ? "#34d399" : monitor.status === "degraded" ? "#fbbf24" : "#f87171";
  return `
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="20" role="img" aria-label="${label}: ${value}">
  <rect width="90" height="20" fill="#111827"/>
  <rect x="90" width="150" height="20" fill="${color}"/>
  <text x="45" y="14" fill="#e5e7eb" font-family="IBM Plex Sans, sans-serif" font-size="11" text-anchor="middle">${label}</text>
  <text x="165" y="14" fill="#04110c" font-family="IBM Plex Sans, sans-serif" font-size="11" text-anchor="middle">${value}</text>
</svg>`.trim();
};

const startMonitoringEngine = () => {
  if (runtimeStarted) {
    return;
  }

  runtimeStarted = true;
  void ensureSchema().catch((error) => {
    console.error("Auto-Ops Sentinel schema bootstrap failed:", error);
  });

  const scheduler = setInterval(() => {
    void enqueueDueMonitorJobs().catch((error) => {
      console.error("Due monitor enqueue failed:", error);
    });
    void pumpMonitorJobs().catch((error) => {
      console.error("Monitor job pump failed:", error);
    });
    void pumpAnalysisJobs().catch((error) => {
      console.error("Analysis job pump failed:", error);
    });
    void pumpNotificationJobs().catch((error) => {
      console.error("Notification job pump failed:", error);
    });
  }, ENGINE_INTERVAL_MS);

  workerTimers.push(scheduler);

  void enqueueDueMonitorJobs().catch((error) => console.error("Initial enqueue failed:", error));
  void pumpMonitorJobs().catch((error) => console.error("Initial monitor worker failed:", error));
  void pumpAnalysisJobs().catch((error) => console.error("Initial analysis worker failed:", error));
  void pumpNotificationJobs().catch((error) => console.error("Initial notification worker failed:", error));
};

const getIncidentCenterSnapshot = async () => {
  const incidents = await listIncidents();
  const detail = incidents[0] ? await getIncidentDetail(incidents[0].id) : null;
  return {
    incidents: incidents.map(summarizeIncident),
    selectedIncident: detail,
  };
};

const getOperationsSnapshot = async () => ({
  notifications: {
    channels: await listNotificationChannels(),
    rules: await listNotificationRules(),
    deliveries: await many(`SELECT * FROM "notification_deliveries" ORDER BY "createdAt" DESC LIMIT 30`),
  },
  maintenances: await listMaintenances(),
  statusPages: await listStatusPages(),
});

export {
  answerQuestionAcrossHistory as answerOpsQuestionWithHistory,
  createMonitor,
  deleteMaintenance,
  deleteMonitor,
  deleteNotificationChannel,
  deleteNotificationRule,
  deleteStatusPage,
  getDashboardSnapshot,
  getIncidentCenterSnapshot,
  getIncidentDetail,
  getMonitorDetail,
  getOperationsSnapshot,
  getPublicStatusPage,
  getQueueState,
  listIncidents,
  listMaintenances,
  listNotificationChannels,
  listNotificationRules,
  listOpsQueryHistory,
  listReportsForIncident,
  listStatusPages,
  recordPushHeartbeat,
  renderMonitorBadge,
  renderPrometheusMetrics,
  requestMonitorAnalysis,
  runMonitorCheck,
  runSyntheticSweep,
  saveMaintenance,
  saveNotificationChannel,
  saveNotificationRule,
  saveStatusPage,
  startMonitoringEngine,
  subscribe,
  testNotificationChannel,
  updateMonitor,
};
