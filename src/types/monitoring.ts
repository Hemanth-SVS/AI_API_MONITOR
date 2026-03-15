export type MonitorStatus = "up" | "down" | "degraded" | "pending";
export type IncidentStatus = "open" | "investigating" | "resolved";
export type IncidentSeverity = "critical" | "high" | "medium" | "low";
export type AnalysisMode = "live" | "fallback";
export type AnalysisState = "idle" | "queued" | "running" | "completed" | "failed";
export type MonitorType = "http" | "keyword" | "json-query" | "tcp" | "websocket" | "ping" | "dns" | "push" | "docker" | "steam";
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface SlmSettings {
  provider: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  updatedAt?: string;
  featureFlags?: Record<string, boolean>;
  hasApiKey?: boolean;
}

export interface UserSession {
  id: string;
  email: string;
  name: string;
  role: string;
  totpEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
}

export interface AuthSessionPayload {
  bootstrap: {
    hasUsers: boolean;
  };
  authenticated: boolean;
  user: UserSession | null;
}

export interface ApiKeyRecord {
  id: string;
  label: string;
  scope: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  token?: string;
}

export interface ActivityItem {
  id: string;
  timestamp: string;
  type: string;
  severity: string;
  title: string;
  message: string;
  monitorId: string | null;
  incidentId?: string | null;
  metadata?: Record<string, JsonValue>;
}

export interface MonitorCheck {
  id: string;
  monitorId: string;
  monitorType: string;
  incidentId?: string | null;
  checkedAt: string;
  startedAt: string;
  status: MonitorStatus;
  latencyMs: number;
  statusCode: number | null;
  classification: string;
  message: string;
  responsePreview: string | null;
  responseBody?: string | null;
  responseHeaders?: Record<string, string>;
  evidence?: Record<string, JsonValue>;
}

export interface RetrievalMatch {
  sourceType: string;
  sourceId: string;
  monitorId: string | null;
  incidentId: string | null;
  occurredAt: string;
  title: string;
  snippet: string;
  metadata?: Record<string, JsonValue>;
  score: number;
}

export interface MonitorAnalysis {
  id: string;
  createdAt: string;
  source: "automatic" | "manual";
  mode: AnalysisMode;
  provider?: string;
  model: string;
  status: "queued" | "running" | "completed" | "failed";
  facts: string[];
  probableRootCause: string;
  confidence: number;
  blastRadius: string;
  recommendedChecks: string[];
  suggestedFixes: string[];
  reportSummary: string;
  evidence: string[];
  citations?: string[];
  retrievalMatches?: RetrievalMatch[];
  timeWindowStart?: string | null;
  timeWindowEnd?: string | null;
}

export interface MonitorAnalysisRecord extends MonitorAnalysis {
  monitorId: string | null;
  incidentId: string | null;
  prompt: string | null;
  rawResponse: string | null;
  parsedResponse: Record<string, JsonValue> | null;
  failureReason: string | null;
  slmConfig: SlmSettings | null;
}

export interface ReportRecord {
  id: string;
  incidentId: string;
  monitorId: string;
  analysisId: string | null;
  version: number;
  title: string;
  summary: string;
  markdown: string;
  jsonPayload: Record<string, JsonValue>;
  fileBasePath: string | null;
  createdAt: string;
}

export interface IncidentSummary {
  id: string;
  monitorId: string;
  title: string;
  status: IncidentStatus;
  severity: IncidentSeverity;
  summary: string;
  openedAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  classification: string;
}

export interface MonitorSummary {
  id: string;
  type: MonitorType;
  name: string;
  url: string;
  method: string;
  intervalSeconds: number;
  timeoutMs: number;
  retries: number;
  environment: string;
  owner: string;
  description: string;
  tags: string[];
  config: Record<string, JsonValue>;
  proxyConfig?: Record<string, JsonValue> | null;
  notificationPolicy?: Record<string, JsonValue> | null;
  pushToken?: string | null;
  paused: boolean;
  status: MonitorStatus;
  lastCheckedAt: string | null;
  nextCheckAt?: string | null;
  avgLatencyMs: number;
  lastLatencyMs: number;
  uptime24h: number;
  uptime30d: number;
  expectedStatusCodes: string;
  expectedBodyIncludes: string;
  analysisState: AnalysisState;
  latestAnalysis: MonitorAnalysis | null;
  openIncident: IncidentSummary | null;
  recentHeartbeats: MonitorCheck[];
  activeMaintenances?: Array<{
    id: string;
    name: string;
    startsAt: string;
    endsAt: string;
  }>;
  summary: string;
}

export interface DashboardSummary {
  total: number;
  up: number;
  down: number;
  degraded: number;
  pending: number;
  paused: number;
  openIncidents: number;
  avgUptime24h: number;
  meanLatencyMs: number;
  lastSweepAt: string | null;
}

export interface DashboardPayload {
  generatedAt: string;
  summary: DashboardSummary;
  monitors: MonitorSummary[];
  incidents: IncidentSummary[];
  activityFeed: ActivityItem[];
  queue: {
    depth: number;
    running: number;
    concurrency: number;
  };
}

export interface MonitorDetailPayload {
  generatedAt: string;
  monitor: MonitorSummary;
  recentChecks: MonitorCheck[];
  incidentHistory: IncidentSummary[];
  recentEvents: ActivityItem[];
  latestAnalysis: MonitorAnalysis | null;
  analysisHistory: MonitorAnalysisRecord[];
  reportHistory: ReportRecord[];
  latestCertificate?: {
    id: string;
    hostname: string;
    subject: string | null;
    issuer: string | null;
    validFrom: string | null;
    validTo: string | null;
    daysRemaining: number | null;
    createdAt: string;
  } | null;
  historyTotals: {
    checks: number;
    incidents: number;
    analyses: number;
    activityEvents: number;
  };
  config: {
    expectedStatusCodes: string;
    expectedBodyIncludes: string;
    headerText: string;
    body: string;
    retries: number;
    intervalSeconds: number;
    timeoutMs: number;
    environment: string;
    owner: string;
    type: MonitorType;
    config: Record<string, JsonValue>;
    proxyConfig?: Record<string, JsonValue> | null;
    notificationPolicy?: Record<string, JsonValue> | null;
    pushToken?: string | null;
  };
}

export interface IncidentDetailPayload {
  incident: IncidentSummary;
  monitor: MonitorSummary | null;
  timeline: ActivityItem[];
  reports: ReportRecord[];
  analyses: MonitorAnalysisRecord[];
}

export interface NotificationChannel {
  id: string;
  name: string;
  type: string;
  isEnabled: boolean;
  configPreview: Record<string, JsonValue>;
  createdAt: string;
  updatedAt: string;
  lastTestedAt: string | null;
  lastError: string | null;
}

export interface NotificationRule {
  id: string;
  name: string;
  monitorIds: string[];
  tags: string[];
  eventTypes: string[];
  severities: string[];
  channelIds: string[];
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceWindow {
  id: string;
  name: string;
  description: string;
  monitorIds: string[];
  scheduleType: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  rrule: string | null;
  suppressNotifications: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StatusPageRecord {
  id: string;
  name: string;
  slug: string;
  headline: string;
  description: string;
  isPublic: boolean;
  customDomain: string | null;
  showHistory: boolean;
  createdAt: string;
  updatedAt: string;
  monitorIds: string[];
}

export interface PublicStatusPagePayload {
  page: Omit<StatusPageRecord, "monitorIds">;
  summary: {
    total: number;
    up: number;
    down: number;
    degraded: number;
    openIncidents: number;
  };
  monitors: MonitorSummary[];
  incidents: IncidentSummary[];
  maintenances: Array<{
    id: string;
    name: string;
    startsAt: string;
    endsAt: string;
    scheduleType: string;
  }>;
}

export interface StatusPayload {
  backend: {
    status: string;
    port: number;
  };
  storage: {
    provider: string;
    database: string;
    connected: boolean;
    reason: string | null;
  };
  slm: SlmSettings & {
    reachable: boolean;
    mode: AnalysisMode;
    provider: string;
    reason: string | null;
    queue: {
      depth: number;
      running: number;
      concurrency: number;
    };
  };
  metrics: {
    monitors: number;
    openIncidents: number;
    down: number;
    degraded: number;
    lastSweepAt: string | null;
  };
}

export interface AskOpsResponse {
  id: string;
  answer: string;
  mode: AnalysisMode;
  provider?: string;
  model: string;
  citations: string[];
  retrievalMatches: RetrievalMatch[];
  prompt?: string | null;
  rawResponse?: string | null;
  failureReason?: string | null;
  slmConfig?: SlmSettings | null;
  timeWindow?: {
    start: string;
    end: string;
  } | null;
}

export interface SlmSettingsPayload {
  settings: SlmSettings;
  availability: {
    reachable: boolean;
    mode: AnalysisMode;
    provider: string;
    reason: string | null;
  };
}

export interface CreateMonitorInput {
  type: MonitorType;
  name: string;
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  intervalSeconds: number;
  timeoutMs: number;
  retries: number;
  environment: string;
  owner: string;
  expectedStatusCodes: string;
  expectedBodyIncludes: string;
  headerText: string;
  body: string;
  description: string;
  tags: string[];
  config: Record<string, JsonValue>;
  proxyConfig?: Record<string, JsonValue> | null;
  notificationPolicy?: Record<string, JsonValue> | null;
  pushToken?: string | null;
}
