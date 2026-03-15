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
import { SlmSettingsDialog } from "@/components/SlmSettingsDialog";
import { StatusPagesCenter } from "@/components/StatusPagesCenter";
import { useToast } from "@/hooks/use-toast";
import {
  askOpsQuestion,
  createMonitor,
  deleteMaintenanceApi,
  deleteMonitorApi,
  deleteNotificationChannelApi,
  deleteNotificationRuleApi,
  deleteStatusPageApi,
  fetchDashboard,
  fetchIncidentDetail,
  fetchIncidents,
  fetchMaintenances,
  fetchMonitor,
  fetchNotificationChannels,
  fetchNotificationRules,
  fetchStatus,
  fetchStatusPages,
  getApiBaseUrl,
  runSyntheticSweep,
  saveMaintenanceApi,
  saveNotificationChannelApi,
  saveNotificationRuleApi,
  saveStatusPageApi,
  testNotificationChannelApi,
  triggerMonitorAnalysisApi,
  triggerMonitorCheckApi,
  updateMonitorApi,
  updateSlmSettingsApi,
} from "@/api/monitors";
import type { CreateMonitorInput, MonitorDetailPayload } from "@/types/monitoring";

type WorkspaceMode = "detail" | "create" | "edit";
type AppView = "dashboard" | "incidents" | "notifications" | "maintenance" | "status-pages";

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

const ConsoleApp = () => {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedMonitorId, setSelectedMonitorId] = useState<string | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("detail");
  const [editorSeed, setEditorSeed] = useState<CreateMonitorInput | null>(null);
  const [view, setView] = useState<AppView>("dashboard");
  const [isSlmSettingsOpen, setIsSlmSettingsOpen] = useState(false);

  const dashboardQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: fetchDashboard,
    refetchInterval: 30_000,
    retry: false,
  });

  const statusQuery = useQuery({
    queryKey: ["status"],
    queryFn: fetchStatus,
    refetchInterval: 30_000,
    retry: false,
  });

  const detailQuery = useQuery({
    queryKey: ["monitor", selectedMonitorId],
    queryFn: () => fetchMonitor(selectedMonitorId as string),
    enabled: Boolean(selectedMonitorId),
  });

  const incidentsQuery = useQuery({
    queryKey: ["incidents"],
    queryFn: fetchIncidents,
    enabled: view === "incidents",
  });

  const incidentDetailQuery = useQuery({
    queryKey: ["incident", selectedIncidentId],
    queryFn: () => fetchIncidentDetail(selectedIncidentId as string),
    enabled: view === "incidents" && Boolean(selectedIncidentId),
  });

  const channelsQuery = useQuery({
    queryKey: ["notification-channels"],
    queryFn: fetchNotificationChannels,
    enabled: view === "notifications",
  });

  const rulesQuery = useQuery({
    queryKey: ["notification-rules"],
    queryFn: fetchNotificationRules,
    enabled: view === "notifications",
  });

  const maintenancesQuery = useQuery({
    queryKey: ["maintenances"],
    queryFn: fetchMaintenances,
    enabled: view === "maintenance",
  });

  const statusPagesQuery = useQuery({
    queryKey: ["status-pages"],
    queryFn: fetchStatusPages,
    enabled: view === "status-pages",
  });

  const dashboardMonitors = useMemo(() => dashboardQuery.data?.monitors ?? [], [dashboardQuery.data?.monitors]);
  const incidentList = useMemo(() => incidentsQuery.data ?? [], [incidentsQuery.data]);
  const selectedDetail = detailQuery.data ?? null;

  useEffect(() => {
    if (!dashboardMonitors.length) {
      setSelectedMonitorId(null);
      return;
    }

    if (!selectedMonitorId || !dashboardMonitors.some((monitor) => monitor.id === selectedMonitorId)) {
      setSelectedMonitorId(dashboardMonitors[0].id);
    }
  }, [dashboardMonitors, selectedMonitorId]);

  useEffect(() => {
    if (!incidentList.length) {
      setSelectedIncidentId(null);
      return;
    }

    if (!selectedIncidentId || !incidentList.some((incident) => incident.id === selectedIncidentId)) {
      setSelectedIncidentId(incidentList[0].id);
    }
  }, [incidentList, selectedIncidentId]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
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
  }, [queryClient]);

  const refreshAll = () => {
    void queryClient.invalidateQueries();
  };

  const showSuccessToast = (title: string, description: string) => {
    toast({ title, description });
  };

  const showErrorToast = (title: string, error: unknown) => {
    toast({
      title,
      description: error instanceof Error ? error.message : "Unexpected error.",
      variant: "destructive",
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

  const handleCloneMonitor = () => {
    if (!selectedDetail) {
      return;
    }

    openCreate({
      ...toEditorPayload(selectedDetail),
      name: `${selectedDetail.monitor.name} Copy`,
    });
  };

  const handleSelectMonitor = (monitorId: string) => {
    startTransition(() => {
      setSelectedMonitorId(monitorId);
      setWorkspaceMode("detail");
      setEditorSeed(null);
    });
  };

  const hasBootstrapError = dashboardQuery.isError || statusQuery.isError;
  const bootstrapErrorMessage =
    (dashboardQuery.error instanceof Error ? dashboardQuery.error.message : null) ??
    (statusQuery.error instanceof Error ? statusQuery.error.message : null) ??
    "Unable to load the monitoring workspace.";

  if (dashboardQuery.isLoading || statusQuery.isLoading || !dashboardQuery.data || !statusQuery.data) {
    if (hasBootstrapError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#090d13] px-5 py-6">
          <div className="max-w-2xl rounded-[2rem] border border-rose-300/15 bg-[#11161f] px-8 py-10 text-center">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-rose-300/70">Workspace unavailable</p>
            <h1 className="mt-3 text-3xl font-semibold text-white">The dashboard could not reach the backend.</h1>
            <p className="mt-3 text-sm leading-7 text-slate-400">{bootstrapErrorMessage}</p>
            <p className="mt-3 text-sm leading-7 text-slate-500">
              The app will try `/api` first and then fall back to port {import.meta.env.VITE_BACKEND_PORT ?? import.meta.env.SENTINEL_PORT ?? "8787"} on this machine.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  void dashboardQuery.refetch();
                  void statusQuery.refetch();
                }}
                className="rounded-full bg-emerald-400 px-5 py-2 text-sm font-medium text-[#04110c] hover:bg-emerald-300"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-full border border-white/10 bg-white/[0.04] px-5 py-2 text-sm text-slate-200 hover:bg-white/[0.08]"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

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
        view={view}
        onChangeView={(next) => {
          if (next !== "security") {
            setView(next);
          }
        }}
        isSweeping={sweepMutation.isPending}
        onSweep={() => sweepMutation.mutate()}
        onOpenSlmSettings={() => setIsSlmSettingsOpen(true)}
        showSecurity={false}
      />

      <SlmSettingsDialog
        open={isSlmSettingsOpen}
        onOpenChange={setIsSlmSettingsOpen}
        status={statusQuery.data}
        isSaving={slmSettingsMutation.isPending}
        onSave={(payload) => slmSettingsMutation.mutate(payload)}
      />

      {view === "dashboard" ? (
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
      ) : null}

      {view === "incidents" ? (
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
      ) : null}

      {view === "notifications" ? (
        <div className="mx-auto max-w-[1720px] px-5 py-6">
          <NotificationCenter
            channels={channelsQuery.data ?? []}
            rules={rulesQuery.data ?? []}
            monitors={dashboardMonitors}
            onSaveChannel={(payload) => performAction(() => saveNotificationChannelApi(payload), "Channel saved", "Notification channel stored successfully.")}
            onDeleteChannel={(channelId) => performAction(() => deleteNotificationChannelApi(channelId), "Channel deleted", "Notification channel removed.")}
            onTestChannel={(channelId) => performAction(() => testNotificationChannelApi(channelId), "Test sent", "A delivery test was queued for this channel.")}
            onSaveRule={(payload) => performAction(() => saveNotificationRuleApi(payload), "Rule saved", "Notification rule stored successfully.")}
            onDeleteRule={(ruleId) => performAction(() => deleteNotificationRuleApi(ruleId), "Rule deleted", "Notification rule removed.")}
          />
        </div>
      ) : null}

      {view === "maintenance" ? (
        <div className="mx-auto max-w-[1720px] px-5 py-6">
          <MaintenanceCenter
            maintenances={maintenancesQuery.data ?? []}
            monitors={dashboardMonitors}
            onSave={(payload) => performAction(() => saveMaintenanceApi(payload), "Maintenance saved", "Maintenance window stored successfully.")}
            onDelete={(maintenanceId) => performAction(() => deleteMaintenanceApi(maintenanceId), "Maintenance deleted", "Maintenance window removed.")}
          />
        </div>
      ) : null}

      {view === "status-pages" ? (
        <div className="mx-auto max-w-[1720px] px-5 py-6">
          <StatusPagesCenter
            pages={statusPagesQuery.data ?? []}
            monitors={dashboardMonitors}
            onSave={(payload) => performAction(() => saveStatusPageApi(payload), "Status page saved", "Public status page stored successfully.")}
            onDelete={(statusPageId) => performAction(() => deleteStatusPageApi(statusPageId), "Status page deleted", "Public status page removed.")}
          />
        </div>
      ) : null}
    </div>
  );
};

export default ConsoleApp;
