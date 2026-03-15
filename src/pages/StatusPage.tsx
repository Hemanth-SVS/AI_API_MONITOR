import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Globe2 } from "lucide-react";
import { useParams } from "react-router-dom";

import { HeartbeatBar } from "@/components/HeartbeatBar";
import { fetchPublicStatusPage } from "@/api/monitors";

const statusLabelClass = (status: string) => {
  if (status === "up") {
    return "bg-emerald-400/15 text-emerald-200";
  }

  if (status === "degraded") {
    return "bg-amber-400/15 text-amber-100";
  }

  if (status === "down") {
    return "bg-rose-500/15 text-rose-100";
  }

  return "bg-slate-500/15 text-slate-200";
};

const StatusPage = () => {
  const { slug } = useParams();

  const pageQuery = useQuery({
    queryKey: ["public-status-page", slug ?? "default"],
    queryFn: () => fetchPublicStatusPage(slug ?? "default"),
    refetchInterval: 30_000,
  });

  if (pageQuery.isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#090d13] px-5 py-6">
        <div className="max-w-xl rounded-[2rem] border border-rose-300/15 bg-[#11161f] px-8 py-10 text-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-rose-300/70">Status page unavailable</p>
          <h1 className="mt-3 text-3xl font-semibold text-white">We could not load this status page.</h1>
          <p className="mt-3 text-sm leading-7 text-slate-400">{pageQuery.error instanceof Error ? pageQuery.error.message : "Unexpected error."}</p>
        </div>
      </div>
    );
  }

  if (pageQuery.isLoading || !pageQuery.data) {
    return (
      <div className="min-h-screen bg-[#090d13] px-5 py-6">
        <div className="mx-auto max-w-6xl animate-pulse space-y-5">
          <div className="h-40 rounded-[2rem] bg-[#11161f]" />
          <div className="grid gap-4 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-28 rounded-[1.6rem] bg-[#11161f]" />
            ))}
          </div>
          <div className="h-[40vh] rounded-[2rem] bg-[#11161f]" />
        </div>
      </div>
    );
  }

  const { page, summary, monitors, incidents, maintenances } = pageQuery.data;

  return (
    <div className="min-h-screen bg-[#090d13] px-5 py-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="rounded-[2rem] border border-white/8 bg-[#11161f] p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-300">
                <Globe2 className="h-4 w-4 text-emerald-300" />
                Public status page
              </div>
              <h1 className="mt-4 text-[2.75rem] font-semibold text-white">{page.headline || page.name}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">{page.description || "Live service status, current incidents, and planned maintenance."}</p>
            </div>
            <div className="rounded-[1.4rem] border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-slate-300">
              <p>Updated automatically every 30 seconds</p>
              <p className="mt-2">Open incidents: {summary.openIncidents}</p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          {[
            ["Services", summary.total],
            ["Up", summary.up],
            ["Degraded", summary.degraded],
            ["Down", summary.down],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-[1.6rem] border border-white/8 bg-[#11161f] px-5 py-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">{label}</p>
              <p className="mt-3 text-3xl font-semibold text-slate-50">{value}</p>
            </div>
          ))}
        </section>

        {maintenances.length > 0 ? (
          <section className="rounded-[2rem] border border-sky-300/15 bg-sky-400/10 p-6">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-sky-200" />
              <h2 className="text-[1.6rem] font-semibold text-white">Maintenance</h2>
            </div>
            <div className="mt-4 space-y-3">
              {maintenances.map((maintenance) => (
                <div key={maintenance.id} className="rounded-[1.2rem] border border-white/10 bg-[#0b1118]/70 p-4">
                  <p className="text-sm font-medium text-slate-100">{maintenance.name}</p>
                  <p className="mt-2 text-sm text-slate-300">
                    {new Date(maintenance.startsAt).toLocaleString()} to {new Date(maintenance.endsAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
          <h2 className="text-[1.8rem] font-semibold text-white">Services</h2>
          <div className="mt-5 space-y-4">
            {monitors.map((monitor) => (
              <div key={monitor.id} className="rounded-[1.3rem] border border-white/8 bg-[#0b1118] p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-lg font-medium text-slate-100">{monitor.name}</p>
                      <span className={`rounded-full px-3 py-1 text-xs uppercase tracking-[0.18em] ${statusLabelClass(monitor.status)}`}>{monitor.status}</span>
                    </div>
                    <p className="mt-2 truncate text-sm text-slate-400">{monitor.url}</p>
                    <p className="mt-2 text-sm text-slate-500">{monitor.summary}</p>
                  </div>
                  <div className="text-sm text-slate-300">
                    <p>24h uptime: {monitor.uptime24h.toFixed(2)}%</p>
                    <p className="mt-2">Avg latency: {monitor.avgLatencyMs > 0 ? `${monitor.avgLatencyMs}ms` : "N/A"}</p>
                  </div>
                </div>
                <div className="mt-4">
                  <HeartbeatBar heartbeats={monitor.recentHeartbeats} maxBars={32} height={20} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-300" />
            <h2 className="text-[1.8rem] font-semibold text-white">Recent Incidents</h2>
          </div>
          <div className="mt-5 space-y-4">
            {incidents.length > 0 ? (
              incidents.map((incident) => (
                <div key={incident.id} className="rounded-[1.2rem] border border-white/8 bg-[#0b1118] p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs uppercase tracking-[0.18em] text-amber-100">{incident.severity}</span>
                    <span className="text-xs uppercase tracking-[0.18em] text-slate-500">{incident.status}</span>
                  </div>
                  <p className="mt-3 text-sm font-medium text-slate-100">{incident.title}</p>
                  <p className="mt-2 text-sm leading-7 text-slate-400">{incident.summary}</p>
                  <p className="mt-2 text-xs text-slate-500">Updated {new Date(incident.updatedAt).toLocaleString()}</p>
                </div>
              ))
            ) : (
              <div className="rounded-[1.2rem] border border-dashed border-white/8 bg-[#0b1118] px-4 py-10 text-center text-sm text-slate-400">
                No incidents are currently listed on this page.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default StatusPage;
