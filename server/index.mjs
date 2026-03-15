import http from "node:http";

import {
  authenticateApiKey,
  bootstrapAdmin,
  changePassword,
  clearSessionCookie,
  confirmPasswordReset,
  createApiKey,
  createSessionCookie,
  disableTotp,
  enableTotp,
  getBootstrapState,
  getSessionFromRequest,
  listApiKeys,
  login,
  logout,
  requestPasswordReset,
  requireSession,
  revokeApiKey,
  setupTotp,
} from "./auth.mjs";
import {
  answerOpsQuestionWithHistory,
  createMonitor,
  deleteMaintenance,
  deleteMonitor,
  deleteNotificationChannel,
  deleteNotificationRule,
  deleteStatusPage,
  getDashboardSnapshot,
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
} from "./data.mjs";
import { checkSlmAvailability, getSlmConfig } from "./slm.mjs";
import { getStorageConfig, getStorageStatus, updateSlmSettings } from "./store.mjs";

const PORT = Number(process.env.SENTINEL_PORT ?? process.env.PORT ?? 8787);
const AUTH_ENABLED = String(process.env.SENTINEL_AUTH ?? "false").toLowerCase() === "true";
const GUEST_USER = {
  id: "user-local-operator",
  email: "local@sentinel",
  name: "Local Operator",
  role: "owner",
  totpEnabled: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  lastLoginAt: "2026-01-01T00:00:00.000Z",
};
const sseClients = new Set();

const buildCorsHeaders = (request, contentType = "application/json") => ({
  "Content-Type": contentType,
  "Access-Control-Allow-Origin": request.headers.origin ?? "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-API-Key",
  "Access-Control-Allow-Credentials": "true",
  Vary: "Origin",
});

const sseHeaders = (request) => ({
  ...buildCorsHeaders(request, "text/event-stream"),
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
});

const readJsonBody = async (request) => {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const payload = Buffer.concat(chunks).toString("utf8");
  return payload ? JSON.parse(payload) : {};
};

const sendJson = (request, response, statusCode, payload, extraHeaders = {}) => {
  response.writeHead(statusCode, {
    ...buildCorsHeaders(request),
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload));
};

const sendText = (request, response, statusCode, body, contentType = "text/plain; charset=utf-8", extraHeaders = {}) => {
  response.writeHead(statusCode, {
    ...buildCorsHeaders(request, contentType),
    ...extraHeaders,
  });
  response.end(body);
};

const sendError = (request, response, statusCode, message) => {
  sendJson(request, response, statusCode, { error: message });
};

const parseMonitorIdFromPath = (pathname) => {
  const match = pathname.match(/^\/api\/monitors\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
};

const parseMonitorAction = (pathname, action) => {
  const match = pathname.match(new RegExp(`^/api/monitors/([^/]+)/${action}$`));
  return match ? decodeURIComponent(match[1]) : null;
};

const parseIncidentIdFromPath = (pathname) => {
  const match = pathname.match(/^\/api\/incidents\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
};

const parseChannelAction = (pathname, action) => {
  const match = pathname.match(new RegExp(`^/api/notifications/channels/([^/]+)/${action}$`));
  return match ? decodeURIComponent(match[1]) : null;
};

const parseDeletePath = (pathname, prefix) => {
  const match = pathname.match(new RegExp(`^${prefix}/([^/]+)$`));
  return match ? decodeURIComponent(match[1]) : null;
};

const writeSseEvent = (response, event, payload) => {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const validateMonitorPayload = (payload) => {
  if (!String(payload.name ?? "").trim()) {
    return "Monitor name is required.";
  }

  if (!String(payload.type ?? "http").trim()) {
    return "Monitor type is required.";
  }

  return null;
};

const validateSlmPayload = (payload) => {
  if (payload.baseUrl != null && !String(payload.baseUrl).trim()) {
    return "SLM base URL is required.";
  }

  if (payload.model != null && !String(payload.model).trim()) {
    return "SLM model is required.";
  }

  if (payload.provider != null && !String(payload.provider).trim()) {
    return "SLM provider is required.";
  }

  if (payload.timeoutMs != null) {
    const timeoutMs = Number(payload.timeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000) {
      return "SLM timeout must be between 1000ms and 120000ms.";
    }
  }

  return null;
};

const getStatusPayload = async () => {
  const [storage, slmConfig, slmAvailability, snapshot] = await Promise.all([
    getStorageStatus(),
    getSlmConfig(),
    checkSlmAvailability({ force: true }),
    getDashboardSnapshot().catch(() => ({
      summary: { total: 0, openIncidents: 0, down: 0, degraded: 0, lastSweepAt: null },
    })),
  ]);

  return {
    backend: {
      status: "online",
      port: PORT,
    },
    storage: {
      ...getStorageConfig(),
      connected: storage.connected,
      reason: storage.reason,
    },
    slm: {
      ...slmConfig,
      reachable: slmAvailability.reachable,
      mode: slmAvailability.mode,
      provider: slmAvailability.provider,
      reason: slmAvailability.reason ?? null,
      queue: await getQueueState(),
    },
    metrics: {
      monitors: snapshot.summary.total,
      openIncidents: snapshot.summary.openIncidents,
      down: snapshot.summary.down,
      degraded: snapshot.summary.degraded,
      lastSweepAt: snapshot.summary.lastSweepAt,
    },
  };
};

const unsubscribeData = subscribe((payload) => {
  void (async () => {
    const snapshot = {
      ...payload,
      dashboard: await getDashboardSnapshot(),
    };

    for (const response of sseClients) {
      writeSseEvent(response, "update", snapshot);
    }
  })().catch(() => {
    // Streaming refresh is best effort.
  });
});

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const { pathname } = requestUrl;

  if (request.method === "OPTIONS") {
    response.writeHead(204, buildCorsHeaders(request));
    response.end();
    return;
  }

  try {
    if (request.method === "GET" && pathname === "/healthz") {
      sendText(request, response, 200, "ok");
      return;
    }

    if (request.method === "GET" && pathname === "/readyz") {
      const storage = await getStorageStatus();
      sendText(request, response, storage.connected ? 200 : 503, storage.connected ? "ready" : "not-ready");
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/bootstrap") {
      const payload = await readJsonBody(request);
      const session = await bootstrapAdmin({
        email: payload.email,
        name: payload.name,
        password: payload.password,
        userAgent: request.headers["user-agent"] ?? null,
        ipAddress: request.socket.remoteAddress ?? null,
      });
      sendJson(request, response, 201, { user: session.user }, { "Set-Cookie": createSessionCookie(session.session.token, session.session.expiresAt) });
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/login") {
      const payload = await readJsonBody(request);
      const session = await login({
        email: payload.email,
        password: payload.password,
        totpCode: payload.totpCode,
        userAgent: request.headers["user-agent"] ?? null,
        ipAddress: request.socket.remoteAddress ?? null,
      });
      sendJson(request, response, 200, { user: session.user }, { "Set-Cookie": createSessionCookie(session.session.token, session.session.expiresAt) });
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/logout") {
      if (!AUTH_ENABLED) {
        sendJson(request, response, 200, { ok: true });
        return;
      }
      const currentSession = await getSessionFromRequest(request, { touch: false });
      await logout(currentSession?.token ?? null);
      sendJson(request, response, 200, { ok: true }, { "Set-Cookie": clearSessionCookie() });
      return;
    }

    if (request.method === "GET" && pathname === "/api/auth/session") {
      if (!AUTH_ENABLED) {
        sendJson(request, response, 200, {
          bootstrap: { hasUsers: true },
          authenticated: true,
          user: GUEST_USER,
        });
        return;
      }
      const [bootstrapState, session] = await Promise.all([getBootstrapState(), getSessionFromRequest(request)]);
      sendJson(request, response, 200, {
        bootstrap: bootstrapState,
        authenticated: Boolean(session),
        user: session?.user ?? null,
      });
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/password-reset/request") {
      const payload = await readJsonBody(request);
      sendJson(request, response, 200, await requestPasswordReset({ email: payload.email }));
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/password-reset/confirm") {
      const payload = await readJsonBody(request);
      await confirmPasswordReset({ token: payload.token, password: payload.password });
      sendJson(request, response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && pathname === "/api/public/status/default") {
      const pages = await listStatusPages();
      const page = pages[0];
      if (!page) {
        sendError(request, response, 404, "No status pages are configured.");
        return;
      }
      sendJson(request, response, 200, await getPublicStatusPage(page.slug, request.headers.host ?? null));
      return;
    }

    const publicStatusMatch = pathname.match(/^\/api\/public\/status\/([^/]+)$/);
    if (request.method === "GET" && publicStatusMatch) {
      const detail = await getPublicStatusPage(decodeURIComponent(publicStatusMatch[1]), request.headers.host ?? null);
      if (!detail) {
        sendError(request, response, 404, "Status page not found.");
        return;
      }
      sendJson(request, response, 200, detail);
      return;
    }

    const badgeMatch = pathname.match(/^\/api\/badge\/([^/]+)\/([^/]+)$/);
    if (request.method === "GET" && badgeMatch) {
      const svg = await renderMonitorBadge(decodeURIComponent(badgeMatch[1]), decodeURIComponent(badgeMatch[2]));
      if (!svg) {
        sendError(request, response, 404, "Monitor not found.");
        return;
      }
      sendText(request, response, 200, svg, "image/svg+xml; charset=utf-8");
      return;
    }

    const pushMatch = pathname.match(/^\/api\/push\/([^/]+)$/);
    if (request.method === "POST" && pushMatch) {
      const payload = await readJsonBody(request);
      const result = await recordPushHeartbeat(decodeURIComponent(pushMatch[1]), payload);
      if (!result) {
        sendError(request, response, 404, "Push monitor not found.");
        return;
      }
      sendJson(request, response, 200, result);
      return;
    }

    if (request.method === "GET" && pathname === "/metrics") {
      if (!AUTH_ENABLED) {
        sendText(request, response, 200, await renderPrometheusMetrics(), "text/plain; version=0.0.4; charset=utf-8");
        return;
      }
      const [session, apiKey] = await Promise.all([
        getSessionFromRequest(request, { touch: false }),
        authenticateApiKey(request, "metrics"),
      ]);
      if (!session && !apiKey) {
        sendError(request, response, 401, "Metrics require authentication or a metrics API key.");
        return;
      }
      sendText(request, response, 200, await renderPrometheusMetrics(), "text/plain; version=0.0.4; charset=utf-8");
      return;
    }

    const session = AUTH_ENABLED ? await getSessionFromRequest(request) : { token: null, user: GUEST_USER };
    const requireLoggedIn = () => {
      if (!AUTH_ENABLED) {
        return session;
      }
      if (!session) {
        throw new Error("Authentication is required.");
      }
      return session;
    };

    if (request.method === "GET" && pathname === "/api/stream") {
      requireLoggedIn();
      response.writeHead(200, sseHeaders(request));
      response.write(": connected\n\n");
      writeSseEvent(response, "update", { type: "connected", dashboard: await getDashboardSnapshot() });
      sseClients.add(response);

      const keepAlive = setInterval(() => {
        response.write(": keep-alive\n\n");
      }, 25_000);

      request.on("close", () => {
        clearInterval(keepAlive);
        sseClients.delete(response);
      });
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/password/change") {
      const current = requireLoggedIn();
      const payload = await readJsonBody(request);
      await changePassword({
        userId: current.user.id,
        currentPassword: payload.currentPassword,
        nextPassword: payload.nextPassword,
      });
      sendJson(request, response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/2fa/setup") {
      const current = requireLoggedIn();
      sendJson(request, response, 200, await setupTotp(current.user.id, current.user.email));
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/2fa/enable") {
      const current = requireLoggedIn();
      const payload = await readJsonBody(request);
      await enableTotp(current.user.id, payload.code);
      sendJson(request, response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && pathname === "/api/auth/2fa/disable") {
      const current = requireLoggedIn();
      await requireSession(request); // deliberate auth check before mutation
      await disableTotp(current.user.id);
      sendJson(request, response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && pathname === "/api/api-keys") {
      requireLoggedIn();
      sendJson(request, response, 200, await listApiKeys());
      return;
    }

    if (request.method === "POST" && pathname === "/api/api-keys") {
      const current = requireLoggedIn();
      const payload = await readJsonBody(request);
      sendJson(request, response, 201, await createApiKey({ label: payload.label, scope: payload.scope, createdByUserId: current.user.id }));
      return;
    }

    const apiKeyId = parseDeletePath(pathname, "/api/api-keys");
    if (request.method === "DELETE" && apiKeyId) {
      requireLoggedIn();
      await revokeApiKey(apiKeyId);
      sendJson(request, response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && pathname === "/api/status") {
      requireLoggedIn();
      sendJson(request, response, 200, await getStatusPayload());
      return;
    }

    if (request.method === "GET" && pathname === "/api/dashboard") {
      requireLoggedIn();
      sendJson(request, response, 200, await getDashboardSnapshot());
      return;
    }

    if (request.method === "GET" && pathname === "/api/operations") {
      requireLoggedIn();
      sendJson(request, response, 200, await getOperationsSnapshot());
      return;
    }

    if (request.method === "GET" && pathname === "/api/incidents") {
      requireLoggedIn();
      sendJson(request, response, 200, (await listIncidents()).map((incident) => incident));
      return;
    }

    const incidentId = parseIncidentIdFromPath(pathname);
    if (request.method === "GET" && incidentId) {
      requireLoggedIn();
      const detail = await getIncidentDetail(incidentId);
      if (!detail) {
        sendError(request, response, 404, "Incident not found.");
        return;
      }
      sendJson(request, response, 200, detail);
      return;
    }

    if (request.method === "GET" && pathname === "/api/settings/slm") {
      requireLoggedIn();
      sendJson(request, response, 200, {
        settings: await getSlmConfig(),
        availability: await checkSlmAvailability({ force: true }),
      });
      return;
    }

    if (request.method === "PATCH" && pathname === "/api/settings/slm") {
      requireLoggedIn();
      const payload = await readJsonBody(request);
      const validationError = validateSlmPayload(payload);
      if (validationError) {
        sendError(request, response, 400, validationError);
        return;
      }

      const settings = await updateSlmSettings(payload);
      sendJson(request, response, 200, {
        settings,
        availability: await checkSlmAvailability({ force: true }),
      });
      return;
    }

    if (request.method === "GET" && pathname === "/api/monitors") {
      requireLoggedIn();
      sendJson(request, response, 200, (await getDashboardSnapshot()).monitors);
      return;
    }

    const monitorId = parseMonitorIdFromPath(pathname);
    if (request.method === "GET" && monitorId) {
      requireLoggedIn();
      const detail = await getMonitorDetail(monitorId);
      if (!detail) {
        sendError(request, response, 404, "Monitor not found.");
        return;
      }
      sendJson(request, response, 200, detail);
      return;
    }

    if (request.method === "POST" && pathname === "/api/monitors") {
      requireLoggedIn();
      const payload = await readJsonBody(request);
      const validationError = validateMonitorPayload(payload);
      if (validationError) {
        sendError(request, response, 400, validationError);
        return;
      }

      const monitor = await createMonitor({
        ...payload,
        tags: Array.isArray(payload.tags)
          ? payload.tags
          : String(payload.tags ?? "")
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
      });

      sendJson(request, response, 201, { monitor, dashboard: await getDashboardSnapshot() });
      return;
    }

    if (request.method === "PATCH" && monitorId) {
      requireLoggedIn();
      const payload = await readJsonBody(request);
      const monitor = await updateMonitor(monitorId, payload);
      if (!monitor) {
        sendError(request, response, 404, "Monitor not found.");
        return;
      }

      sendJson(request, response, 200, { monitor, dashboard: await getDashboardSnapshot() });
      return;
    }

    if (request.method === "DELETE" && monitorId) {
      requireLoggedIn();
      const deleted = await deleteMonitor(monitorId);
      if (!deleted) {
        sendError(request, response, 404, "Monitor not found.");
        return;
      }

      sendJson(request, response, 200, { ok: true, dashboard: await getDashboardSnapshot() });
      return;
    }

    const checkMonitorId = parseMonitorAction(pathname, "check");
    if (request.method === "POST" && checkMonitorId) {
      requireLoggedIn();
      const result = await runMonitorCheck(checkMonitorId, { reason: "manual" });
      sendJson(request, response, 200, { ...result, detail: await getMonitorDetail(checkMonitorId), dashboard: await getDashboardSnapshot() });
      return;
    }

    const analyzeMonitorId = parseMonitorAction(pathname, "analyze");
    if (request.method === "POST" && analyzeMonitorId) {
      requireLoggedIn();
      await requestMonitorAnalysis(analyzeMonitorId, { source: "manual", wait: true, eventType: "manual" });
      const detail = await getMonitorDetail(analyzeMonitorId);
      if (!detail) {
        sendError(request, response, 404, "Monitor not found.");
        return;
      }
      sendJson(request, response, 200, { detail, dashboard: await getDashboardSnapshot() });
      return;
    }

    if (request.method === "POST" && pathname === "/api/sweep") {
      requireLoggedIn();
      sendJson(request, response, 200, { message: "Synthetic sweep completed.", dashboard: await runSyntheticSweep() });
      return;
    }

    if (request.method === "GET" && pathname === "/api/notifications/channels") {
      requireLoggedIn();
      sendJson(request, response, 200, await listNotificationChannels());
      return;
    }

    if (request.method === "POST" && pathname === "/api/notifications/channels") {
      requireLoggedIn();
      sendJson(request, response, 201, await saveNotificationChannel(await readJsonBody(request)));
      return;
    }

    const testChannelId = parseChannelAction(pathname, "test");
    if (request.method === "POST" && testChannelId) {
      requireLoggedIn();
      sendJson(request, response, 200, await testNotificationChannel(testChannelId));
      return;
    }

    const deleteChannelId = parseDeletePath(pathname, "/api/notifications/channels");
    if (request.method === "DELETE" && deleteChannelId) {
      requireLoggedIn();
      await deleteNotificationChannel(deleteChannelId);
      sendJson(request, response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && pathname === "/api/notifications/rules") {
      requireLoggedIn();
      sendJson(request, response, 200, await listNotificationRules());
      return;
    }

    if (request.method === "POST" && pathname === "/api/notifications/rules") {
      requireLoggedIn();
      sendJson(request, response, 201, await saveNotificationRule(await readJsonBody(request)));
      return;
    }

    const deleteRuleId = parseDeletePath(pathname, "/api/notifications/rules");
    if (request.method === "DELETE" && deleteRuleId) {
      requireLoggedIn();
      await deleteNotificationRule(deleteRuleId);
      sendJson(request, response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && pathname === "/api/maintenances") {
      requireLoggedIn();
      sendJson(request, response, 200, await listMaintenances());
      return;
    }

    if (request.method === "POST" && pathname === "/api/maintenances") {
      requireLoggedIn();
      sendJson(request, response, 201, await saveMaintenance(await readJsonBody(request)));
      return;
    }

    const deleteMaintenanceId = parseDeletePath(pathname, "/api/maintenances");
    if (request.method === "DELETE" && deleteMaintenanceId) {
      requireLoggedIn();
      await deleteMaintenance(deleteMaintenanceId);
      sendJson(request, response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && pathname === "/api/status-pages") {
      requireLoggedIn();
      sendJson(request, response, 200, await listStatusPages());
      return;
    }

    if (request.method === "POST" && pathname === "/api/status-pages") {
      requireLoggedIn();
      sendJson(request, response, 201, await saveStatusPage(await readJsonBody(request)));
      return;
    }

    const deleteStatusPageId = parseDeletePath(pathname, "/api/status-pages");
    if (request.method === "DELETE" && deleteStatusPageId) {
      requireLoggedIn();
      await deleteStatusPage(deleteStatusPageId);
      sendJson(request, response, 200, { ok: true });
      return;
    }

    if (request.method === "GET" && pathname === "/api/ops/query/history") {
      requireLoggedIn();
      sendJson(
        request,
        response,
        200,
        await listOpsQueryHistory({
          monitorId: requestUrl.searchParams.get("monitorId"),
          incidentId: requestUrl.searchParams.get("incidentId"),
          limit: Number(requestUrl.searchParams.get("limit") ?? 20),
        }),
      );
      return;
    }

    if (request.method === "POST" && pathname === "/api/ops/query") {
      requireLoggedIn();
      const payload = await readJsonBody(request);
      const question = String(payload.question ?? "").trim();
      if (!question) {
        sendError(request, response, 400, "A natural-language question is required.");
        return;
      }

      sendJson(
        request,
        response,
        200,
        await answerOpsQuestionWithHistory({
          question,
          monitorId: payload.monitorId ? String(payload.monitorId) : null,
          incidentId: payload.incidentId ? String(payload.incidentId) : null,
        }),
      );
      return;
    }

    sendError(request, response, 404, "Route not found.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected server error.";
    const statusCode = /auth/i.test(message) ? 401 : 500;
    sendError(request, response, statusCode, message);
  }
});

startMonitoringEngine();

server.listen(PORT, () => {
  console.log(`Auto-Ops Sentinel backend is listening on http://127.0.0.1:${PORT}`);
});

server.on("close", () => {
  unsubscribeData();
});
