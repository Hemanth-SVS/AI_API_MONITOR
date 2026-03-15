import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { StatusPayload } from "@/types/monitoring";

interface SlmSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status?: StatusPayload;
  isSaving: boolean;
  onSave: (payload: { provider?: string; baseUrl?: string; model?: string; timeoutMs?: number; apiKey?: string }) => void;
}

export const SlmSettingsDialog = ({ open, onOpenChange, status, isSaving, onSave }: SlmSettingsDialogProps) => {
  const [provider, setProvider] = useState("ollama");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [timeoutMs, setTimeoutMs] = useState(20000);
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    if (!status?.slm) {
      return;
    }

    setProvider(status.slm.provider ?? "ollama");
    setBaseUrl(status.slm.baseUrl ?? "");
    setModel(status.slm.model ?? "");
    setTimeoutMs(status.slm.timeoutMs ?? 20000);
    setApiKey("");
  }, [status?.slm, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-[#11161f] text-slate-50 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-2xl">SLM Provider Settings</DialogTitle>
          <DialogDescription className="text-slate-400">
            Switch between Ollama-compatible and OpenAI-compatible endpoints without changing code.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm text-slate-300">Provider</label>
            <select
              value={provider}
              onChange={(event) => setProvider(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl border border-white/10 bg-[#0b1118] px-4 text-slate-100"
            >
              <option value="ollama">ollama</option>
              <option value="openai-compatible">openai-compatible</option>
            </select>
          </div>
          <div>
            <label className="text-sm text-slate-300">Base URL</label>
            <Input className="mt-2 border-white/10 bg-[#0b1118]" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
          </div>
          <div>
            <label className="text-sm text-slate-300">Model</label>
            <Input className="mt-2 border-white/10 bg-[#0b1118]" value={model} onChange={(event) => setModel(event.target.value)} />
          </div>
          <div>
            <label className="text-sm text-slate-300">Timeout (ms)</label>
            <Input className="mt-2 border-white/10 bg-[#0b1118]" type="number" value={timeoutMs} onChange={(event) => setTimeoutMs(Number(event.target.value || 20000))} />
          </div>
          {provider === "openai-compatible" ? (
            <div>
              <label className="text-sm text-slate-300">API Key</label>
              <Input className="mt-2 border-white/10 bg-[#0b1118]" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={status?.slm.hasApiKey ? "Stored key present" : "Enter API key"} />
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" className="border-white/10 bg-transparent" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            className="bg-emerald-400 text-[#04110c] hover:bg-emerald-300"
            disabled={isSaving}
            onClick={() =>
              onSave({
                provider,
                baseUrl,
                model,
                timeoutMs,
                ...(apiKey ? { apiKey } : {}),
              })
            }
          >
            {isSaving ? "Saving" : "Save SLM Settings"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
