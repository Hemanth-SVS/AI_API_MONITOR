import { useMemo, useState } from "react";
import { ExternalLink, Globe2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { MonitorSummary, StatusPageRecord } from "@/types/monitoring";

interface StatusPagesCenterProps {
  pages: StatusPageRecord[];
  monitors: MonitorSummary[];
  onSave: (payload: Record<string, unknown>) => Promise<unknown>;
  onDelete: (statusPageId: string) => Promise<unknown>;
}

export const StatusPagesCenter = ({ pages, monitors, onSave, onDelete }: StatusPagesCenterProps) => {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [headline, setHeadline] = useState("");
  const [description, setDescription] = useState("");
  const [customDomain, setCustomDomain] = useState("");
  const [showHistory, setShowHistory] = useState(true);
  const [isPublic, setIsPublic] = useState(true);
  const [selectedMonitorIds, setSelectedMonitorIds] = useState<string[]>([]);

  const selectedMonitorNames = useMemo(
    () => monitors.filter((monitor) => selectedMonitorIds.includes(monitor.id)).map((monitor) => monitor.name),
    [monitors, selectedMonitorIds],
  );

  const toggleMonitor = (monitorId: string) => {
    setSelectedMonitorIds((current) =>
      current.includes(monitorId) ? current.filter((item) => item !== monitorId) : [...current, monitorId],
    );
  };

  const save = async () => {
    await onSave({
      name,
      slug,
      headline,
      description,
      customDomain: customDomain.trim() || null,
      showHistory,
      isPublic,
      monitorIds: selectedMonitorIds,
    });

    setName("");
    setSlug("");
    setHeadline("");
    setDescription("");
    setCustomDomain("");
    setShowHistory(true);
    setIsPublic(true);
    setSelectedMonitorIds([]);
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[0.95fr,1.05fr]">
      <section className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
        <div className="flex items-center gap-2">
          <Globe2 className="h-5 w-5 text-emerald-300" />
          <h2 className="text-[1.6rem] font-semibold text-white">Public Status Pages</h2>
        </div>
        <p className="mt-3 text-sm leading-7 text-slate-400">Publish a monitor subset for customers or internal stakeholders with live incidents and maintenance visibility.</p>

        <div className="mt-6 space-y-4">
          <Input className="border-white/10 bg-[#0b1118]" value={name} onChange={(event) => setName(event.target.value)} placeholder="Customer-facing Status" />
          <Input className="border-white/10 bg-[#0b1118]" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/\s+/g, "-"))} placeholder="customer-facing" />
          <Input className="border-white/10 bg-[#0b1118]" value={headline} onChange={(event) => setHeadline(event.target.value)} placeholder="All core services are operating normally" />
          <Textarea className="min-h-[110px] border-white/10 bg-[#0b1118]" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Explain who this page is for and what it covers." />
          <Input className="border-white/10 bg-[#0b1118]" value={customDomain} onChange={(event) => setCustomDomain(event.target.value)} placeholder="status.example.com (optional)" />

          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex items-center gap-3 rounded-[1rem] border border-white/8 bg-[#0b1118] px-4 py-3 text-sm text-slate-200">
              <input type="checkbox" checked={isPublic} onChange={(event) => setIsPublic(event.target.checked)} />
              Publicly accessible
            </label>
            <label className="flex items-center gap-3 rounded-[1rem] border border-white/8 bg-[#0b1118] px-4 py-3 text-sm text-slate-200">
              <input type="checkbox" checked={showHistory} onChange={(event) => setShowHistory(event.target.checked)} />
              Show recent incident history
            </label>
          </div>

          <div className="rounded-[1.2rem] border border-white/8 bg-[#0b1118] p-4">
            <p className="text-sm font-medium text-slate-200">Visible Monitors</p>
            <div className="mt-3 grid max-h-52 gap-2 overflow-auto pr-1">
              {monitors.map((monitor) => (
                <label key={monitor.id} className="flex items-center gap-3 rounded-xl border border-white/8 px-3 py-2 text-sm text-slate-300">
                  <input type="checkbox" checked={selectedMonitorIds.includes(monitor.id)} onChange={() => toggleMonitor(monitor.id)} />
                  <span>{monitor.name}</span>
                </label>
              ))}
            </div>
            <p className="mt-3 text-xs text-slate-500">{selectedMonitorNames.length > 0 ? selectedMonitorNames.join(", ") : "No monitors selected yet."}</p>
          </div>

          <Button className="w-full rounded-full bg-emerald-400 text-[#04110c] hover:bg-emerald-300" onClick={() => void save()}>
            Save Status Page
          </Button>
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
        <h2 className="text-[1.6rem] font-semibold text-white">Published Pages</h2>
        <div className="mt-5 space-y-4">
          {pages.length > 0 ? (
            pages.map((page) => (
              <div key={page.id} className="rounded-[1.2rem] border border-white/8 bg-[#0b1118] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-100">{page.name}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">/{page.slug}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" className="border-white/10 bg-transparent" asChild>
                      <a href={`/status/${page.slug}`} target="_blank" rel="noreferrer">
                        <ExternalLink className="h-4 w-4" />
                        Open
                      </a>
                    </Button>
                    <Button variant="outline" className="border-rose-300/10 bg-transparent text-rose-300" onClick={() => void onDelete(page.id)}>
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </div>
                <p className="mt-3 text-sm leading-7 text-slate-300">{page.headline || page.description || "No summary provided."}</p>
                <div className="mt-4 grid gap-3 text-sm text-slate-400 md:grid-cols-2">
                  <p>Visible monitors: {page.monitorIds.length}</p>
                  <p>History: {page.showHistory ? "shown" : "hidden"}</p>
                  <p>Public: {page.isPublic ? "yes" : "no"}</p>
                  <p>Custom domain: {page.customDomain ?? "not configured"}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-[1.2rem] border border-dashed border-white/8 bg-[#0b1118] px-4 py-10 text-center text-sm text-slate-400">
              No status pages have been created yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
