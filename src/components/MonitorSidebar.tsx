import { useDeferredValue, useMemo, useState } from "react";
import { ChevronDown, Plus, Search, Square } from "lucide-react";

import type { MonitorCheck, MonitorSummary } from "@/types/monitoring";

interface MonitorSidebarProps {
  monitors: MonitorSummary[];
  selectedId: string | null;
  onAddClick: () => void;
  onSelect: (monitorId: string) => void;
}

const statusOrder: Record<MonitorSummary["status"], number> = {
  down: 0,
  degraded: 1,
  pending: 2,
  up: 3,
};

const heartbeatClass = (status: MonitorCheck["status"]) => {
  if (status === "up") {
    return "bg-emerald-400";
  }

  if (status === "degraded") {
    return "bg-amber-400";
  }

  if (status === "down") {
    return "bg-rose-500";
  }

  return "bg-slate-600";
};

const uptimePillClass = (uptime: number) => {
  if (uptime >= 99.5) {
    return "bg-emerald-400 text-[#07120d]";
  }

  if (uptime >= 97) {
    return "bg-amber-300 text-[#171005]";
  }

  return "bg-rose-400 text-[#18070a]";
};

export const MonitorSidebar = ({ monitors, selectedId, onAddClick, onSelect }: MonitorSidebarProps) => {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | MonitorSummary["status"]>("all");
  const [tagFilter, setTagFilter] = useState("all");
  const deferredSearch = useDeferredValue(search);

  const tags = useMemo(
    () => [...new Set(monitors.flatMap((monitor) => monitor.tags).filter(Boolean))].sort((left, right) => left.localeCompare(right)),
    [monitors],
  );

  const filtered = useMemo(() => {
    const searchLower = deferredSearch.trim().toLowerCase();

    return [...monitors]
      .filter((monitor) => {
        if (statusFilter !== "all" && monitor.status !== statusFilter) {
          return false;
        }

        if (tagFilter !== "all" && !monitor.tags.includes(tagFilter)) {
          return false;
        }

        if (!searchLower) {
          return true;
        }

        return (
          monitor.name.toLowerCase().includes(searchLower) ||
          monitor.url.toLowerCase().includes(searchLower) ||
          monitor.environment.toLowerCase().includes(searchLower) ||
          monitor.tags.some((tag) => tag.toLowerCase().includes(searchLower))
        );
      })
      .sort((left, right) => {
        const leftPriority = left.paused ? 4 : statusOrder[left.status];
        const rightPriority = right.paused ? 4 : statusOrder[right.status];

        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }

        return left.name.localeCompare(right.name);
      });
  }, [deferredSearch, monitors, statusFilter, tagFilter]);

  return (
    <aside className="border-r border-white/8 bg-[#090d13] px-5 py-6">
      <button
        type="button"
        onClick={onAddClick}
        className="inline-flex h-14 items-center gap-3 rounded-full border border-emerald-300/20 bg-emerald-400 px-6 text-lg font-medium text-[#04110c] shadow-[0_12px_36px_rgba(74,222,128,0.24)] transition hover:translate-y-[-1px] hover:bg-emerald-300"
      >
        <Plus className="h-5 w-5" />
        Add New Monitor
      </button>

      <div className="mt-6 overflow-hidden rounded-[1.9rem] border border-white/8 bg-[#141a23] shadow-[0_22px_80px_rgba(0,0,0,0.28)]">
        <div className="grid gap-3 border-b border-white/6 px-4 py-4 xl:grid-cols-[auto,112px,112px,minmax(0,1fr)]">
          <button
            type="button"
            className="inline-flex h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-[#0b1118] text-slate-400 hover:text-slate-200"
            aria-label="Selection options"
          >
            <Square className="h-4 w-4" />
          </button>

          <label className="relative block">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as "all" | MonitorSummary["status"])}
              className="h-11 w-full appearance-none rounded-2xl border border-white/8 bg-[#0b1118] px-4 pr-9 text-sm text-slate-100 outline-none transition focus:border-emerald-400/40"
            >
              <option value="all">Status</option>
              <option value="up">Up</option>
              <option value="degraded">Degraded</option>
              <option value="down">Down</option>
              <option value="pending">Pending</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          </label>

          <label className="relative block">
            <select
              value={tagFilter}
              onChange={(event) => setTagFilter(event.target.value)}
              className="h-11 w-full appearance-none rounded-2xl border border-white/8 bg-[#0b1118] px-4 pr-9 text-sm text-slate-100 outline-none transition focus:border-emerald-400/40"
            >
              <option value="all">Tags</option>
              {tags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          </label>

          <label className="relative block">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search..."
              className="h-11 w-full rounded-2xl border border-white/8 bg-[#0b1118] pl-11 pr-4 text-sm text-slate-100 outline-none placeholder:text-slate-500 transition focus:border-emerald-400/40"
            />
          </label>
        </div>

        <div className="max-h-[calc(100vh-300px)] space-y-3 overflow-y-auto px-3 py-4 kuma-scrollbar">
          {filtered.length === 0 ? (
            <div className="rounded-[1.6rem] border border-dashed border-white/8 bg-[#0b1118] px-5 py-8 text-center text-sm text-slate-400">
              No monitors match the current search and filters.
            </div>
          ) : null}

          {filtered.map((monitor) => (
            <button
              key={monitor.id}
              type="button"
              onClick={() => onSelect(monitor.id)}
              className={`w-full rounded-[1.45rem] border px-4 py-4 text-left transition ${
                selectedId === monitor.id
                  ? "border-emerald-300/30 bg-[#0b1118] shadow-[0_0_0_1px_rgba(74,222,128,0.08)]"
                  : "border-transparent bg-[#0b1118]/70 hover:border-white/8 hover:bg-[#101722]"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className={`rounded-full px-5 py-1 text-base font-semibold ${uptimePillClass(monitor.uptime24h || 0)}`}>
                  {monitor.uptime24h > 0 ? `${Math.round(monitor.uptime24h)}%` : "New"}
                </div>
                <div className="flex min-w-[140px] items-center justify-end gap-[6px]">
                  {Array.from({ length: 20 }).map((_, index) => {
                    const heartbeat = monitor.recentHeartbeats.slice(-20)[index];
                    return (
                      <span
                        key={heartbeat?.id ?? `${monitor.id}-${index}`}
                        className={`h-5 w-[5px] rounded-full ${heartbeat ? heartbeatClass(heartbeat.status) : "bg-slate-700"}`}
                      />
                    );
                  })}
                </div>
              </div>

              <div className="mt-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[1.05rem] font-medium text-slate-100">{monitor.name}</p>
                  <p className="mt-1 truncate text-sm text-slate-500">
                    {monitor.environment} - {monitor.method} - {monitor.url}
                  </p>
                </div>
                {monitor.paused ? <span className="text-xs uppercase tracking-[0.2em] text-amber-300">Paused</span> : null}
              </div>
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
};
