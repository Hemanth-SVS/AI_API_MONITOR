import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "@/App";

const dashboardFixture = {
  generatedAt: "2026-03-14T10:00:00.000Z",
  summary: {
    total: 1,
    up: 0,
    down: 1,
    degraded: 0,
    pending: 0,
    paused: 0,
    openIncidents: 1,
    avgUptime24h: 91.22,
    meanLatencyMs: 0,
    lastSweepAt: "2026-03-14T09:59:00.000Z",
  },
  monitors: [
    {
      id: "mon-webhooks",
      type: "http",
      name: "Webhook Dispatcher",
      url: "https://hooks.internal.local/dispatch",
      method: "POST",
      intervalSeconds: 60,
      timeoutMs: 10000,
      retries: 1,
      environment: "production",
      owner: "integrations",
      description: "Outbound delivery for partner webhooks.",
      tags: ["critical", "partners"],
      config: {
        url: "https://hooks.internal.local/dispatch",
        method: "POST",
      },
      proxyConfig: null,
      notificationPolicy: null,
      pushToken: null,
      paused: false,
      status: "down",
      lastCheckedAt: "2026-03-14T09:59:00.000Z",
      nextCheckAt: "2026-03-14T10:00:00.000Z",
      avgLatencyMs: 0,
      lastLatencyMs: 0,
      uptime24h: 91.22,
      uptime30d: 99.1,
      expectedStatusCodes: "200-299",
      expectedBodyIncludes: "",
      analysisState: "completed",
      latestAnalysis: {
        id: "ana-webhooks",
        createdAt: "2026-03-14T09:59:10.000Z",
        source: "automatic",
        mode: "fallback",
        provider: "ollama",
        model: "fallback-rules",
        status: "completed",
        facts: ["Latest unhealthy check: status_code_mismatch."],
        probableRootCause: "Partner credentials drifted after a webhook secret rotation.",
        confidence: 0.82,
        blastRadius: "Partner-west deliveries are blocked.",
        recommendedChecks: ["Verify tenant secret metadata."],
        suggestedFixes: ["Restore matching secret versions."],
        reportSummary: "Webhook Dispatcher is failing because partner secret configuration drifted.",
        evidence: ["Latest unhealthy check: status_code_mismatch."],
        citations: ["chk-1"],
        retrievalMatches: [],
      },
      openIncident: {
        id: "inc-webhooks",
        monitorId: "mon-webhooks",
        title: "Webhook Dispatcher is returning unexpected status codes",
        status: "open",
        severity: "high",
        summary: "Expected 200-299, got HTTP 401.",
        openedAt: "2026-03-14T09:54:00.000Z",
        updatedAt: "2026-03-14T09:59:00.000Z",
        resolvedAt: null,
        classification: "status_code_mismatch",
      },
      recentHeartbeats: [
        {
          id: "chk-1",
          monitorId: "mon-webhooks",
          monitorType: "http",
          checkedAt: "2026-03-14T09:59:00.000Z",
          startedAt: "2026-03-14T09:58:59.000Z",
          status: "down",
          latencyMs: 0,
          statusCode: 401,
          classification: "status_code_mismatch",
          message: "Expected 200-299, got HTTP 401.",
          responsePreview: null,
        },
      ],
      summary: "Webhook Dispatcher is failing because partner secret configuration drifted.",
    },
  ],
  incidents: [],
  activityFeed: [],
  queue: {
    depth: 0,
    running: 0,
    concurrency: 1,
  },
};

const statusFixture = {
  backend: {
    status: "online",
    port: 8787,
  },
  storage: {
    provider: "postgresql",
    database: "auto_ops_sentinel",
    connected: true,
    reason: null,
  },
  slm: {
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    model: "llama3.2:3b",
    timeoutMs: 20000,
    reachable: false,
    mode: "fallback",
    reason: "connect ECONNREFUSED 127.0.0.1:11434",
    queue: {
      depth: 0,
      running: 0,
      concurrency: 1,
    },
  },
  metrics: {
    monitors: 1,
    openIncidents: 1,
    down: 1,
    degraded: 0,
    lastSweepAt: "2026-03-14T09:59:00.000Z",
  },
};

const monitorFixture = {
  generatedAt: "2026-03-14T10:00:00.000Z",
  monitor: dashboardFixture.monitors[0],
  recentChecks: [
    {
      id: "chk-1",
      monitorId: "mon-webhooks",
      monitorType: "http",
      checkedAt: "2026-03-14T09:59:00.000Z",
      startedAt: "2026-03-14T09:58:59.000Z",
      status: "down",
      latencyMs: 0,
      statusCode: 401,
      classification: "status_code_mismatch",
      message: "Expected 200-299, got HTTP 401.",
      responsePreview: null,
      responseBody: null,
      responseHeaders: {},
      evidence: {},
    },
  ],
  incidentHistory: [dashboardFixture.monitors[0].openIncident],
  recentEvents: [
    {
      id: "evt-1",
      timestamp: "2026-03-14T09:59:10.000Z",
      type: "analysis",
      severity: "medium",
      title: "Webhook Dispatcher analysis refreshed",
      message: "Webhook Dispatcher is failing because partner secret configuration drifted.",
      monitorId: "mon-webhooks",
      incidentId: "inc-webhooks",
      metadata: {},
    },
  ],
  latestAnalysis: dashboardFixture.monitors[0].latestAnalysis,
  analysisHistory: [
    {
      ...dashboardFixture.monitors[0].latestAnalysis,
      monitorId: "mon-webhooks",
      incidentId: "inc-webhooks",
      prompt: "Analyze the latest monitor failure.",
      rawResponse: "{\"reportSummary\":\"Webhook Dispatcher is failing because partner secret configuration drifted.\"}",
      parsedResponse: {
        reportSummary: "Webhook Dispatcher is failing because partner secret configuration drifted.",
      },
      failureReason: null,
      slmConfig: {
        provider: "ollama",
        baseUrl: "http://127.0.0.1:11434",
        model: "llama3.2:3b",
        timeoutMs: 20000,
      },
    },
  ],
  reportHistory: [],
  latestCertificate: null,
  historyTotals: {
    checks: 1,
    incidents: 1,
    analyses: 1,
    activityEvents: 1,
  },
  config: {
    expectedStatusCodes: "200-299",
    expectedBodyIncludes: "",
    headerText: "",
    body: "",
    retries: 1,
    intervalSeconds: 60,
    timeoutMs: 10000,
    environment: "production",
    owner: "integrations",
    type: "http",
    config: {
      url: "https://hooks.internal.local/dispatch",
      method: "POST",
    },
    proxyConfig: null,
    notificationPolicy: null,
    pushToken: null,
  },
};

describe("Auto-Ops Sentinel", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.endsWith("/api/dashboard")) {
          return {
            ok: true,
            json: async () => dashboardFixture,
          } as Response;
        }

        if (url.endsWith("/api/status")) {
          return {
            ok: true,
            json: async () => statusFixture,
          } as Response;
        }

        if (url.endsWith("/api/monitors/mon-webhooks")) {
          return {
            ok: true,
            json: async () => monitorFixture,
          } as Response;
        }

        throw new Error(`Unexpected fetch call: ${url}`);
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the monitor console without an auth wall", async () => {
    window.history.pushState({}, "", "/");
    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /auto-ops sentinel/i })).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /add new monitor/i })).toBeInTheDocument();
    expect(screen.getByText(/Webhook Dispatcher/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /^signal analyst$/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /ask signal analyst/i })).toBeInTheDocument();
    });
  });
});
