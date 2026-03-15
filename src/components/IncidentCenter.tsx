import { useMemo, useState } from "react";
import { AlertTriangle, BrainCircuit, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AskOpsResponse, IncidentDetailPayload, IncidentSummary } from "@/types/monitoring";

interface IncidentCenterProps {
  incidents: IncidentSummary[];
  selectedIncidentId: string | null;
  detail: IncidentDetailPayload | null | undefined;
  isLoading: boolean;
  onSelect: (incidentId: string) => void;
  onAsk: (question: string, incidentId: string | null) => Promise<AskOpsResponse>;
}

export const IncidentCenter = ({ incidents, selectedIncidentId, detail, isLoading, onSelect, onAsk }: IncidentCenterProps) => {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskOpsResponse | null>(null);
  const [isAsking, setIsAsking] = useState(false);

  const quickQuestion = useMemo(
    () => (detail?.incident ? `What happened during incident ${detail.incident.id} and what should be fixed first?` : ""),
    [detail?.incident],
  );

  const ask = async (prompt?: string) => {
    const nextQuestion = String(prompt ?? question).trim();
    if (!nextQuestion) {
      return;
    }

    setIsAsking(true);
    try {
      const response = await onAsk(nextQuestion, selectedIncidentId);
      setAnswer(response);
      setQuestion("");
    } finally {
      setIsAsking(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[320px,minmax(0,1fr)]">
      <aside className="rounded-[2rem] border border-white/8 bg-[#11161f] p-4">
        <h2 className="px-2 text-[1.5rem] font-semibold text-white">Incident Center</h2>
        <div className="mt-4 space-y-3">
          {incidents.length > 0 ? (
            incidents.map((incident) => (
              <button
                key={incident.id}
                type="button"
                onClick={() => onSelect(incident.id)}
                className={`w-full rounded-[1.2rem] border px-4 py-4 text-left transition ${
                  selectedIncidentId === incident.id ? "border-amber-300/25 bg-[#0b1118]" : "border-white/8 bg-[#0b1118]/80 hover:border-white/12"
                }`}
              >
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500">{incident.severity}</p>
                <p className="mt-2 text-sm font-medium text-slate-100">{incident.title}</p>
                <p className="mt-2 text-xs text-slate-500">{new Date(incident.updatedAt).toLocaleString()}</p>
              </button>
            ))
          ) : (
            <div className="rounded-[1.2rem] border border-dashed border-white/8 bg-[#0b1118] px-4 py-8 text-center text-sm text-slate-400">
              No incidents have been recorded yet.
            </div>
          )}
        </div>
      </aside>

      <section className="space-y-6">
        {isLoading ? (
          <div className="rounded-[2rem] border border-white/8 bg-[#11161f] p-8 text-sm text-slate-400">Loading incident detail...</div>
        ) : detail ? (
          <>
            <div className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-300" />
                <h3 className="text-[1.8rem] font-semibold text-white">{detail.incident.title}</h3>
              </div>
              <p className="mt-3 text-sm leading-7 text-slate-300">{detail.incident.summary}</p>
              <p className="mt-3 text-sm text-slate-500">
                {detail.incident.status} - opened {new Date(detail.incident.openedAt).toLocaleString()}
              </p>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <div className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
                <h4 className="text-xl font-semibold text-white">Timeline</h4>
                <div className="mt-4 space-y-3">
                  {detail.timeline.map((event) => (
                    <div key={event.id} className="rounded-[1.15rem] border border-white/8 bg-[#0b1118] px-4 py-4">
                      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500">{new Date(event.timestamp).toLocaleString()}</p>
                      <p className="mt-2 text-sm font-medium text-slate-100">{event.title}</p>
                      <p className="mt-2 text-sm text-slate-400">{event.message}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
                <div className="flex items-center gap-2">
                  <BrainCircuit className="h-5 w-5 text-emerald-300" />
                  <h4 className="text-xl font-semibold text-white">Ask Signal Analyst</h4>
                </div>
                {quickQuestion ? (
                  <button type="button" className="mt-4 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-slate-200" onClick={() => void ask(quickQuestion)}>
                    {quickQuestion}
                  </button>
                ) : null}
                <Textarea
                  className="mt-4 min-h-[120px] border-white/8 bg-[#0b1118]"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="Ask about a specific time, report version, or failed notification during this incident."
                />
                <Button className="mt-4 w-full rounded-full bg-emerald-400 text-[#04110c] hover:bg-emerald-300" onClick={() => void ask()} disabled={isAsking}>
                  {isAsking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <BrainCircuit className="h-4 w-4" />}
                  {isAsking ? "Thinking" : "Ask About This Incident"}
                </Button>
                {answer ? (
                  <div className="mt-4 rounded-[1.15rem] border border-white/8 bg-[#0b1118] px-4 py-4">
                    <p className="text-sm leading-7 text-slate-200">{answer.answer}</p>
                    {answer.citations.length > 0 ? <p className="mt-3 text-xs text-slate-500">Sources: {answer.citations.join(", ")}</p> : null}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
              <h4 className="text-xl font-semibold text-white">Stored Reports</h4>
              <div className="mt-4 space-y-4">
                {detail.reports.length > 0 ? (
                  detail.reports.map((report) => (
                    <div key={report.id} className="rounded-[1.15rem] border border-white/8 bg-[#0b1118] p-4">
                      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-slate-500">v{report.version} - {new Date(report.createdAt).toLocaleString()}</p>
                      <p className="mt-2 text-sm font-medium text-slate-100">{report.summary}</p>
                      <pre className="mt-3 max-h-56 overflow-auto rounded-[1rem] border border-white/6 bg-[#070b10] px-3 py-3 text-xs text-slate-300">
                        {report.markdown}
                      </pre>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[1.15rem] border border-dashed border-white/8 bg-[#0b1118] px-4 py-8 text-center text-sm text-slate-400">
                    Incident report versions will appear here after analysis jobs run.
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-[2rem] border border-white/8 bg-[#11161f] p-8 text-sm text-slate-400">Select an incident to inspect its timeline and reports.</div>
        )}
      </section>
    </div>
  );
};
