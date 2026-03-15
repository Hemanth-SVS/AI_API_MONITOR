import { startTransition, useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AddMonitorForm } from "@/components/AddMonitorForm";
import { Header } from "@/components/Header";
import { IncidentCenter } from "@/components/IncidentCenter";
import { MaintenanceCenter } from "@/components/MaintenanceCenter";
import { MonitorDetailView } from "@/components/MonitorDetail";
import { MonitorSidebar } from "@/components/MonitorSidebar";
import { NotificationCenter } from "@/components/NotificationCenter";
import { SecurityCenter } from "@/components/SecurityCenter";
import { SlmSettingsDialog } from "@/components/SlmSettingsDialog";
import { StatusPagesCenter } from "@/components/StatusPagesCenter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  askOpsQuestion,
  bootstrapAdminApi,
  changePasswordApi,
  confirmPasswordResetApi,
  createApiKeyApi,
  createMonitor,
  deleteMaintenanceApi,
  deleteMonitorApi,
  deleteNotificationChannelApi,
  deleteNotificationRuleApi,
  deleteStatusPageApi,
  disableTotpApi,
  enableTotpApi,
  fetchApiKeys,
  fetchDashboard,
  fetchIncidentDetail,
  fetchIncidents,
  fetchMaintenances,
  fetchMonitor,
  fetchNotificationChannels,
  fetchNotificationRules,
  fetchSession,
  fetchStatus,
  fetchStatusPages,
  getApiBaseUrl,
  loginApi,
  logoutApi,
  requestPasswordResetApi,
  revokeApiKeyApi,
  runSyntheticSweep,
  saveMaintenanceApi,
  saveNotificationChannelApi,
  saveNotificationRuleApi,
  saveStatusPageApi,
  setupTotpApi,
  testNotificationChannelApi,
  triggerMonitorAnalysisApi,
  triggerMonitorCheckApi,
  updateMonitorApi,
  updateSlmSettingsApi,
} from "@/api/monitors";
import type { ApiKeyRecord, AuthSessionPayload, CreateMonitorInput, MonitorDetailPayload, UserSession } from "@/types/monitoring";

type WorkspaceMode = "detail" | "create" | "edit";
type AppView = "dashboard" | "incidents" | "notifications" | "maintenance" | "status-pages" | "security";
type AuthMode = "bootstrap" | "login" | "reset-request" | "reset-confirm";

const toEditorPayload = (detail: MonitorDetailPayload): CreateMonitorInput => ({
  type: detail.monitor.type,
  name: detail.monitor.name,
  url: detail.monitor.url,
  method: detail.monitor.method as CreateMonitorInput["method"],
  intervalSeconds: detail.config.intervalSeconds,
  timeoutMs: detail.config.timeoutMs,
  retries: detail.config.retries,
  environment: detail.config.environment,
  owner: detail.config.owner,
  expectedStatusCodes: detail.config.expectedStatusCodes,
  expectedBodyIncludes: detail.config.expectedBodyIncludes,
  headerText: detail.config.headerText,
  body: detail.config.body,
  description: detail.monitor.description,
  tags: [...detail.monitor.tags],
  config: { ...detail.config.config },
  proxyConfig: detail.config.proxyConfig ?? null,
  notificationPolicy: detail.config.notificationPolicy ?? null,
  pushToken: detail.config.pushToken ?? null,
});

const authCardClass = "rounded-[2rem] border border-white/8 bg-[#11161f] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.25)]";
const authInputClass = "border-white/10 bg-[#0b1118]";

const buildSessionData = (user: UserSession | null, hasUsers: boolean): AuthSessionPayload => ({
  bootstrap: {
    hasUsers,
  },
  authenticated: Boolean(user),
  user,
});

const Workspace = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("detail");
  const [editorSeed, setEditorSeed] = useState<CreateMonitorInput | null>(null);
  const [view, setView] = useState<AppView>("dashboard");
  const [isSlmSettingsOpen, setIsSlmSettingsOpen] = useState(false);

  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [bootstrapForm, setBootstrapForm] = useState({ email: "", name: "", password: "" });
  const [loginForm, setLoginForm] = useState({ email: "", password: "", totpCode: "" });
  const [resetRequestEmail, setResetRequestEmail] = useState("");
  const [resetConfirmForm, setResetConfirmForm] = useState({ token: "", password: "" });
  const [resetPreview, setResetPreview] = useState<{ previewToken: string | null; expiresAt: string | null } | null>(null);

  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: fetchSession,
    retry: false,
    refetchInterval: 60_000,
  });

  const authenticated = Boolean(sessionQuery.data?.authenticated);
  const currentUser = sessionQuery.data?.user ?? null;

  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
    enabled: authenticated,
    refetchInterval: 30_000,
  });

  const statusQuery = useQuery({
    queryKey: ["status"],
    queryFn: fetchStatus,
    enabled: authenticated,
    refetchInterval: 30_000,
  });

  const detailQuery = useQuery({
    queryKey: ["monitor", selectedMonitorId],
    queryFn: () => fetchMonitor(selectedMonitorId as string),
    enabled: authenticated && Boolean(selectedMonitorId),
  });

  const incidentsQuery = useQuery({
    queryKey: ["incidents"],
    queryFn: fetchIncidents,
    enabled: authenticated && view === "incidents",
  });

  const incidentDetailQuery = useQuery({
    queryKey: ["incident", selectedIncidentId],
    queryFn: () => fetchIncidentDetail(selectedIncidentId as string),
    enabled: authenticated && view === "incidents" && Boolean(selectedIncidentId),
  });

  const channelsQuery = useQuery({
    queryKey: ["notification-channels"],
    queryFn: fetchNotificationChannels,
    enabled: authenticated && view === "notifications",
  });

  const rulesQuery = useQuery({
    queryKey: ["notification-rules"],
    queryFn: fetchNotificationRules,
    enabled: authenticated && view === "notifications",
  });

  const maintenancesQuery = useQuery({
    queryKey: ["maintenances"],
    queryFn: fetchMaintenances,
    enabled: authenticated && view === "maintenance",
  });

  const statusPagesQuery = useQuery({
    queryKey: ["status-pages"],
    queryFn: fetchStatusPages,
    enabled: authenticated && view === "status-pages",
  });

  const apiKeysQuery = useQuery({
    queryKey: ["api-keys"],
    queryFn: fetchApiKeys,
    enabled: authenticated && view === "security",
  });

  const dashboardMonitors = useMemo(() => dashboardQuery.data?.monitors ?? [], [dashboardQuery.data?.monitors]);
  const selectedDetail = detailQuery.data ?? null;
  const incidentList = useMemo(() => incidentsQuery.data ?? [], [incidentsQuery.data]);

  useEffect(() => {
    if (!sessionQuery.data || sessionQuery.data.authenticated) {
      return;
    }

    if (!sessionQuery.data.bootstrap.hasUsers) {
      setAuthMode("bootstrap");
      return;
    }

    setAuthMode((current) => (current === "bootstrap" ? "login" : current));
  }, [sessionQuery.data]);

  useEffect(() => {
    if (!dashboardMonitors.length) {
      setSelectedMonitorId(null);
      return;
    }

    const selectedStillExists = selectedMonitorId ? dashboardMonitors.some((monitor) => monitor.id === selectedMonitorId) : false;

    if (!selectedStillExists) {
      setSelectedMonitorId(dashboardMonitors[0].id);
    }
  }, [dashboardMonitors, selectedMonitorId]);

  useEffect(() => {
    if (!incidentList.length) {
      setSelectedIncidentId(null);
      return;
    }

    const selectedStillExists = selectedIncidentId ? incidentList.some((incident) => incident.id === selectedIncidentId) : false;

    if (!selectedStillExists) {
      setSelectedIncidentId(incidentList[0].id);
    }
  }, [incidentList, selectedIncidentId]);

  useEffect(() => {
    if (!authenticated || typeof window === "undefined" || typeof EventSource === "undefined") {
      return;
    }

    const eventSource = new EventSource(`${getApiBaseUrl()}/stream`);
    const invalidate = () => {
      void queryClient.invalidateQueries();
    };

    eventSource.addEventListener("update", invalidate);
    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.removeEventListener("update", invalidate);
      eventSource.close();
    };
  }, [authenticated, queryClient]);

  const updateSession = (user: UserSession | null, hasUsers = true) => {
    queryClient.setQueryData(["session"], buildSessionData(user, hasUsers));
  };

  const refreshAll = () => {
    void queryClient.invalidateQueries();
  };

  const showErrorToast = (title: string, error: unknown) => {
    toast({
      title,
      description: error instanceof Error ? error.message : "Unexpected error.",
      variant: "destructive",
    });
  };

  const showSuccessToast = (title: string, description: string) => {
    toast({
      title,
      description,
    });
  };

  const bootstrapMutation = useMutation({
    mutationFn: bootstrapAdminApi,
    onSuccess: ({ user }) => {
      updateSession(user ?? null, true);
      setBootstrapForm({ email: "", name: "", password: "" });
      showSuccessToast("Admin account created", "The workspace is ready for production setup.");
      refreshAll();
    },
    onError: (error) => showErrorToast("Unable to bootstrap admin", error),
  });

  const loginMutation = useMutation({
    mutationFn: loginApi,
    onSuccess: ({ user }) => {
      updateSession(user ?? null, true);
      setLoginForm({ email: "", password: "", totpCode: "" });
      showSuccessToast("Signed in", "Your monitoring workspace is ready.");
      refreshAll();
    },
    onError: (error) => showErrorToast("Unable to sign in", error),
  });

  const logoutMutation = useMutation({
    mutationFn: logoutApi,
    onSuccess: () => {
      updateSession(null, sessionQuery.data?.bootstrap.hasUsers ?? true);
      queryClient.removeQueries({
        predicate: ({ queryKey }) => queryKey[0] !== "session",
      });
      setSelectedMonitorId(null);
      setSelectedIncidentId(null);
      setWorkspaceMode("detail");
      setEditorSeed(null);
      setView("dashboard");
      showSuccessToast("Signed out", "The operator workspace was closed.");
    },
    onError: (error) => showErrorToast("Unable to sign out", error),
  });

  const requestResetMutation = useMutation({
    mutationFn: requestPasswordResetApi,
    onSuccess: (result) => {
      setResetPreview(result);
      setResetConfirmForm((current) => ({
        ...current,
        token: result.previewToken ?? current.token,
      }));
      setAuthMode("reset-confirm");
      showSuccessToast("Reset token generated", "Use the preview token below to complete the password reset.");
    },
    onError: (error) => showErrorToast("Unable to request password reset", error),
  });

  const confirmResetMutation = useMutation({
    mutationFn: confirmPasswordResetApi,
    onSuccess: () => {
      setAuthMode("login");
      setResetPreview(null);
      setResetConfirmForm({ token: "", password: "" });
      showSuccessToast("Password updated", "You can sign in with the new password now.");
    },
    onError: (error) => showErrorToast("Unable to reset password", error),
  });

  const switchToDetail = () => {
    startTransition(() => {
      setWorkspaceMode("detail");
      setEditorSeed(null);
    });
  };

  const openCreate = (seed: CreateMonitorInput | null = null) => {
    startTransition(() => {
      setEditorSeed(seed);
      setWorkspaceMode("create");
    });
  };

  const openEdit = () => {
    if (!selectedDetail) {
      return;
    }

    startTransition(() => {
      setEditorSeed(toEditorPayload(selectedDetail));
      setWorkspaceMode("edit");
    });
  };

  const createMonitorMutation = useMutation({
    mutationFn: createMonitor,
    onSuccess: ({ monitor }) => {
      startTransition(() => {
        setSelectedMonitorId(monitor.id);
        setWorkspaceMode("detail");
        setEditorSeed(null);
      });
      refreshAll();
      showSuccessToast("Monitor created", `${monitor.name} is now scheduled for live checks.`);
    },
    onError: (error) => showErrorToast("Unable to create monitor", error),
  });

  const updateMonitorMutation = useMutation({
    mutationFn: ({ monitorId, payload }: { monitorId: string; payload: CreateMonitorInput }) => updateMonitorApi(monitorId, payload),
    onSuccess: ({ monitor }) => {
      startTransition(() => {
        setSelectedMonitorId(monitor.id);
        setWorkspaceMode("detail");
        setEditorSeed(null);
      });
      refreshAll();
      showSuccessToast("Monitor saved", `${monitor.name} was updated.`);
    },
    onError: (error) => showErrorToast("Unable to save monitor", error),
  });

  const sweepMutation = useMutation({
    mutationFn: runSyntheticSweep,
    onSuccess: () => {
      refreshAll();
      showSuccessToast("Sweep completed", "All active monitors were refreshed.");
    },
    onError: (error) => showErrorToast("Sweep failed", error),
  });

  const checkMutation = useMutation({
    mutationFn: (monitorId: string) => triggerMonitorCheckApi(monitorId),
    onSuccess: () => {
      refreshAll();
      showSuccessToast("Check completed", "The selected monitor just ran a live check.");
    },
    onError: (error) => showErrorToast("Check failed", error),
  });

  const toggleMonitorMutation = useMutation({
    mutationFn: ({ monitorId, paused }: { monitorId: string; paused: boolean }) => updateMonitorApi(monitorId, { paused }),
    onSuccess: ({ monitor }) => {
      refreshAll();
      showSuccessToast(monitor.paused ? "Monitor paused" : "Monitor resumed", `${monitor.name} is now ${monitor.paused ? "paused" : "active"} in the scheduler.`);
    },
    onError: (error) => showErrorToast("Unable to update monitor", error),
  });

  const deleteMonitorMutation = useMutation({
    mutationFn: deleteMonitorApi,
    onSuccess: () => {
      startTransition(() => {
        setSelectedMonitorId(null);
        setWorkspaceMode("detail");
        setEditorSeed(null);
      });
      refreshAll();
      showSuccessToast("Monitor deleted", "The monitor and its stored runtime history were removed.");
    },
    onError: (error) => showErrorToast("Delete failed", error),
  });

  const analyzeMutation = useMutation({
    mutationFn: (monitorId: string) => triggerMonitorAnalysisApi(monitorId),
    onSuccess: () => {
      refreshAll();
      showSuccessToast("Analysis refreshed", "A new Signal Analyst report has been stored.");
    },
    onError: (error) => showErrorToast("Analysis failed", error),
  });

  const slmSettingsMutation = useMutation({
    mutationFn: updateSlmSettingsApi,
    onSuccess: ({ settings, availability }) => {
      refreshAll();
      setIsSlmSettingsOpen(false);
      showSuccessToast(
        availability.reachable ? "SLM updated" : "SLM saved with fallback",
        availability.reachable ? `Signal Analyst is now using ${settings.model}.` : availability.reason ?? "The endpoint is not reachable yet.",
      );
    },
    onError: (error) => showErrorToast("Unable to save SLM settings", error),
  });

  const handleSubmitMonitor = (payload: CreateMonitorInput) => {
    if (workspaceMode === "edit" && selectedMonitorId) {
      updateMonitorMutation.mutate({ monitorId: selectedMonitorId, payload });
      return;
    }

    createMonitorMutation.mutate(payload);
  };

  const handleSelectMonitor = (monitorId: string) => {
    startTransition(() => {
      setSelectedMonitorId(monitorId);
      setWorkspaceMode("detail");
      setEditorSeed(null);
    });
  };

  const handleCloneMonitor = () => {
    if (!selectedDetail) {
      return;
    }

    openCreate({
      ...toEditorPayload(selectedDetail),
      name: `${selectedDetail.monitor.name} Copy`,
    });
  };

  const performAction = async <T,>(action: () => Promise<T>, successTitle: string, successDescription: string) => {
    try {
      const result = await action();
      refreshAll();
      showSuccessToast(successTitle, successDescription);
      return result;
    } catch (error) {
      showErrorToast(successTitle, error);
      throw error;
    }
  };

  const saveChannel = (payload: Record<string, unknown>) =>
    performAction(() => saveNotificationChannelApi(payload), "Channel saved", "Notification channel stored successfully.");

  const deleteChannel = (channelId: string) =>
    performAction(() => deleteNotificationChannelApi(channelId), "Channel deleted", "Notification channel removed.");

  const testChannel = (channelId: string) =>
    performAction(() => testNotificationChannelApi(channelId), "Test sent", "A delivery test was queued for this channel.");

  const saveRule = (payload: Record<string, unknown>) =>
    performAction(() => saveNotificationRuleApi(payload), "Rule saved", "Notification rule stored successfully.");

  const deleteRule = (ruleId: string) =>
    performAction(() => deleteNotificationRuleApi(ruleId), "Rule deleted", "Notification rule removed.");

  const saveMaintenance = (payload: Record<string, unknown>) =>
    performAction(() => saveMaintenanceApi(payload), "Maintenance saved", "Maintenance window stored successfully.");

  const deleteMaintenance = (maintenanceId: string) =>
    performAction(() => deleteMaintenanceApi(maintenanceId), "Maintenance deleted", "Maintenance window removed.");

  const saveStatusPage = (payload: Record<string, unknown>) =>
    performAction(() => saveStatusPageApi(payload), "Status page saved", "Public status page stored successfully.");

  const deleteStatusPage = (statusPageId: string) =>
    performAction(() => deleteStatusPageApi(statusPageId), "Status page deleted", "Public status page removed.");

  const createApiKey = async (payload: { label: string; scope: string }) => {
    const created = await createApiKeyApi(payload);
    refreshAll();
    showSuccessToast("API key created", "Copy the new token now before it is hidden.");
    return created as ApiKeyRecord;
  };

  const revokeApiKey = (apiKeyId: string) =>
    performAction(() => revokeApiKeyApi(apiKeyId), "API key revoked", "The selected API key was revoked.");

  const setupTotp = async () => {
    const setup = await setupTotpApi();
    showSuccessToast("TOTP secret generated", "Scan or copy the secret into your authenticator app.");
    return setup;
  };

  const enableTotp = async (code: string) => {
    await performAction(() => enableTotpApi(code), "Two-factor enabled", "TOTP is now required for future sign-ins.");
    updateSession(currentUser ? { ...currentUser, totpEnabled: true } : null, true);
  };

  const disableTotp = async () => {
    await performAction(() => disableTotpApi(), "Two-factor disabled", "TOTP is no longer required for sign-in.");
    updateSession(currentUser ? { ...currentUser, totpEnabled: false } : null, true);
  };

  const changePassword = (payload: { currentPassword: string; nextPassword: string }) =>
    performAction(() => changePasswordApi(payload), "Password updated", "Your account password was changed.");

  const renderAuthScreen = () => {
    const hasUsers = sessionQuery.data?.bootstrap.hasUsers ?? true;
    const activeMode = hasUsers ? authMode : "bootstrap";

    return (
      <div className="min-h-screen bg-[#090d13] px-5 py-6">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.05fr,0.95fr]">
          <section className={`${authCardClass} flex flex-col justify-between`}>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-emerald-300/75">Single-tenant production workspace</p>
              <h1 className="mt-4 text-[3rem] font-semibold text-white">Auto-Ops Sentinel</h1>
              <p className="mt-4 max-w-2xl text-sm leading-8 text-slate-400">
                Production monitoring, incident intelligence, stored RCA reports, public status pages, and a provider-aware Signal Analyst stack on top of PostgreSQL.
              </p>
            </div>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {[
                ["Real database", "PostgreSQL is the single source of truth for monitors, incidents, reports, and queries."],
                ["Automatic SLM reports", "Incident changes can trigger analysis, suggested fixes, and versioned artifacts."],
                ["Operator security", "Bootstrap admin auth, password reset, TOTP, sessions, and scoped API keys are built in."],
              ].map(([title, description]) => (
                <div key={title} className="rounded-[1.4rem] border border-white/8 bg-[#0b1118] p-4">
                  <p className="text-sm font-medium text-slate-100">{title}</p>
                  <p className="mt-2 text-sm leading-7 text-slate-400">{description}</p>
                </div>
              ))}
            </div>
          </section>

          <section className={authCardClass}>
            {hasUsers ? (
              <div className="flex flex-wrap gap-2">
                {[
                  ["login", "Sign In"],
                  ["reset-request", "Request Reset"],
                  ["reset-confirm", "Confirm Reset"],
                ].map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setAuthMode(mode as AuthMode)}
                    className={`rounded-full px-4 py-2 text-sm transition ${
                      activeMode === mode ? "bg-emerald-400 text-[#04110c]" : "border border-white/10 bg-white/[0.04] text-slate-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}

            {activeMode === "bootstrap" ? (
              <div className="mt-6 space-y-4">
                <div>
                  <h2 className="text-2xl font-semibold text-white">Create the first admin</h2>
                  <p className="mt-2 text-sm text-slate-400">This workspace has no operator account yet. Create the bootstrap admin to unlock the console.</p>
                </div>
                <Input className={authInputClass} value={bootstrapForm.name} onChange={(event) => setBootstrapForm((current) => ({ ...current, name: event.target.value }))} placeholder="Operator name" />
                <Input className={authInputClass} value={bootstrapForm.email} onChange={(event) => setBootstrapForm((current) => ({ ...current, email: event.target.value }))} placeholder="admin@example.com" />
                <Input className={authInputClass} type="password" value={bootstrapForm.password} onChange={(event) => setBootstrapForm((current) => ({ ...current, password: event.target.value }))} placeholder="Strong password" />
                <Button className="w-full rounded-full bg-emerald-400 text-[#04110c] hover:bg-emerald-300" disabled={bootstrapMutation.isPending} onClick={() => bootstrapMutation.mutate(bootstrapForm)}>
                  {bootstrapMutation.isPending ? "Creating Admin" : "Create Admin Account"}
                </Button>
              </div>
            ) : null}

            {activeMode === "login" ? (
              <div className="mt-6 space-y-4">
                <div>
                  <h2 className="text-2xl font-semibold text-white">Sign in</h2>
                  <p className="mt-2 text-sm text-slate-400">Open the private operator console to manage monitors, incidents, notifications, and SLM settings.</p>
                </div>
                <Input className={authInputClass} value={loginForm.email} onChange={(event) => setLoginForm((current) => ({ ...current, email: event.target.value }))} placeholder="admin@example.com" />
                <Input className={authInputClass} type="password" value={loginForm.password} onChange={(event) => setLoginForm((current) => ({ ...current, password: event.target.value }))} placeholder="Password" />
                <Input className={authInputClass} value={loginForm.totpCode} onChange={(event) => setLoginForm((current) => ({ ...current, totpCode: event.target.value }))} placeholder="TOTP code (only if enabled)" />
                <Button className="w-full rounded-full bg-emerald-400 text-[#04110c] hover:bg-emerald-300" disabled={loginMutation.isPending} onClick={() => loginMutation.mutate(loginForm)}>
                  {loginMutation.isPending ? "Signing In" : "Sign In"}
                </Button>
              </div>
            ) : null}

            {activeMode === "reset-request" ? (
              <div className="mt-6 space-y-4">
                <div>
                  <h2 className="text-2xl font-semibold text-white">Request password reset</h2>
                  <p className="mt-2 text-sm text-slate-400">The backend returns a preview token for local development so you can finish the reset flow without email delivery.</p>
                </div>
                <Input className={authInputClass} value={resetRequestEmail} onChange={(event) => setResetRequestEmail(event.target.value)} placeholder="admin@example.com" />
                <Button className="w-full rounded-full bg-emerald-400 text-[#04110c] hover:bg-emerald-300" disabled={requestResetMutation.isPending} onClick={() => requestResetMutation.mutate(resetRequestEmail)}>
                  {requestResetMutation.isPending ? "Requesting" : "Generate Reset Token"}
                </Button>
                {resetPreview ? (
                  <div className="rounded-[1.3rem] border border-amber-300/15 bg-amber-400/10 px-4 py-4 text-sm text-amber-50">
                    <p className="font-medium">Preview token</p>
                    <p className="mt-2 break-all font-mono text-xs">{resetPreview.previewToken ?? "No preview token returned."}</p>
                    <p className="mt-2 text-xs text-amber-100/70">
                      Expires {resetPreview.expiresAt ? new Date(resetPreview.expiresAt).toLocaleString() : "soon"}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {activeMode === "reset-confirm" ? (
              <div className="mt-6 space-y-4">
                <div>
                  <h2 className="text-2xl font-semibold text-white">Confirm password reset</h2>
                  <p className="mt-2 text-sm text-slate-400">Paste the reset token and set the new password for the operator account.</p>
                </div>
                <Input className={authInputClass} value={resetConfirmForm.token} onChange={(event) => setResetConfirmForm((current) => ({ ...current, token: event.target.value }))} placeholder="Reset token" />
                <Input className={authInputClass} type="password" value={resetConfirmForm.password} onChange={(event) => setResetConfirmForm((current) => ({ ...current, password: event.target.value }))} placeholder="New password" />
                <Button
                  className="w-full rounded-full bg-emerald-400 text-[#04110c] hover:bg-emerald-300"
                  disabled={confirmResetMutation.isPending}
                  onClick={() => confirmResetMutation.mutate(resetConfirmForm)}
                >
                  {confirmResetMutation.isPending ? "Updating Password" : "Complete Reset"}
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      </div>
    );
  };

  const renderDashboard = () => (
    <div className="mx-auto max-w-[1720px] lg:grid lg:min-h-[calc(100vh-220px)] lg:grid-cols-[320px,minmax(0,1fr)]">
      <MonitorSidebar monitors={dashboardMonitors} selectedId={selectedMonitorId} onAddClick={() => openCreate()} onSelect={handleSelectMonitor} />

      <AnimatePresence mode="wait" initial={false}>
        {workspaceMode === "create" || workspaceMode === "edit" ? (
          <AddMonitorForm
            key={`editor-${workspaceMode}`}
            mode={workspaceMode}
            initialValue={editorSeed}
            isSubmitting={createMonitorMutation.isPending || updateMonitorMutation.isPending}
            onCancel={switchToDetail}
            onSubmit={handleSubmitMonitor}
          />
        ) : (
          <MonitorDetailView
            key={selectedMonitorId ?? "detail-empty"}
            detail={selectedDetail}
            status={statusQuery.data}
            isLoading={detailQuery.isLoading && Boolean(selectedMonitorId)}
            isChecking={checkMutation.isPending}
            isUpdating={toggleMonitorMutation.isPending}
            isAnalyzing={analyzeMutation.isPending}
            onDelete={() => {
              if (selectedMonitorId) {
                deleteMonitorMutation.mutate(selectedMonitorId);
              }
            }}
            onEdit={openEdit}
            onClone={handleCloneMonitor}
            onRunCheck={() => {
              if (selectedMonitorId) {
                checkMutation.mutate(selectedMonitorId);
              }
            }}
            onTogglePause={() => {
              if (selectedDetail?.monitor) {
                toggleMonitorMutation.mutate({
                  monitorId: selectedDetail.monitor.id,
                  paused: !selectedDetail.monitor.paused,
                });
              }
            }}
            onAnalyze={() => {
              if (selectedMonitorId) {
                analyzeMutation.mutate(selectedMonitorId);
              }
            }}
            onAsk={(question) => askOpsQuestion(question, selectedMonitorId, null)}
          />
        )}
      </AnimatePresence>
    </div>
  );

  const renderMainView = () => {
    if (view === "dashboard") {
      return renderDashboard();
    }

    if (view === "incidents") {
      return (
        <div className="mx-auto max-w-[1720px] px-5 py-6">
          <IncidentCenter
            incidents={incidentList}
            selectedIncidentId={selectedIncidentId}
            detail={incidentDetailQuery.data}
            isLoading={incidentsQuery.isLoading || incidentDetailQuery.isLoading}
            onSelect={setSelectedIncidentId}
            onAsk={(question, incidentId) => askOpsQuestion(question, null, incidentId)}
          />
        </div>
      );
    }

    if (view === "notifications") {
      return (
        <div className="mx-auto max-w-[1720px] px-5 py-6">
          <NotificationCenter
            channels={channelsQuery.data ?? []}
            rules={rulesQuery.data ?? []}
            monitors={dashboardMonitors}
            onSaveChannel={saveChannel}
            onDeleteChannel={deleteChannel}
            onTestChannel={testChannel}
            onSaveRule={saveRule}
            onDeleteRule={deleteRule}
          />
        </div>
      );
    }

    if (view === "maintenance") {
      return (
        <div className="mx-auto max-w-[1720px] px-5 py-6">
          <MaintenanceCenter maintenances={maintenancesQuery.data ?? []} monitors={dashboardMonitors} onSave={saveMaintenance} onDelete={deleteMaintenance} />
        </div>
      );
    }

    if (view === "status-pages") {
      return (
        <div className="mx-auto max-w-[1720px] px-5 py-6">
          <StatusPagesCenter pages={statusPagesQuery.data ?? []} monitors={dashboardMonitors} onSave={saveStatusPage} onDelete={deleteStatusPage} />
        </div>
      );
    }

    return (
      <div className="mx-auto max-w-[1720px] px-5 py-6">
        <SecurityCenter
          currentUser={currentUser as UserSession}
          apiKeys={apiKeysQuery.data ?? []}
          status={statusQuery.data}
          onOpenSlmSettings={() => setIsSlmSettingsOpen(true)}
          onCreateApiKey={createApiKey}
          onRevokeApiKey={revokeApiKey}
          onSetupTotp={setupTotp}
          onEnableTotp={enableTotp}
          onDisableTotp={disableTotp}
          onChangePassword={changePassword}
        />
      </div>
    );
  };

  if (sessionQuery.isLoading && !sessionQuery.data) {
    return (
      <div className="min-h-screen bg-[#090d13] px-5 py-6">
        <div className="mx-auto max-w-6xl animate-pulse space-y-5">
          <div className="h-40 rounded-[2rem] bg-[#11161f]" />
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="h-[60vh] rounded-[2rem] bg-[#11161f]" />
            <div className="h-[60vh] rounded-[2rem] bg-[#11161f]" />
          </div>
        </div>
      </div>
    );
  }

  if (!authenticated || !currentUser) {
    return renderAuthScreen();
  }

  if (dashboardQuery.isLoading || statusQuery.isLoading || !dashboardQuery.data || !statusQuery.data) {
    return (
      <div className="min-h-screen bg-[#090d13] px-5 py-6">
        <div className="mx-auto max-w-[1720px] animate-pulse space-y-4">
          <div className="h-40 rounded-[2rem] bg-[#11161f]" />
          <div className="grid gap-4 lg:grid-cols-[320px,minmax(0,1fr)]">
            <div className="h-[78vh] rounded-[2rem] bg-[#11161f]" />
            <div className="h-[78vh] rounded-[2rem] bg-[#11161f]" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#090d13]">
      <Header
        summary={dashboardQuery.data.summary}
        status={statusQuery.data}
        currentUser={currentUser}
        view={view}
        onChangeView={setView}
        isSweeping={sweepMutation.isPending}
        onSweep={() => sweepMutation.mutate()}
        onOpenSlmSettings={() => setIsSlmSettingsOpen(true)}
        onLogout={() => logoutMutation.mutate()}
      />

      <SlmSettingsDialog
        open={isSlmSettingsOpen}
        onOpenChange={setIsSlmSettingsOpen}
        status={statusQuery.data}
        isSaving={slmSettingsMutation.isPending}
        onSave={(payload) => slmSettingsMutation.mutate(payload)}
      />

      {renderMainView()}
    </div>
  );
};

export default Workspace;
