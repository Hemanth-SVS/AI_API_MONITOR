import { useMemo, useState } from "react";
import { CalendarClock, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { MaintenanceWindow, MonitorSummary } from "@/types/monitoring";

interface MaintenanceCenterProps {
  maintenances: MaintenanceWindow[];
  monitors: MonitorSummary[];
  onSave: (payload: Record<string, unknown>) => Promise<unknown>;
  onDelete: (maintenanceId: string) => Promise<unknown>;
}

const toDateTimeInput = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
};

const toIso = (value: string, fallback: string) => {
  if (!value) {
    return fallback;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
};

export const MaintenanceCenter = ({ maintenances, monitors, onSave, onDelete }: MaintenanceCenterProps) => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scheduleType, setScheduleType] = useState("once");
  const [startsAt, setStartsAt] = useState(() => toDateTimeInput(new Date().toISOString()));
  const [endsAt, setEndsAt] = useState(() => toDateTimeInput(new Date(Date.now() + 60 * 60 * 1000).toISOString()));
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [rrule, setRrule] = useState("");
  const [suppressNotifications, setSuppressNotifications] = useState(true);
  const [selectedMonitorIds, setSelectedMonitorIds] = useState<string[]>([]);

  const selectedNames = useMemo(
    () => monitors.filter((monitor) => selectedMonitorIds.includes(monitor.id)).map((monitor) => monitor.name),
    [monitors, selectedMonitorIds],
  );

  const toggleMonitor = (monitorId: string) => {
    setSelectedMonitorIds((current) =>
      current.includes(monitorId) ? current.filter((item) => item !== monitorId) : [...current, monitorId],
    );
  };

  const save = async () => {
    const fallbackStart = new Date().toISOString();
    const fallbackEnd = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    await onSave({
      name,
      description,
      scheduleType,
      startsAt: toIso(startsAt, fallbackStart),
      endsAt: toIso(endsAt, fallbackEnd),
      timezone,
      rrule: rrule.trim() || null,
      suppressNotifications,
      isActive: true,
      monitorIds: selectedMonitorIds,
    });

    setName("");
    setDescription("");
    setScheduleType("once");
    setStartsAt(toDateTimeInput(new Date().toISOString()));
    setEndsAt(toDateTimeInput(new Date(Date.now() + 60 * 60 * 1000).toISOString()));
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    setRrule("");
    setSuppressNotifications(true);
    setSelectedMonitorIds([]);
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[0.95fr,1.05fr]">
      <section className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-5 w-5 text-emerald-300" />
          <h2 className="text-[1.6rem] font-semibold text-white">Maintenance Windows</h2>
        </div>
        <p className="mt-3 text-sm leading-7 text-slate-400">Schedule planned work and suppress noisy alerts while a known change is in progress.</p>

        <div className="mt-6 space-y-4">
          <Input className="border-white/10 bg-[#0b1118]" value={name} onChange={(event) => setName(event.target.value)} placeholder="Primary API maintenance" />
          <Textarea className="min-h-[110px] border-white/10 bg-[#0b1118]" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What is changing and who owns the work?" />

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm text-slate-300">
              <span>Schedule Type</span>
              <select value={scheduleType} onChange={(event) => setScheduleType(event.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-[#0b1118] px-4 text-slate-100">
                <option value="once">once</option>
                <option value="recurring">recurring</option>
              </select>
            </label>
            <label className="space-y-2 text-sm text-slate-300">
              <span>Timezone</span>
              <Input className="border-white/10 bg-[#0b1118]" value={timezone} onChange={(event) => setTimezone(event.target.value)} />
            </label>
            <label className="space-y-2 text-sm text-slate-300">
              <span>Starts At</span>
              <Input className="border-white/10 bg-[#0b1118]" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} />
            </label>
            <label className="space-y-2 text-sm text-slate-300">
              <span>Ends At</span>
              <Input className="border-white/10 bg-[#0b1118]" type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} />
            </label>
          </div>

          <label className="space-y-2 text-sm text-slate-300">
            <span>Recurrence Rule</span>
            <Input className="border-white/10 bg-[#0b1118]" value={rrule} onChange={(event) => setRrule(event.target.value)} placeholder="Optional RRULE for recurring windows" />
          </label>

          <label className="flex items-center gap-3 rounded-[1rem] border border-white/8 bg-[#0b1118] px-4 py-3 text-sm text-slate-200">
            <input type="checkbox" checked={suppressNotifications} onChange={(event) => setSuppressNotifications(event.target.checked)} />
            Suppress notifications during this window
          </label>

          <div className="rounded-[1.2rem] border border-white/8 bg-[#0b1118] p-4">
            <p className="text-sm font-medium text-slate-200">Target Monitors</p>
            <div className="mt-3 grid max-h-52 gap-2 overflow-auto pr-1">
              {monitors.map((monitor) => (
                <label key={monitor.id} className="flex items-center gap-3 rounded-xl border border-white/8 px-3 py-2 text-sm text-slate-300">
                  <input type="checkbox" checked={selectedMonitorIds.includes(monitor.id)} onChange={() => toggleMonitor(monitor.id)} />
                  <span>{monitor.name}</span>
                </label>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">{selectedNames.length > 0 ? selectedNames.join(", ") : "No monitors selected yet."}</p>
          </div>

          <Button className="w-full rounded-full bg-emerald-400 text-[#04110c] hover:bg-emerald-300" onClick={() => void save()}>
            Save Maintenance Window
          </Button>
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
        <h2 className="text-[1.6rem] font-semibold text-white">Scheduled Windows</h2>
        <div className="mt-5 space-y-4">
          {maintenances.length > 0 ? (
            maintenances.map((maintenance) => (
              <div key={maintenance.id} className="rounded-[1.2rem] border border-white/8 bg-[#0b1118] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-100">{maintenance.name}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{maintenance.scheduleType}</p>
                  </div>
                  <Button variant="outline" className="border-rose-300/10 bg-transparent text-rose-300" onClick={() => void onDelete(maintenance.id)}>
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </Button>
                </div>
                <p className="mt-3 text-sm leading-7 text-slate-300">{maintenance.description || "No description provided."}</p>
                <div className="mt-4 grid gap-3 text-sm text-slate-400 md:grid-cols-2">
                  <p>Starts: {new Date(maintenance.startsAt).toLocaleString()}</p>
                  <p>Ends: {new Date(maintenance.endsAt).toLocaleString()}</p>
                  <p>Timezone: {maintenance.timezone}</p>
                  <p>Alerts: {maintenance.suppressNotifications ? "suppressed" : "active"}</p>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Monitor count: {maintenance.monitorIds.length} - {maintenance.isActive ? "active" : "paused"}
                </p>
              </div>
            ))
          ) : (
            <div className="rounded-[1.2rem] border border-dashed border-white/8 bg-[#0b1118] px-4 py-10 text-center text-sm text-slate-400">
              No maintenance windows are scheduled yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
