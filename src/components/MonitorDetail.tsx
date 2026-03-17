import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BrainCircuit, ChevronDown, Copy, ExternalLink, LoaderCircle, Pause, Play, RefreshCw, Shield, SquarePen, Trash2 } from "lucide-react";
import { motion } from "framer-motion";

import { HeartbeatBar } from "@/components/HeartbeatBar";
import { LatencyChart } from "@/components/LatencyChart";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AskOpsResponse, MonitorAnalysis, MonitorCheck, MonitorDetailPayload, MonitorStatus, StatusPayload } from "@/types/monitoring";

interface MonitorDetailViewProps {
  detail: MonitorDetailPayload | null | undefined;
  status?: StatusPayload;
  isLoading: boolean;
  isChecking: boolean;
  isUpdating: boolean;
  isAnalyzing: boolean;
  onDelete: () => void;
  onEdit: () => void;
  onClone: () => void;
  onRunCheck: () => void;
  onTogglePause: () => void;
  onAnalyze: () => void;
  onAsk: (question: string) => Promise<AskOpsResponse>;
}

interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: string[];
}

const statusPanelClass = (status: MonitorStatus) => {
  if (status === "up") return "border-emerald-300/20 bg-emerald-400 text-[#07120d]";
  if (status === "degraded") return "border-amber-300/20 bg-amber-300 text-[#1a1205]";
  if (status === "down") return "border-rose-300/20 bg-rose-400 text-[#17070d]";
  return "border-slate-600/30 bg-slate-600 text-white";
};

const formatTimestamp = (value: string | null) => (value ? new Date(value).toLocaleString() : "Never");

const responseStats = (checks: MonitorCheck[]) => {
  const successful = checks.filter((check) => check.latencyMs > 0);
  const latencies = successful.map((check) => check.latencyMs);

  if (latencies.length === 0) {
    return { current: 0, average: 0, high: 0, low: 0 };
  }

  return {
    current: successful[0]?.latencyMs ?? 0,
    average: Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length),
    high: Math.max(...latencies),
    low: Math.min(...latencies),
  };
};

const confidenceLabel = (analysis: MonitorAnalysis | null) => {
  if (!analysis) return "Waiting";
  if (analysis.confidence >= 0.85) return "High confidence";
  if (analysis.confidence >= 0.65) return "Medium confidence";
  return "Low confidence";
};

export const MonitorDetailView = ({
  detail,
  status,
  isLoading,
  isChecking,
  isUpdating,
  isAnalyzing,
  onDelete,
  onEdit,
  onClone,
  onRunCheck,
  onTogglePause,
  onAnalyze,
  onAsk,
}: MonitorDetailViewProps) => {
  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [chatHistory, setChatHistory] = useState<ChatTurn[]>([]);
  const selectedMonitorName = detail?.monitor.name ?? "this monitor";
  const selectedMonitorStatus = detail?.monitor.status ?? "pending";

  const activeMonitorId = detail?.monitor.id;

  useEffect(() => {
    if (!activeMonitorId) {
      setChatHistory([]);
      return;
    }

    setChatHistory([
      {
        id: `seed-${activeMonitorId}`,
        role: "assistant",
        content: `Ask what happened, why the monitor is reporting issues, or what the stored incident reports recommend next.`,
      },
    ]);
  }, [activeMonitorId]);

  const submitQuestion = async (prompt?: string) => {
    const nextQuestion = String(prompt ?? question).trim();
    if (!nextQuestion) return;

    setIsAsking(true);
    try {
      const answer = await onAsk(nextQuestion);
      setChatHistory((current) => [
        ...current,
        { id: `user-${Date.now()}`, role: "user", content: nextQuestion },
        { id: `assistant-${Date.now() + 1}`, role: "assistant", content: answer.answer, citations: answer.citations },
      ]);
      setQuestion("");
    } catch (error) {
      setChatHistory((current) => [
        ...current,
        { id: `user-${Date.now()}`, role: "user", content: nextQuestion },
        { id: `assistant-${Date.now() + 1}`, role: "assistant", content: error instanceof Error ? error.message : "Signal Analyst could not answer right now." },
      ]);
    } finally {
      setIsAsking(false);
    }
  };

  const statSnapshot = useMemo(() => (detail ? responseStats(detail.recentChecks) : responseStats([])), [detail]);

  if (isLoading) {
    return (
      <div className="bg-[#090d13] px-5 py-6">
        <div className="mx-auto max-w-[1320px] animate-pulse space-y-5">
          <div className="h-24 rounded-[2rem] bg-[#11161f]" />
          <div className="h-44 rounded-[2rem] bg-[#11161f]" />
          <div className="h-32 rounded-[2rem] bg-[#11161f]" />
        </div>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#090d13] px-5 py-6">
        <div className="max-w-xl rounded-[2rem] border border-dashed border-white/10 bg-[#11161f] px-8 py-12 text-center">
          <h2 className="text-3xl font-semibold text-white">Select a monitor</h2>
          <p className="mt-3 text-sm leading-7 text-slate-400">Pick a monitor from the left to inspect checks, reports, incidents, and stored SLM analysis.</p>
        </div>
      </div>
    );
  }

  const { monitor, recentChecks, incidentHistory, recentEvents, reportHistory, latestCertificate } = detail;
  const latestIncident = monitor.openIncident ?? incidentHistory[0] ?? null;
  const analysis = detail.latestAnalysis ?? detail.monitor.latestAnalysis ?? null;

  return (
    <motion.section
      key={monitor.id}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
      className="min-h-0 overflow-y-auto bg-[#090d13] px-5 py-6"
    >
      <div className="mx-auto max-w-[1320px] space-y-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-slate-500">
              {monitor.id} - {monitor.type}
            </p>
            <h2 className="mt-2 font-display text-[3rem] font-semibold text-white">{monitor.name}</h2>
            <a
              href={monitor.url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex max-w-full items-center gap-2 truncate text-[1.2rem] font-medium text-emerald-300 transition hover:text-emerald-200"
            >
              {monitor.url}
              <ExternalLink className="h-5 w-5 shrink-0" />
            </a>
            <p className="mt-4 max-w-4xl text-sm leading-7 text-slate-400">{monitor.description || monitor.summary}</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button variant="outline" size="sm" className="h-9 rounded-full border-white/10 bg-[#11161f] px-4 text-xs font-medium text-slate-200 hover:bg-white/[0.06]" onClick={onTogglePause} disabled={isUpdating}>
              {monitor.paused ? <Play className="mr-1.5 h-3.5 w-3.5" /> : <Pause className="mr-1.5 h-3.5 w-3.5" />}
              {monitor.paused ? "Resume" : "Pause"}
            </Button>
            <Button variant="outline" size="sm" className="h-9 rounded-full border-white/10 bg-[#11161f] px-4 text-xs font-medium text-slate-200 hover:bg-white/[0.06]" onClick={onEdit}>
              <SquarePen className="mr-1.5 h-3.5 w-3.5" />
              Edit
            </Button>
            <Button variant="outline" size="sm" className="h-9 rounded-full border-white/10 bg-[#11161f] px-4 text-xs font-medium text-slate-200 hover:bg-white/[0.06]" onClick={onClone}>
              <Copy className="mr-1.5 h-3.5 w-3.5" />
              Clone
            </Button>
            <Button variant="outline" size="sm" className="h-9 rounded-full border-white/10 bg-[#11161f] px-4 text-xs font-medium text-slate-200 hover:bg-white/[0.06]" onClick={onRunCheck} disabled={isChecking}>
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isChecking ? "animate-spin" : ""}`} />
              {isChecking ? "Checking" : "Check Now"}
            </Button>
            <Button variant="outline" size="sm" className="h-9 rounded-full border-white/10 bg-[#11161f] px-4 text-xs font-medium text-slate-200 hover:bg-white/[0.06]" onClick={onAnalyze} disabled={isAnalyzing}>
              {isAnalyzing ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <BrainCircuit className="mr-1.5 h-3.5 w-3.5" />}
              {isAnalyzing ? "Analyzing" : "Refresh Analysis"}
            </Button>
            <Button variant="outline" size="sm" className="h-9 rounded-full border-rose-300/10 bg-[#11161f] px-4 text-xs font-medium text-rose-300 hover:bg-rose-500/10 hover:text-rose-200" onClick={onDelete}>
              <Trash2 className="mr-1.5 h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
        </div>

        <section className="rounded-[2rem] border border-white/8 bg-[#11161f] px-6 py-7">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr),164px] xl:items-center">
            <div>
              <HeartbeatBar heartbeats={monitor.recentHeartbeats} maxBars={42} height={32} />
              <p className="mt-4 text-lg text-slate-300">
                Checks every {monitor.intervalSeconds}s - next due {formatTimestamp(monitor.nextCheckAt ?? null)}
              </p>
            </div>
            <div className={`flex min-h-[72px] items-center justify-center rounded-[1.6rem] border px-6 text-[1.9rem] font-semibold ${statusPanelClass(monitor.status)}`}>
              {monitor.status === "up" ? "Up" : monitor.status === "down" ? "Down" : monitor.status === "degraded" ? "Slow" : "New"}
            </div>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-6">
          {[
            ["Type", monitor.type.toUpperCase(), monitor.environment],
            ["Response", statSnapshot.current ? `${statSnapshot.current}ms` : "N/A", "current"],
            ["Avg. Response", statSnapshot.average ? `${statSnapshot.average}ms` : "N/A", "24 hours"],
            ["Uptime", `${monitor.uptime24h.toFixed(2)}%`, "24 hours"],
            ["Checks Logged", `${detail.historyTotals.checks}`, "stored"],
            ["Analysis", analysis ? confidenceLabel(analysis) : "Pending", analysis ? `${analysis.provider ?? analysis.mode}` : "not run"],
          ].map(([label, value, sublabel]) => (
            <div key={`${label}-${sublabel}`} className="rounded-[1.7rem] border border-white/8 bg-[#11161f] px-5 py-5">
              <p className="text-[2rem] font-semibold leading-tight text-slate-100">{label}</p>
              <p className="mt-2 text-lg text-slate-500">{sublabel}</p>
              <p className="mt-6 text-[1.7rem] font-medium text-slate-50">{value}</p>
            </div>
          ))}
        </div>

        <LatencyChart heartbeats={recentChecks} monitorName={monitor.name} />

        <div className="mx-auto max-w-5xl space-y-6">
          <details className="group relative overflow-hidden rounded-[2rem] border border-emerald-500/15 bg-gradient-to-b from-[#11161f] to-[#0a120f] shadow-2xl shadow-emerald-900/10 [&_summary::-webkit-details-marker]:hidden">
            <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-emerald-500/10 blur-[80px]" />
            <summary className="relative z-10 flex cursor-pointer items-center justify-between p-5 transition-colors hover:bg-emerald-500/5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 backdrop-blur-md">
                  <BrainCircuit className="h-4 w-4" />
                </div>
                <h3 className="text-xl font-semibold text-emerald-50">Signal Analyst</h3>
              </div>
              <div className="flex items-center gap-4">
                <div className="hidden sm:inline-flex w-fit items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 shadow-[0_0_15px_rgba(16,185,129,0.15)_inset]">
                  {status?.slm.reachable ? "Live" : "Fallback"} • {analysis?.model ?? status?.slm.model ?? "pending"}
                </div>
                <ChevronDown className="h-5 w-5 text-emerald-500/60 transition-transform group-open:rotate-180" />
              </div>
            </summary>

            <div className="relative z-10 border-t border-emerald-500/10 px-5 pb-5 pt-0">
              {analysis ? (
                <div className="mt-5 space-y-5">
                  <div className="rounded-[1.4rem] border border-emerald-300/20 bg-emerald-400/10 px-5 py-5 shadow-[0_0_20px_rgba(16,185,129,0.05)_inset] backdrop-blur-sm">
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-300/80">
                      {confidenceLabel(analysis)}
                    </p>
                    <h4 className="mt-2 text-lg font-semibold leading-snug text-emerald-50">{analysis.reportSummary}</h4>
                    <p className="mt-3 text-sm leading-relaxed text-emerald-100/80">{analysis.probableRootCause}</p>
                  </div>

                  {analysis.reasoning ? (
                    <details className="group rounded-[1.2rem] border border-emerald-500/20 bg-[#0b1118]/80 backdrop-blur-sm [&_summary::-webkit-details-marker]:hidden">
                      <summary className="flex cursor-pointer items-center justify-between p-4 transition-colors hover:bg-emerald-500/5">
                        <p className="text-sm font-medium leading-none text-emerald-100">Analyst Reasoning</p>
                        <ChevronDown className="h-4 w-4 text-emerald-500/60 transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="border-t border-emerald-500/10 px-4 pb-4 pt-3">
                        <p className="text-sm leading-relaxed text-emerald-100/70">{analysis.reasoning}</p>
                      </div>
                    </details>
                  ) : null}

                  <div className="space-y-4">
                    <div className="rounded-[1.2rem] border border-emerald-500/10 bg-[#0b1118]/80 p-4 backdrop-blur-sm">
                      <p className="text-sm font-medium text-emerald-100">Evidence</p>
                      <div className="mt-3 space-y-2">
                        {analysis.facts.map((fact) => (
                          <div key={fact} className="rounded-[0.8rem] border border-emerald-500/10 bg-emerald-500/5 px-3 py-2 text-xs leading-5 text-emerald-100/70">
                            {fact}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-[1.2rem] border border-emerald-500/10 bg-[#0b1118]/80 p-4 backdrop-blur-sm">
                      <p className="text-sm font-medium text-emerald-100">Fixes</p>
                      <div className="mt-3 space-y-2">
                        {analysis.suggestedFixes.map((fix) => (
                          <div key={fix} className="rounded-[0.8rem] border border-emerald-500/10 bg-emerald-500/5 px-3 py-2 text-xs leading-5 text-emerald-100/70">
                            {fix}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[1.2rem] border border-emerald-500/10 bg-[#0b1118]/80 p-4 backdrop-blur-sm">
                    <p className="text-sm font-medium text-emerald-100">Chat Analyst</p>
                    <Textarea
                      value={question}
                      onChange={(event) => setQuestion(event.target.value)}
                      placeholder="Ask the Analyst..."
                      className="mt-3 min-h-[80px] rounded-xl border-emerald-500/10 bg-[#060a0f] px-3 py-2 text-xs text-emerald-50 focus-visible:ring-emerald-500/30"
                    />
                    <Button className="mt-3 h-9 w-full rounded-full bg-emerald-500 text-xs font-semibold text-emerald-950 shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-400" onClick={() => void submitQuestion()} disabled={isAsking} type="button">
                      {isAsking ? <LoaderCircle className="mr-2 h-3 w-3 animate-spin" /> : <BrainCircuit className="mr-2 h-3 w-3" />}
                      {isAsking ? "Thinking" : "Ask"}
                    </Button>

                    <div className="mt-5 space-y-3">
                      {chatHistory.map((turn) => (
                        <div key={turn.id} className={`rounded-2xl border px-4 py-3 text-xs leading-relaxed ${turn.role === "assistant" ? "-ml-1 border-emerald-500/10 bg-emerald-500/5 text-emerald-50" : "ml-4 border-white/5 bg-[#111823] text-slate-100"}`}>
                          <p className="mb-2 font-mono text-[9px] uppercase tracking-[0.2em] opacity-50">{turn.role === "assistant" ? "Analyst" : "You"}</p>
                          <p>{turn.content}</p>
                          {turn.citations?.length ? <p className="mt-3 border-t border-emerald-500/10 pt-2 text-[10px] opacity-60">Sources: {turn.citations.join(", ")}</p> : null}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-dashed border-emerald-500/20 bg-emerald-500/5 px-4 py-8 text-center text-xs text-emerald-200/50">
                  No analysis available yet.
                </div>
              )}
            </div>
          </details>

          {latestIncident ? (
            <details open className="group rounded-[2rem] border border-amber-300/15 bg-[#11161f] [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer items-center justify-between p-6 hover:bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-400/10">
                    <AlertTriangle className="h-4 w-4 text-amber-300" />
                  </div>
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200/50">
                      {latestIncident.severity} incident
                    </p>
                    <h3 className="text-xl font-semibold text-white">Active Incident: {latestIncident.status}</h3>
                  </div>
                </div>
                <ChevronDown className="h-5 w-5 text-slate-500 transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-amber-300/10 bg-amber-400/[0.03] px-6 pb-6 pt-5">
                <h3 className="text-[1.3rem] font-semibold text-amber-100">{latestIncident.title}</h3>
                <p className="mt-2 text-sm leading-7 text-amber-50/70">{latestIncident.summary}</p>
              </div>
            </details>
          ) : null}

          {latestCertificate ? (
            <details className="group rounded-[2rem] border border-sky-300/15 bg-[#11161f] [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer items-center justify-between p-6 hover:bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-400/10">
                    <Shield className="h-4 w-4 text-sky-300" />
                  </div>
                  <h3 className="text-xl font-semibold text-white">Latest TLS Snapshot</h3>
                </div>
                <ChevronDown className="h-5 w-5 text-slate-500 transition-transform group-open:rotate-180" />
              </summary>
              <div className="border-t border-sky-300/10 bg-sky-400/[0.02] px-6 pb-6 pt-5 text-sm text-sky-100/80">
                <p>Host: {latestCertificate.hostname}</p>
                <p className="mt-1">Issuer: {latestCertificate.issuer ?? "Unknown"}</p>
                <p className="mt-1">Expires: {formatTimestamp(latestCertificate.validTo)}</p>
              </div>
            </details>
          ) : null}

          <details open className="group rounded-[2rem] border border-white/8 bg-[#11161f] [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer items-center justify-between p-6 transition-colors hover:bg-white/[0.02]">
              <h3 className="text-[1.8rem] font-semibold text-white">Latest Checks</h3>
              <ChevronDown className="h-6 w-6 text-slate-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-white/5 px-6 pb-6 pt-5">
              <div className="space-y-3">
                {recentChecks.slice(0, 8).map((check) => (
                  <div key={check.id} className="rounded-[1.2rem] border border-white/8 bg-[#0b1118] px-4 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-lg font-medium text-slate-100">
                          {check.statusCode ? `HTTP ${check.statusCode}` : check.status.toUpperCase()}
                        </p>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{check.classification}</p>
                      </div>
                      <div className="text-right text-sm text-slate-400">
                        <p>{check.latencyMs > 0 ? `${check.latencyMs}ms` : "N/A"}</p>
                        <p>{formatTimestamp(check.checkedAt)}</p>
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-7 text-slate-300">{check.message}</p>
                    {check.responseBody ? (
                      <pre className="mt-3 max-h-40 overflow-auto rounded-[1rem] border border-white/6 bg-[#070b10] px-3 py-3 text-xs text-slate-300">
                        {check.responseBody}
                      </pre>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </details>

          <details className="group rounded-[2rem] border border-white/8 bg-[#11161f] [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer items-center justify-between p-6 transition-colors hover:bg-white/[0.02]">
              <h3 className="text-[1.8rem] font-semibold text-white">Incident Reports</h3>
              <ChevronDown className="h-6 w-6 text-slate-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-white/5 px-6 pb-6 pt-5">
              <div className="space-y-4">
                {reportHistory.length > 0 ? (
                  reportHistory.slice(0, 4).map((report) => (
                    <div key={report.id} className="rounded-[1.2rem] border border-white/8 bg-[#0b1118] p-4">
                      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500">
                        v{report.version} - {new Date(report.createdAt).toLocaleString()}
                      </p>
                      <p className="mt-3 text-sm font-medium text-slate-100">{report.summary}</p>
                      <pre className="mt-3 max-h-40 overflow-auto rounded-[1rem] border border-white/6 bg-[#070b10] px-3 py-3 text-xs text-slate-300">
                        {report.markdown}
                      </pre>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[1.2rem] border border-dashed border-white/8 bg-[#0b1118] px-4 py-8 text-center text-sm text-slate-400">
                    Incident report versions will appear here after analysis runs are stored.
                  </div>
                )}
              </div>
            </div>
          </details>

          <details className="group rounded-[2rem] border border-white/8 bg-[#11161f] [&_summary::-webkit-details-marker]:hidden">
            <summary className="flex cursor-pointer items-center justify-between p-6 transition-colors hover:bg-white/[0.02]">
              <h3 className="text-[1.8rem] font-semibold text-white">Recent Activity</h3>
              <ChevronDown className="h-6 w-6 text-slate-400 transition-transform group-open:rotate-180" />
            </summary>
            <div className="border-t border-white/5 px-6 pb-6 pt-5">
              <div className="space-y-3">
                {recentEvents.slice(0, 8).map((event) => (
                  <div key={event.id} className="rounded-[1.2rem] border border-white/8 bg-[#0b1118] px-4 py-4">
                    <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500">{new Date(event.timestamp).toLocaleString()}</p>
                    <p className="mt-2 text-base font-medium text-slate-100">{event.title}</p>
                    <p className="mt-2 text-sm leading-7 text-slate-400">{event.message}</p>
                  </div>
                ))}
              </div>
            </div>
          </details>
        </div>
      </div>
    </motion.section>
  );
};
