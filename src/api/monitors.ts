import type {
  ApiKeyRecord,
  AskOpsResponse,
  AuthSessionPayload,
  CreateMonitorInput,
  DashboardPayload,
  IncidentDetailPayload,
  IncidentSummary,
  MaintenanceWindow,
  MonitorDetailPayload,
  MonitorSummary,
  NotificationChannel,
  NotificationRule,
  PublicStatusPagePayload,
  SlmSettingsPayload,
  StatusPageRecord,
  StatusPayload,
} from "@/types/monitoring";
import { apiRequest, getApiBaseUrl, apiTextRequest } from "./client";

export { getApiBaseUrl };

export const fetchSession = () => apiRequest<AuthSessionPayload>("/auth/session");
export const bootstrapAdminApi = (payload: { email: string; name: string; password: string }) =>
  apiRequest<{ user: AuthSessionPayload["user"] }>("/auth/bootstrap", {
    method: "POST",
    body: JSON.stringify(payload),
  });
export const loginApi = (payload: { email: string; password: string; totpCode?: string }) =>
  apiRequest<{ user: AuthSessionPayload["user"] }>("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
export const logoutApi = () =>
  apiRequest<{ ok: boolean }>("/auth/logout", {
    method: "POST",
  });
export const requestPasswordResetApi = (email: string) =>
  apiRequest<{ ok: boolean; previewToken: string | null; expiresAt: string | null }>("/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
export const confirmPasswordResetApi = (payload: { token: string; password: string }) =>
  apiRequest<{ ok: boolean }>("/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify(payload),
  });
export const changePasswordApi = (payload: { currentPassword: string; nextPassword: string }) =>
  apiRequest<{ ok: boolean }>("/auth/password/change", {
    method: "POST",
    body: JSON.stringify(payload),
  });
export const setupTotpApi = () =>
  apiRequest<{ secret: string; otpauthUrl: string }>("/auth/2fa/setup", {
    method: "POST",
  });
export const enableTotpApi = (code: string) =>
  apiRequest<{ ok: boolean }>("/auth/2fa/enable", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
export const disableTotpApi = () =>
  apiRequest<{ ok: boolean }>("/auth/2fa/disable", {
    method: "POST",
  });

export const fetchDashboard = () => apiRequest<DashboardPayload>("/dashboard");
export const fetchStatus = () => apiRequest<StatusPayload>("/status");
export const fetchMonitor = (id: string) => apiRequest<MonitorDetailPayload>(`/monitors/${id}`);
export const createMonitor = (payload: CreateMonitorInput) =>
  apiRequest<{ monitor: MonitorSummary; dashboard: DashboardPayload }>("/monitors", {
    method: "POST",
    body: JSON.stringify(payload),
  });
export const updateMonitorApi = (id: string, payload: Partial<CreateMonitorInput> & { paused?: boolean }) =>
  apiRequest<{ monitor: MonitorSummary; dashboard: DashboardPayload }>(`/monitors/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
export const deleteMonitorApi = (id: string) =>
  apiRequest<{ ok: boolean; dashboard: DashboardPayload }>(`/monitors/${id}`, {
    method: "DELETE",
  });
export const triggerMonitorCheckApi = (id: string) =>
  apiRequest<{ detail: MonitorDetailPayload; dashboard: DashboardPayload }>(`/monitors/${id}/check`, {
    method: "POST",
  });
export const triggerMonitorAnalysisApi = (id: string) =>
  apiRequest<{ detail: MonitorDetailPayload; dashboard: DashboardPayload }>(`/monitors/${id}/analyze`, {
    method: "POST",
  });
export const runSyntheticSweep = () =>
  apiRequest<{ message: string; dashboard: DashboardPayload }>("/sweep", {
    method: "POST",
  });

export const fetchIncidents = () => apiRequest<IncidentSummary[]>("/incidents");
export const fetchIncidentDetail = (id: string) => apiRequest<IncidentDetailPayload>(`/incidents/${id}`);

export const fetchNotificationChannels = () => apiRequest<NotificationChannel[]>("/notifications/channels");
export const saveNotificationChannelApi = (payload: Record<string, unknown>) =>
  apiRequest<NotificationChannel>("/notifications/channels", {
    method: "POST",
    body: JSON.stringify(payload),
  });
export const deleteNotificationChannelApi = (id: string) =>
  apiRequest<{ ok: boolean }>(`/notifications/channels/${id}`, {
    method: "DELETE",
  });
export const testNotificationChannelApi = (id: string) =>
  apiRequest<{ status: number; summary: string }>(`/notifications/channels/${id}/test`, {
    method: "POST",
  });
export const fetchNotificationRules = () => apiRequest<NotificationRule[]>("/notifications/rules");
export const saveNotificationRuleApi = (payload: Record<string, unknown>) =>
  apiRequest<NotificationRule>("/notifications/rules", {
    method: "POST",
    body: JSON.stringify(payload),
  });
export const deleteNotificationRuleApi = (id: string) =>
  apiRequest<{ ok: boolean }>(`/notifications/rules/${id}`, {
    method: "DELETE",
  });

export const fetchMaintenances = () => apiRequest<MaintenanceWindow[]>("/maintenances");
export const saveMaintenanceApi = (payload: Record<string, unknown>) =>
  apiRequest<MaintenanceWindow>("/maintenances", {
    method: "POST",
    body: JSON.stringify(payload),
  });
export const deleteMaintenanceApi = (id: string) =>
  apiRequest<{ ok: boolean }>(`/maintenances/${id}`, {
    method: "DELETE",
  });

export const fetchStatusPages = () => apiRequest<StatusPageRecord[]>("/status-pages");
export const saveStatusPageApi = (payload: Record<string, unknown>) =>
  apiRequest<StatusPageRecord>("/status-pages", {
    method: "POST",
    body: JSON.stringify(payload),
  });
export const deleteStatusPageApi = (id: string) =>
  apiRequest<{ ok: boolean }>(`/status-pages/${id}`, {
    method: "DELETE",
  });
export const fetchPublicStatusPage = (slug: string) => apiRequest<PublicStatusPagePayload>(`/public/status/${slug}`);

export const updateSlmSettingsApi = (payload: { provider?: string; baseUrl?: string; model?: string; timeoutMs?: number; apiKey?: string }) =>
  apiRequest<SlmSettingsPayload>("/settings/slm", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

export const askOpsQuestion = (question: string, monitorId?: string | null, incidentId?: string | null) =>
  apiRequest<AskOpsResponse>("/ops/query", {
    method: "POST",
    body: JSON.stringify({
      question,
      monitorId: monitorId ?? null,
      incidentId: incidentId ?? null,
    }),
  });
export const fetchOpsHistory = (params: { monitorId?: string | null; incidentId?: string | null; limit?: number } = {}) => {
  const query = new URLSearchParams();
  if (params.monitorId) {
    query.set("monitorId", params.monitorId);
  }
  if (params.incidentId) {
    query.set("incidentId", params.incidentId);
  }
  if (params.limit) {
    query.set("limit", String(params.limit));
  }
  return apiRequest<AskOpsResponse[]>(`/ops/query/history${query.toString() ? `?${query.toString()}` : ""}`);
};

export const fetchApiKeys = () => apiRequest<ApiKeyRecord[]>("/api-keys");
export const createApiKeyApi = (payload: { label: string; scope: string }) =>
  apiRequest<ApiKeyRecord>("/api-keys", {
    method: "POST",
    body: JSON.stringify(payload),
  });
export const revokeApiKeyApi = (id: string) =>
  apiRequest<{ ok: boolean }>(`/api-keys/${id}`, {
    method: "DELETE",
  });

export const fetchBadgeSvg = (monitorId: string, kind: string) => apiTextRequest(`/badge/${monitorId}/${kind}`);
