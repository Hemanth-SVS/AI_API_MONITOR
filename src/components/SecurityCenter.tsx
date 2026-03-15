import { useState } from "react";
import { Bot, KeyRound, LockKeyhole, ShieldCheck, ShieldOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ApiKeyRecord, StatusPayload, UserSession } from "@/types/monitoring";

interface TotpSetupResponse {
  secret: string;
  otpauthUrl: string;
}

interface SecurityCenterProps {
  currentUser: UserSession;
  apiKeys: ApiKeyRecord[];
  status?: StatusPayload;
  onOpenSlmSettings: () => void;
  onCreateApiKey: (payload: { label: string; scope: string }) => Promise<ApiKeyRecord>;
  onRevokeApiKey: (apiKeyId: string) => Promise<unknown>;
  onSetupTotp: () => Promise<TotpSetupResponse>;
  onEnableTotp: (code: string) => Promise<unknown>;
  onDisableTotp: () => Promise<unknown>;
  onChangePassword: (payload: { currentPassword: string; nextPassword: string }) => Promise<unknown>;
}

export const SecurityCenter = ({
  currentUser,
  apiKeys,
  status,
  onOpenSlmSettings,
  onCreateApiKey,
  onRevokeApiKey,
  onSetupTotp,
  onEnableTotp,
  onDisableTotp,
  onChangePassword,
}: SecurityCenterProps) => {
  const [keyLabel, setKeyLabel] = useState("");
  const [keyScope, setKeyScope] = useState("metrics");
  const [lastCreatedToken, setLastCreatedToken] = useState<string | null>(null);
  const [totpSetup, setTotpSetup] = useState<TotpSetupResponse | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");

  const createKey = async () => {
    const created = await onCreateApiKey({ label: keyLabel, scope: keyScope });
    setLastCreatedToken(created.token ?? null);
    setKeyLabel("");
  };

  const changePassword = async () => {
    await onChangePassword({ currentPassword, nextPassword });
    setCurrentPassword("");
    setNextPassword("");
  };

  const setupTotp = async () => {
    const setup = await onSetupTotp();
    setTotpSetup(setup);
    setTotpCode("");
  };

  const enableTotp = async () => {
    await onEnableTotp(totpCode);
    setTotpSetup(null);
    setTotpCode("");
  };

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="space-y-6">
        <div className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-emerald-300" />
            <h2 className="text-[1.6rem] font-semibold text-white">Signal Analyst Provider</h2>
          </div>
          <p className="mt-3 text-sm leading-7 text-slate-400">Manage the live SLM connection, model, API key, and health from one place.</p>
          <div className="mt-5 grid gap-3 text-sm text-slate-300 md:grid-cols-2">
            <p>Provider: {status?.slm.provider ?? "unknown"}</p>
            <p>Model: {status?.slm.model ?? "unknown"}</p>
            <p>Base URL: {status?.slm.baseUrl ?? "unknown"}</p>
            <p>Reachability: {status?.slm.reachable ? "live" : "fallback"}</p>
          </div>
          <Button className="mt-5 rounded-full bg-emerald-400 text-[#04110c] hover:bg-emerald-300" onClick={onOpenSlmSettings}>
            Open SLM Settings
          </Button>
        </div>

        <div className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-300" />
            <h2 className="text-[1.6rem] font-semibold text-white">Two-Factor Authentication</h2>
          </div>
          <p className="mt-3 text-sm leading-7 text-slate-400">Protect the private operator console with app-based TOTP codes.</p>

          <div className="mt-5 rounded-[1.2rem] border border-white/8 bg-[#0b1118] p-4 text-sm text-slate-300">
            <p>User: {currentUser.email}</p>
            <p className="mt-2">Status: {currentUser.totpEnabled ? "enabled" : "disabled"}</p>
          </div>

          {!currentUser.totpEnabled ? (
            <div className="mt-5 space-y-4">
              <Button className="rounded-full bg-emerald-400 text-[#04110c] hover:bg-emerald-300" onClick={() => void setupTotp()}>
                <ShieldCheck className="h-4 w-4" />
                Generate TOTP Secret
              </Button>
              {totpSetup ? (
                <div className="rounded-[1.2rem] border border-white/8 bg-[#0b1118] p-4">
                  <p className="text-sm text-slate-200">Secret: {totpSetup.secret}</p>
                  <p className="mt-2 break-all text-xs text-slate-500">{totpSetup.otpauthUrl}</p>
                  <div className="mt-4 flex gap-3">
                    <Input className="border-white/10 bg-[#05080d]" value={totpCode} onChange={(event) => setTotpCode(event.target.value)} placeholder="Enter current 6-digit code" />
                    <Button className="rounded-full bg-emerald-400 text-[#04110c] hover:bg-emerald-300" onClick={() => void enableTotp()}>
                      Enable
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <Button variant="outline" className="mt-5 rounded-full border-rose-300/10 bg-transparent text-rose-300" onClick={() => void onDisableTotp()}>
              <ShieldOff className="h-4 w-4" />
              Disable TOTP
            </Button>
          )}
        </div>

        <div className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
          <div className="flex items-center gap-2">
            <LockKeyhole className="h-5 w-5 text-emerald-300" />
            <h2 className="text-[1.6rem] font-semibold text-white">Change Password</h2>
          </div>
          <div className="mt-5 space-y-4">
            <Input className="border-white/10 bg-[#0b1118]" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="Current password" />
            <Input className="border-white/10 bg-[#0b1118]" type="password" value={nextPassword} onChange={(event) => setNextPassword(event.target.value)} placeholder="New password" />
            <Button className="rounded-full bg-emerald-400 text-[#04110c] hover:bg-emerald-300" onClick={() => void changePassword()}>
              Update Password
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
        <div className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-emerald-300" />
          <h2 className="text-[1.6rem] font-semibold text-white">API Keys</h2>
        </div>
        <p className="mt-3 text-sm leading-7 text-slate-400">Create scoped keys for metrics scraping and other automated system access.</p>

        <div className="mt-5 space-y-4 rounded-[1.2rem] border border-white/8 bg-[#0b1118] p-4">
          <Input className="border-white/10 bg-[#05080d]" value={keyLabel} onChange={(event) => setKeyLabel(event.target.value)} placeholder="Prometheus scraper" />
          <select value={keyScope} onChange={(event) => setKeyScope(event.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-[#05080d] px-4 text-slate-100">
            <option value="metrics">metrics</option>
            <option value="admin">admin</option>
          </select>
          <Button className="rounded-full bg-emerald-400 text-[#04110c] hover:bg-emerald-300" onClick={() => void createKey()}>
            Create API Key
          </Button>
          {lastCreatedToken ? (
            <div className="rounded-[1rem] border border-amber-300/15 bg-amber-400/10 px-4 py-4 text-sm text-amber-50">
              <p className="font-medium">Copy this token now.</p>
              <p className="mt-2 break-all font-mono text-xs">{lastCreatedToken}</p>
            </div>
          ) : null}
        </div>

        <div className="mt-6 space-y-3">
          {apiKeys.length > 0 ? (
            apiKeys.map((apiKey) => (
              <div key={apiKey.id} className="rounded-[1.2rem] border border-white/8 bg-[#0b1118] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-100">{apiKey.label}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{apiKey.scope}</p>
                  </div>
                  <Button variant="outline" className="border-rose-300/10 bg-transparent text-rose-300" onClick={() => void onRevokeApiKey(apiKey.id)}>
                    Revoke
                  </Button>
                </div>
                <div className="mt-4 grid gap-2 text-xs text-slate-500 md:grid-cols-2">
                  <p>Created: {new Date(apiKey.createdAt).toLocaleString()}</p>
                  <p>Last used: {apiKey.lastUsedAt ? new Date(apiKey.lastUsedAt).toLocaleString() : "never"}</p>
                </div>
              </div>
            ))
          ) : (
            <div className="rounded-[1.2rem] border border-dashed border-white/8 bg-[#0b1118] px-4 py-10 text-center text-sm text-slate-400">
              No API keys have been created yet.
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
