import { decryptSecret, encryptSecret, nowIso } from "./security.mjs";

const DATABASE_URL = String(process.env.DATABASE_URL ?? "").trim();
const DEFAULT_SLM_BASE_URL = process.env.SLM_BASE_URL ?? "http://127.0.0.1:11434";
const DEFAULT_SLM_MODEL = process.env.SLM_MODEL ?? "llama3.2:3b";
const DEFAULT_SLM_PROVIDER = process.env.SLM_PROVIDER ?? "ollama";
const DEFAULT_SLM_TIMEOUT_MS = Number(process.env.SLM_TIMEOUT_MS ?? 20_000);

let driverPromise = null;
let poolPromise = null;
let schemaPromise = null;

const DEFAULT_SLM_FEATURE_FLAGS = {
  autoAnalyzeIncidents: true,
  autoAnalyzeRecoveries: true,
  autoAnalyzeNotificationFailures: true,
  storePrompts: true,
  storeRawResponses: true,
  includeRetrievalCitations: true,
};

const normalizeBaseUrl = (value) => String(value ?? DEFAULT_SLM_BASE_URL).trim().replace(/\/+$/, "") || DEFAULT_SLM_BASE_URL;
const normalizeModel = (value) => String(value ?? DEFAULT_SLM_MODEL).trim() || DEFAULT_SLM_MODEL;
const normalizeProvider = (value) => String(value ?? DEFAULT_SLM_PROVIDER).trim() || DEFAULT_SLM_PROVIDER;

const sanitizeTimeout = (value) => {
  const timeoutMs = Number(value);
  return Number.isFinite(timeoutMs) ? Math.max(1_000, Math.min(120_000, Math.round(timeoutMs))) : DEFAULT_SLM_TIMEOUT_MS;
};

const getConfiguredDatabaseName = () => "embedded";

const loadPgDriver = async () => {
  if (!driverPromise) {
    driverPromise = import("@electric-sql/pglite").catch((error) => {
      driverPromise = null;
      throw new Error(
        `PGlite driver is not installed. Run "npm install @electric-sql/pglite" and restart the server. ${error instanceof Error ? error.message : ""
          }`.trim(),
      );
    });
  }

  return driverPromise;
};

export const getPool = async () => {
  if (!poolPromise) {
    poolPromise = (async () => {
      const { PGlite } = await loadPgDriver();
      const db = new PGlite("./sentinel-db");

      await db.waitReady;
      await db.query("SELECT 1");
      return db;
    })().catch((error) => {
      poolPromise = null;
      throw error;
    });
  }

  return poolPromise;
};

export const query = async (text, values = [], client = null) => {
  const executor = client ?? (await getPool());
  return executor.query(text, values);
};

export const many = async (text, values = [], client = null) => (await query(text, values, client)).rows;

export const one = async (text, values = [], client = null) => (await query(text, values, client)).rows[0] ?? null;

export const withTransaction = async (callback) => {
  const db = await getPool();
  return db.transaction(async (tx) => {
    return callback(tx);
  });
};

export const ensureSchema = async () => {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const db = await getPool();
      await db.exec(`
        CREATE TABLE IF NOT EXISTS "meta" (
          "key" TEXT PRIMARY KEY,
          "value" TEXT,
          "updatedAt" TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS "settings" (
          "key" TEXT PRIMARY KEY,
          "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "baseUrl" TEXT,
          "model" TEXT,
          "timeoutMs" INTEGER,
          "updatedAt" TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS "users" (
          "id" TEXT PRIMARY KEY,
          "email" TEXT NOT NULL UNIQUE,
          "name" TEXT NOT NULL,
          "role" TEXT NOT NULL DEFAULT 'admin',
          "passwordHash" TEXT,
          "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
          "totpSecretEncrypted" TEXT,
          "totpEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
          "passwordResetTokenHash" TEXT,
          "passwordResetExpiresAt" TEXT,
          "createdAt" TEXT NOT NULL,
          "updatedAt" TEXT NOT NULL,
          "lastLoginAt" TEXT
        );

        CREATE TABLE IF NOT EXISTS "sessions" (
          "id" TEXT PRIMARY KEY,
          "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
          "tokenHash" TEXT NOT NULL UNIQUE,
          "createdAt" TEXT NOT NULL,
          "expiresAt" TEXT NOT NULL,
          "lastSeenAt" TEXT NOT NULL,
          "userAgent" TEXT,
          "ipAddress" TEXT
        );

        CREATE TABLE IF NOT EXISTS "api_keys" (
          "id" TEXT PRIMARY KEY,
          "label" TEXT NOT NULL,
          "scope" TEXT NOT NULL,
          "keyHash" TEXT NOT NULL UNIQUE,
          "createdAt" TEXT NOT NULL,
          "lastUsedAt" TEXT,
          "revokedAt" TEXT,
          "createdByUserId" TEXT REFERENCES "users"("id") ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS "monitors" (
          "id" TEXT PRIMARY KEY,
          "type" TEXT NOT NULL DEFAULT 'http',
          "name" TEXT NOT NULL,
          "url" TEXT,
          "method" TEXT NOT NULL DEFAULT 'GET',
          "intervalSeconds" INTEGER NOT NULL DEFAULT 60,
          "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
          "retries" INTEGER NOT NULL DEFAULT 0,
          "environment" TEXT NOT NULL DEFAULT 'production',
          "owner" TEXT NOT NULL DEFAULT 'platform',
          "description" TEXT NOT NULL DEFAULT '',
          "tags" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "config" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "proxyConfig" JSONB,
          "notificationPolicy" JSONB,
          "pushToken" TEXT UNIQUE,
          "expectedStatusCodes" TEXT NOT NULL DEFAULT '200-299',
          "expectedBodyIncludes" TEXT NOT NULL DEFAULT '',
          "headerText" TEXT NOT NULL DEFAULT '',
          "body" TEXT NOT NULL DEFAULT '',
          "paused" BOOLEAN NOT NULL DEFAULT FALSE,
          "status" TEXT NOT NULL DEFAULT 'pending',
          "lastCheckedAt" TEXT,
          "nextCheckAt" TEXT,
          "createdAt" TEXT NOT NULL,
          "updatedAt" TEXT NOT NULL,
          "failureStreak" INTEGER NOT NULL DEFAULT 0,
          "unhealthyStreak" INTEGER NOT NULL DEFAULT 0,
          "analysisState" TEXT NOT NULL DEFAULT 'idle',
          "lastAnalysisId" TEXT,
          "lastIncidentId" TEXT,
          "lastErrorMessage" TEXT
        );

        CREATE TABLE IF NOT EXISTS "checks" (
          "id" TEXT PRIMARY KEY,
          "monitorId" TEXT NOT NULL REFERENCES "monitors"("id") ON DELETE CASCADE,
          "monitorType" TEXT NOT NULL DEFAULT 'http',
          "incidentId" TEXT,
          "startedAt" TEXT NOT NULL,
          "checkedAt" TEXT NOT NULL,
          "status" TEXT NOT NULL,
          "latencyMs" INTEGER NOT NULL DEFAULT 0,
          "statusCode" INTEGER,
          "classification" TEXT NOT NULL,
          "message" TEXT NOT NULL,
          "responsePreview" TEXT,
          "responseBody" TEXT,
          "responseHeaders" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "evidence" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "rawResult" JSONB NOT NULL DEFAULT '{}'::jsonb
        );

        CREATE TABLE IF NOT EXISTS "incidents" (
          "id" TEXT PRIMARY KEY,
          "monitorId" TEXT NOT NULL REFERENCES "monitors"("id") ON DELETE CASCADE,
          "title" TEXT NOT NULL,
          "status" TEXT NOT NULL,
          "severity" TEXT NOT NULL,
          "summary" TEXT NOT NULL,
          "classification" TEXT NOT NULL,
          "openedAt" TEXT NOT NULL,
          "updatedAt" TEXT NOT NULL,
          "resolvedAt" TEXT,
          "latestCheckId" TEXT,
          "latestAnalysisId" TEXT,
          "timelineVersion" INTEGER NOT NULL DEFAULT 1,
          "lastReportedAt" TEXT
        );

        CREATE TABLE IF NOT EXISTS "analyses" (
          "id" TEXT PRIMARY KEY,
          "kind" TEXT NOT NULL DEFAULT 'monitor-analysis',
          "provider" TEXT NOT NULL DEFAULT 'fallback',
          "monitorId" TEXT REFERENCES "monitors"("id") ON DELETE CASCADE,
          "incidentId" TEXT REFERENCES "incidents"("id") ON DELETE SET NULL,
          "createdAt" TEXT NOT NULL,
          "source" TEXT NOT NULL,
          "mode" TEXT NOT NULL,
          "model" TEXT NOT NULL,
          "status" TEXT NOT NULL,
          "facts" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "probableRootCause" TEXT NOT NULL,
          "confidence" DOUBLE PRECISION NOT NULL,
          "blastRadius" TEXT NOT NULL,
          "recommendedChecks" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "suggestedFixes" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "reportSummary" TEXT NOT NULL,
          "evidence" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "prompt" TEXT,
          "rawResponse" TEXT,
          "parsedResponse" JSONB,
          "failureReason" TEXT,
          "slmConfig" JSONB,
          "contextSnapshot" JSONB,
          "citations" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "retrievalMatches" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "timeWindowStart" TEXT,
          "timeWindowEnd" TEXT
        );

        CREATE TABLE IF NOT EXISTS "reports" (
          "id" TEXT PRIMARY KEY,
          "incidentId" TEXT NOT NULL REFERENCES "incidents"("id") ON DELETE CASCADE,
          "monitorId" TEXT NOT NULL REFERENCES "monitors"("id") ON DELETE CASCADE,
          "analysisId" TEXT REFERENCES "analyses"("id") ON DELETE SET NULL,
          "version" INTEGER NOT NULL,
          "title" TEXT NOT NULL,
          "summary" TEXT NOT NULL,
          "markdown" TEXT NOT NULL,
          "jsonPayload" JSONB NOT NULL,
          "fileBasePath" TEXT,
          "createdAt" TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS "activity_events" (
          "id" TEXT PRIMARY KEY,
          "timestamp" TEXT NOT NULL,
          "type" TEXT NOT NULL,
          "severity" TEXT NOT NULL,
          "title" TEXT NOT NULL,
          "message" TEXT NOT NULL,
          "monitorId" TEXT REFERENCES "monitors"("id") ON DELETE CASCADE,
          "incidentId" TEXT REFERENCES "incidents"("id") ON DELETE SET NULL,
          "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb
        );

        CREATE TABLE IF NOT EXISTS "ops_queries" (
          "id" TEXT PRIMARY KEY,
          "monitorId" TEXT REFERENCES "monitors"("id") ON DELETE SET NULL,
          "incidentId" TEXT REFERENCES "incidents"("id") ON DELETE SET NULL,
          "createdAt" TEXT NOT NULL,
          "question" TEXT NOT NULL,
          "answer" TEXT NOT NULL,
          "mode" TEXT NOT NULL,
          "model" TEXT NOT NULL,
          "citations" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "retrievalMatches" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "timeWindowStart" TEXT,
          "timeWindowEnd" TEXT,
          "prompt" TEXT,
          "rawResponse" TEXT,
          "failureReason" TEXT,
          "slmConfig" JSONB
        );

        CREATE TABLE IF NOT EXISTS "jobs" (
          "id" TEXT PRIMARY KEY,
          "type" TEXT NOT NULL,
          "status" TEXT NOT NULL,
          "priority" INTEGER NOT NULL DEFAULT 100,
          "runAt" TEXT NOT NULL,
          "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "dedupeKey" TEXT,
          "attempts" INTEGER NOT NULL DEFAULT 0,
          "maxAttempts" INTEGER NOT NULL DEFAULT 6,
          "workerId" TEXT,
          "leaseExpiresAt" TEXT,
          "lastError" TEXT,
          "createdAt" TEXT NOT NULL,
          "updatedAt" TEXT NOT NULL,
          "completedAt" TEXT
        );

        CREATE TABLE IF NOT EXISTS "maintenances" (
          "id" TEXT PRIMARY KEY,
          "name" TEXT NOT NULL,
          "description" TEXT NOT NULL DEFAULT '',
          "monitorIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "scheduleType" TEXT NOT NULL DEFAULT 'once',
          "startsAt" TEXT NOT NULL,
          "endsAt" TEXT NOT NULL,
          "timezone" TEXT NOT NULL DEFAULT 'UTC',
          "rrule" TEXT,
          "suppressNotifications" BOOLEAN NOT NULL DEFAULT TRUE,
          "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
          "createdAt" TEXT NOT NULL,
          "updatedAt" TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS "status_pages" (
          "id" TEXT PRIMARY KEY,
          "name" TEXT NOT NULL,
          "slug" TEXT NOT NULL UNIQUE,
          "headline" TEXT NOT NULL DEFAULT '',
          "description" TEXT NOT NULL DEFAULT '',
          "isPublic" BOOLEAN NOT NULL DEFAULT TRUE,
          "customDomain" TEXT,
          "showHistory" BOOLEAN NOT NULL DEFAULT TRUE,
          "createdAt" TEXT NOT NULL,
          "updatedAt" TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS "status_page_monitors" (
          "statusPageId" TEXT NOT NULL REFERENCES "status_pages"("id") ON DELETE CASCADE,
          "monitorId" TEXT NOT NULL REFERENCES "monitors"("id") ON DELETE CASCADE,
          "position" INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY ("statusPageId", "monitorId")
        );

        CREATE TABLE IF NOT EXISTS "notification_channels" (
          "id" TEXT PRIMARY KEY,
          "name" TEXT NOT NULL,
          "type" TEXT NOT NULL,
          "isEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
          "configEncrypted" TEXT,
          "configPreview" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "createdAt" TEXT NOT NULL,
          "updatedAt" TEXT NOT NULL,
          "lastTestedAt" TEXT,
          "lastError" TEXT
        );

        CREATE TABLE IF NOT EXISTS "notification_rules" (
          "id" TEXT PRIMARY KEY,
          "name" TEXT NOT NULL,
          "monitorIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "tags" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "eventTypes" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "severities" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "channelIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
          "isEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
          "createdAt" TEXT NOT NULL,
          "updatedAt" TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS "notification_deliveries" (
          "id" TEXT PRIMARY KEY,
          "channelId" TEXT NOT NULL REFERENCES "notification_channels"("id") ON DELETE CASCADE,
          "ruleId" TEXT REFERENCES "notification_rules"("id") ON DELETE SET NULL,
          "monitorId" TEXT REFERENCES "monitors"("id") ON DELETE SET NULL,
          "incidentId" TEXT REFERENCES "incidents"("id") ON DELETE SET NULL,
          "eventType" TEXT NOT NULL,
          "status" TEXT NOT NULL,
          "attempts" INTEGER NOT NULL DEFAULT 0,
          "responseSummary" TEXT,
          "payloadSnapshot" JSONB NOT NULL DEFAULT '{}'::jsonb,
          "createdAt" TEXT NOT NULL,
          "updatedAt" TEXT NOT NULL,
          "deliveredAt" TEXT
        );

        CREATE TABLE IF NOT EXISTS "certificates" (
          "id" TEXT PRIMARY KEY,
          "monitorId" TEXT NOT NULL REFERENCES "monitors"("id") ON DELETE CASCADE,
          "hostname" TEXT NOT NULL,
          "subject" TEXT,
          "issuer" TEXT,
          "validFrom" TEXT,
          "validTo" TEXT,
          "daysRemaining" INTEGER,
          "createdAt" TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS "search_documents" (
          "id" TEXT PRIMARY KEY,
          "sourceType" TEXT NOT NULL,
          "sourceId" TEXT NOT NULL,
          "monitorId" TEXT REFERENCES "monitors"("id") ON DELETE CASCADE,
          "incidentId" TEXT REFERENCES "incidents"("id") ON DELETE SET NULL,
          "occurredAt" TEXT NOT NULL,
          "title" TEXT NOT NULL,
          "body" TEXT NOT NULL,
          "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
          UNIQUE ("sourceType", "sourceId")
        );

        ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "payload" JSONB NOT NULL DEFAULT '{}'::jsonb;
        ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "baseUrl" TEXT;
        ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "model" TEXT;
        ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "timeoutMs" INTEGER;

        ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'http';
        ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "config" JSONB NOT NULL DEFAULT '{}'::jsonb;
        ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "proxyConfig" JSONB;
        ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "notificationPolicy" JSONB;
        ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "pushToken" TEXT;
        ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "nextCheckAt" TEXT;
        ALTER TABLE "monitors" ADD COLUMN IF NOT EXISTS "lastIncidentId" TEXT;
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_constraint
            WHERE conname = 'monitors_pushToken_key'
          ) THEN
            ALTER TABLE "monitors" ADD CONSTRAINT "monitors_pushToken_key" UNIQUE ("pushToken");
          END IF;
        END
        $$;

        ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "monitorType" TEXT NOT NULL DEFAULT 'http';
        ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "incidentId" TEXT;
        ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "evidence" JSONB NOT NULL DEFAULT '{}'::jsonb;
        ALTER TABLE "checks" ADD COLUMN IF NOT EXISTS "rawResult" JSONB NOT NULL DEFAULT '{}'::jsonb;

        ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "latestAnalysisId" TEXT;
        ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "timelineVersion" INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE "incidents" ADD COLUMN IF NOT EXISTS "lastReportedAt" TEXT;

        ALTER TABLE "analyses" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'monitor-analysis';
        ALTER TABLE "analyses" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'fallback';
        ALTER TABLE "analyses" ADD COLUMN IF NOT EXISTS "citations" JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE "analyses" ADD COLUMN IF NOT EXISTS "retrievalMatches" JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE "analyses" ADD COLUMN IF NOT EXISTS "timeWindowStart" TEXT;
        ALTER TABLE "analyses" ADD COLUMN IF NOT EXISTS "timeWindowEnd" TEXT;

        ALTER TABLE "activity_events" ADD COLUMN IF NOT EXISTS "incidentId" TEXT;
        ALTER TABLE "activity_events" ADD COLUMN IF NOT EXISTS "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb;

        ALTER TABLE "ops_queries" ADD COLUMN IF NOT EXISTS "incidentId" TEXT;
        ALTER TABLE "ops_queries" ADD COLUMN IF NOT EXISTS "retrievalMatches" JSONB NOT NULL DEFAULT '[]'::jsonb;
        ALTER TABLE "ops_queries" ADD COLUMN IF NOT EXISTS "timeWindowStart" TEXT;
        ALTER TABLE "ops_queries" ADD COLUMN IF NOT EXISTS "timeWindowEnd" TEXT;

        CREATE INDEX IF NOT EXISTS "idx_sessions_userId" ON "sessions" ("userId");
        CREATE INDEX IF NOT EXISTS "idx_api_keys_scope" ON "api_keys" ("scope");
        CREATE INDEX IF NOT EXISTS "idx_monitors_status_paused" ON "monitors" ("status", "paused");
        CREATE INDEX IF NOT EXISTS "idx_monitors_nextCheckAt" ON "monitors" ("nextCheckAt");
        CREATE INDEX IF NOT EXISTS "idx_checks_monitor_checkedAt" ON "checks" ("monitorId", "checkedAt" DESC);
        CREATE INDEX IF NOT EXISTS "idx_incidents_monitor_openedAt" ON "incidents" ("monitorId", "openedAt" DESC);
        CREATE INDEX IF NOT EXISTS "idx_incidents_status" ON "incidents" ("status", "updatedAt" DESC);
        CREATE INDEX IF NOT EXISTS "idx_analyses_monitor_createdAt" ON "analyses" ("monitorId", "createdAt" DESC);
        CREATE INDEX IF NOT EXISTS "idx_reports_incident_version" ON "reports" ("incidentId", "version" DESC);
        CREATE INDEX IF NOT EXISTS "idx_activity_events_timestamp" ON "activity_events" ("timestamp" DESC);
        CREATE INDEX IF NOT EXISTS "idx_activity_events_monitor_timestamp" ON "activity_events" ("monitorId", "timestamp" DESC);
        CREATE INDEX IF NOT EXISTS "idx_ops_queries_createdAt" ON "ops_queries" ("createdAt" DESC);
        CREATE INDEX IF NOT EXISTS "idx_jobs_pending" ON "jobs" ("status", "runAt", "priority");
        CREATE UNIQUE INDEX IF NOT EXISTS "idx_jobs_dedupe_active"
          ON "jobs" ("dedupeKey")
          WHERE "dedupeKey" IS NOT NULL AND "status" IN ('pending', 'leased');
        CREATE INDEX IF NOT EXISTS "idx_notification_deliveries_createdAt" ON "notification_deliveries" ("createdAt" DESC);
        CREATE INDEX IF NOT EXISTS "idx_maintenances_active" ON "maintenances" ("isActive", "startsAt", "endsAt");
        CREATE INDEX IF NOT EXISTS "idx_search_documents_occurredAt" ON "search_documents" ("occurredAt" DESC);
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
};

export const getStorageConfig = () => ({
  provider: "pglite",
  database: "embedded",
});

export const getStorageStatus = async () => {
  try {
    await ensureSchema();
    await query("SELECT 1");

    return {
      provider: "pglite",
      database: "embedded",
      connected: true,
      reason: null,
    };
  } catch (error) {
    return {
      provider: "pglite",
      database: "embedded",
      connected: false,
      reason: error instanceof Error ? error.message : "Unable to initialize PGlite.",
    };
  }
};

export const getMeta = async (key) => {
  await ensureSchema();
  const row = await one(`SELECT "value" FROM "meta" WHERE "key" = $1 LIMIT 1`, [key]);
  return row?.value ?? null;
};

export const setMeta = async (key, value) => {
  await ensureSchema();
  await query(
    `
      INSERT INTO "meta" ("key", "value", "updatedAt")
      VALUES ($1, $2, $3)
      ON CONFLICT ("key")
      DO UPDATE SET
        "value" = EXCLUDED."value",
        "updatedAt" = EXCLUDED."updatedAt"
    `,
    [key, value, nowIso()],
  );
};

export const getSetting = async (key) => {
  await ensureSchema();
  const row = await one(`SELECT * FROM "settings" WHERE "key" = $1 LIMIT 1`, [key]);
  return row?.payload ?? null;
};

export const setSetting = async (key, payload) => {
  await ensureSchema();
  const updatedAt = nowIso();
  await query(
    `
      INSERT INTO "settings" ("key", "payload", "updatedAt")
      VALUES ($1, $2::jsonb, $3)
      ON CONFLICT ("key")
      DO UPDATE SET
        "payload" = EXCLUDED."payload",
        "updatedAt" = EXCLUDED."updatedAt"
    `,
    [key, JSON.stringify(payload ?? {}), updatedAt],
  );

  return payload;
};

const normalizeSlmPayload = (row, includeSecrets = false) => {
  const payload = row?.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload : {};
  const apiKeyEncrypted = payload.apiKeyEncrypted ?? null;

  const normalized = {
    provider: normalizeProvider(payload.provider ?? row?.provider),
    baseUrl: normalizeBaseUrl(payload.baseUrl ?? row?.baseUrl),
    model: normalizeModel(payload.model ?? row?.model),
    timeoutMs: sanitizeTimeout(payload.timeoutMs ?? row?.timeoutMs),
    featureFlags:
      payload.featureFlags && typeof payload.featureFlags === "object" && !Array.isArray(payload.featureFlags)
        ? { ...DEFAULT_SLM_FEATURE_FLAGS, ...payload.featureFlags }
        : { ...DEFAULT_SLM_FEATURE_FLAGS },
    updatedAt: String(payload.updatedAt ?? row?.updatedAt ?? nowIso()),
    hasApiKey: Boolean(apiKeyEncrypted),
  };

  if (includeSecrets) {
    return {
      ...normalized,
      apiKey: apiKeyEncrypted ? decryptSecret(apiKeyEncrypted) : null,
      apiKeyEncrypted,
    };
  }

  return normalized;
};

export const getSlmSettings = async ({ includeSecrets = false } = {}) => {
  await ensureSchema();
  const row = await one(`SELECT * FROM "settings" WHERE "key" = 'slm' LIMIT 1`);

  if (row) {
    return normalizeSlmPayload(row, includeSecrets);
  }

  const defaults = {
    provider: DEFAULT_SLM_PROVIDER,
    baseUrl: DEFAULT_SLM_BASE_URL,
    model: DEFAULT_SLM_MODEL,
    timeoutMs: DEFAULT_SLM_TIMEOUT_MS,
    featureFlags: { ...DEFAULT_SLM_FEATURE_FLAGS },
    updatedAt: nowIso(),
  };

  await query(
    `
      INSERT INTO "settings" ("key", "payload", "baseUrl", "model", "timeoutMs", "updatedAt")
      VALUES ('slm', $1::jsonb, $2, $3, $4, $5)
      ON CONFLICT ("key")
      DO UPDATE SET
        "payload" = EXCLUDED."payload",
        "baseUrl" = EXCLUDED."baseUrl",
        "model" = EXCLUDED."model",
        "timeoutMs" = EXCLUDED."timeoutMs",
        "updatedAt" = EXCLUDED."updatedAt"
    `,
    [
      JSON.stringify(defaults),
      defaults.baseUrl,
      defaults.model,
      defaults.timeoutMs,
      defaults.updatedAt,
    ],
  );

  return includeSecrets ? { ...defaults, apiKey: null, apiKeyEncrypted: null, hasApiKey: false } : { ...defaults, hasApiKey: false };
};

export const updateSlmSettings = async (patch) => {
  await ensureSchema();
  const current = await getSlmSettings({ includeSecrets: true });
  const next = {
    provider: normalizeProvider(patch.provider ?? current.provider),
    baseUrl: normalizeBaseUrl(patch.baseUrl ?? current.baseUrl),
    model: normalizeModel(patch.model ?? current.model),
    timeoutMs: sanitizeTimeout(patch.timeoutMs ?? current.timeoutMs),
    featureFlags:
      patch.featureFlags && typeof patch.featureFlags === "object" && !Array.isArray(patch.featureFlags)
        ? { ...current.featureFlags, ...patch.featureFlags }
        : current.featureFlags,
    apiKeyEncrypted:
      Object.prototype.hasOwnProperty.call(patch ?? {}, "apiKey") && patch.apiKey !== undefined
        ? encryptSecret(patch.apiKey)
        : current.apiKeyEncrypted ?? null,
    updatedAt: nowIso(),
  };

  await query(
    `
      INSERT INTO "settings" ("key", "payload", "baseUrl", "model", "timeoutMs", "updatedAt")
      VALUES ('slm', $1::jsonb, $2, $3, $4, $5)
      ON CONFLICT ("key")
      DO UPDATE SET
        "payload" = EXCLUDED."payload",
        "baseUrl" = EXCLUDED."baseUrl",
        "model" = EXCLUDED."model",
        "timeoutMs" = EXCLUDED."timeoutMs",
        "updatedAt" = EXCLUDED."updatedAt"
    `,
    [
      JSON.stringify(next),
      next.baseUrl,
      next.model,
      next.timeoutMs,
      next.updatedAt,
    ],
  );

  return getSlmSettings();
};

