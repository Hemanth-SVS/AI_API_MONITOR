import type { ComponentType } from "react";
import { Bell, Bot, Gauge, KeyRound, LogOut, Settings2, ShieldCheck, Siren, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DashboardSummary, StatusPayload, UserSession } from "@/types/monitoring";

interface HeaderProps {
  summary: DashboardSummary;
  status?: StatusPayload;
  currentUser?: UserSession | null;
  view: "dashboard" | "incidents" | "notifications" | "maintenance" | "status-pages" | "security";
  onChangeView: (view: HeaderProps["view"]) => void;
  isSweeping: boolean;
  onSweep: () => void;
  onOpenSlmSettings: () => void;
  onLogout?: () => void;
  showSecurity?: boolean;
}

const navItems: Array<{ id: HeaderProps["view"]; label: string; icon: ComponentType<{ className?: string }> }> = [
  { id: "dashboard", label: "Dashboard", icon: Gauge },
  { id: "incidents", label: "Incidents", icon: Siren },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "maintenance", label: "Maintenance", icon: Wrench },
  { id: "status-pages", label: "Status Pages", icon: ShieldCheck },
  { id: "security", label: "Security", icon: KeyRound },
];

export const Header = ({
  summary,
  status,
  currentUser,
  view,
  onChangeView,
  isSweeping,
  onSweep,
  onOpenSlmSettings,
  onLogout,
  showSecurity = true,
}: HeaderProps) => (
  <header className="border-b border-white/8 bg-[#131922]">
    <div className="mx-auto max-w-[1720px] px-5 py-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-emerald-300/75">Production Monitor Workspace</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="font-display text-[2rem] font-semibold text-slate-50">Auto-Ops Sentinel</h1>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-300">
              <Bot className={`h-4 w-4 ${status?.slm.reachable ? "text-emerald-300" : "text-amber-300"}`} />
              <span>{status?.slm.provider ?? "provider"}</span>
              <span className="font-mono text-slate-100">{status?.slm.model ?? "model"}</span>
            </div>
          </div>
          {currentUser ? <p className="mt-2 text-sm text-slate-400">{currentUser.name} - {currentUser.email}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            className="rounded-full border-white/10 bg-white/[0.04] px-5 text-slate-100 hover:bg-white/[0.08] hover:text-white"
            onClick={onOpenSlmSettings}
          >
            <Settings2 className="h-4 w-4" />
            SLM Settings
          </Button>
          <Button
            variant="outline"
            className="rounded-full border-white/10 bg-white/[0.04] px-5 text-slate-100 hover:bg-white/[0.08] hover:text-white"
            onClick={onSweep}
            disabled={isSweeping}
          >
            {isSweeping ? "Running Checks" : "Run All Checks"}
          </Button>
          {onLogout ? (
            <Button
              variant="outline"
              className="rounded-full border-white/10 bg-white/[0.04] px-5 text-slate-100 hover:bg-white/[0.08] hover:text-white"
              onClick={onLogout}
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap gap-2">
          {navItems
            .filter((item) => showSecurity || item.id !== "security")
            .map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChangeView(item.id)}
                  className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition ${
                    view === item.id ? "bg-emerald-400 text-[#04110c]" : "border border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-slate-200">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Monitors</p>
            <p className="mt-2 text-2xl font-semibold text-slate-50">{summary.total}</p>
          </div>
          <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-slate-200">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Down / Degraded</p>
            <p className="mt-2 text-2xl font-semibold text-slate-50">
              {summary.down} / {summary.degraded}
            </p>
          </div>
          <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-slate-200">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Open Incidents</p>
            <p className="mt-2 text-2xl font-semibold text-slate-50">{summary.openIncidents}</p>
          </div>
          <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-slate-200">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">Queue</p>
            <p className="mt-2 text-2xl font-semibold text-slate-50">
              {status?.slm.queue.running ?? 0}/{status?.slm.queue.concurrency ?? 1}
            </p>
          </div>
        </div>
      </div>
    </div>
  </header>
);
