import { useEffect, useState } from "react";
import { Plus, Save, X } from "lucide-react";
import { motion } from "framer-motion";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CreateMonitorInput, JsonValue, MonitorType } from "@/types/monitoring";

interface AddMonitorFormProps {
  mode: "create" | "edit";
  initialValue?: CreateMonitorInput | null;
  isSubmitting: boolean;
  onCancel: () => void;
  onSubmit: (payload: CreateMonitorInput) => void;
}

const monitorTypes: MonitorType[] = ["http", "keyword", "json-query", "tcp", "websocket", "ping", "dns", "push", "docker", "steam"];

const fieldClassName =
  "mt-3 h-12 rounded-[1.15rem] border-white/8 bg-[#0b1118] px-4 text-base text-slate-100 placeholder:text-slate-500 focus-visible:border-emerald-400/40 focus-visible:ring-0";
const textareaClassName =
  "mt-3 rounded-[1.15rem] border-white/8 bg-[#0b1118] px-4 py-3 font-mono text-sm text-slate-100 placeholder:text-slate-500 focus-visible:border-emerald-400/40 focus-visible:ring-0";

const buildConfigDefaults = (type: MonitorType): Record<string, JsonValue> => {
  switch (type) {
    case "keyword":
      return {
        url: "https://",
        method: "GET",
        keyword: "",
        headersText: "",
        body: "",
      };
    case "json-query":
      return {
        url: "https://",
        method: "GET",
        jsonPath: "",
        expectedValue: "",
        headersText: "",
        body: "",
      };
    case "tcp":
    case "steam":
      return {
        host: "",
        port: 80,
      };
    case "websocket":
      return {
        url: "wss://",
        sendText: "",
        expectText: "",
      };
    case "ping":
      return {
        host: "",
      };
    case "dns":
      return {
        host: "",
        recordType: "A",
        expectedContains: "",
      };
    case "push":
      return {
        graceSeconds: 0,
      };
    case "docker":
      return {
        container: "",
      };
    case "http":
    default:
      return {
        url: "https://",
        method: "GET",
        expectedStatusCodes: "200-299",
        expectedBodyIncludes: "",
        headersText: "",
        body: "",
      };
  }
};

const buildDefaults = (type: MonitorType = "http"): CreateMonitorInput => ({
  type,
  name: "",
  url: type === "websocket" ? "wss://" : "https://",
  method: "GET",
  intervalSeconds: 60,
  timeoutMs: 10000,
  retries: 0,
  environment: "production",
  owner: "platform",
  expectedStatusCodes: "200-299",
  expectedBodyIncludes: "",
  headerText: "",
  body: "",
  description: "",
  tags: [],
  config: buildConfigDefaults(type),
  proxyConfig: null,
  notificationPolicy: null,
  pushToken: null,
});

const cloneForm = (value?: CreateMonitorInput | null): CreateMonitorInput => {
  const type = value?.type ?? "http";

  return {
    ...(value ?? buildDefaults(type)),
    type,
    tags: [...(value?.tags ?? [])],
    config: { ...buildConfigDefaults(type), ...(value?.config ?? {}) },
    proxyConfig: value?.proxyConfig ? { ...value.proxyConfig } : null,
    notificationPolicy: value?.notificationPolicy ? { ...value.notificationPolicy } : null,
  };
};

const applyTypeDefaults = (current: CreateMonitorInput, nextType: MonitorType): CreateMonitorInput => {
  const defaults = buildDefaults(nextType);

  return {
    ...current,
    type: nextType,
    url: defaults.url,
    method: defaults.method,
    expectedStatusCodes: defaults.expectedStatusCodes,
    expectedBodyIncludes: defaults.expectedBodyIncludes,
    headerText: defaults.headerText,
    body: defaults.body,
    config: defaults.config,
    pushToken: nextType === "push" ? current.pushToken : null,
  };
};

const configValue = (config: Record<string, JsonValue>, key: string, fallback = "") => String(config[key] ?? fallback);

export const AddMonitorForm = ({ mode, initialValue, isSubmitting, onCancel, onSubmit }: AddMonitorFormProps) => {
  const [form, setForm] = useState<CreateMonitorInput>(() => cloneForm(initialValue));
  const [tagInput, setTagInput] = useState("");

  useEffect(() => {
    setForm(cloneForm(initialValue));
    setTagInput("");
  }, [initialValue, mode]);

  const setConfig = (patch: Record<string, JsonValue>) => {
    setForm((current) => ({
      ...current,
      config: {
        ...current.config,
        ...patch,
      },
    }));
  };

  const addTag = () => {
    const nextTag = tagInput.trim();

    if (!nextTag || form.tags.includes(nextTag)) {
      return;
    }

    setForm((current) => ({ ...current, tags: [...current.tags, nextTag] }));
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    setForm((current) => ({ ...current, tags: current.tags.filter((item) => item !== tag) }));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();

    onSubmit({
      ...form,
      intervalSeconds: Math.max(10, Number(form.intervalSeconds || 60)),
      timeoutMs: Math.max(2000, Number(form.timeoutMs || 10000)),
      retries: Math.max(0, Number(form.retries || 0)),
      config: { ...form.config },
    });
  };

  const type = form.type;

  return (
    <motion.section
      key={mode}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -18 }}
      transition={{ duration: 0.24, ease: "easeOut" }}
      className="min-h-0 overflow-y-auto bg-[#090d13] px-5 py-6"
    >
      <form className="mx-auto max-w-[1320px] space-y-6" onSubmit={submit}>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.26em] text-emerald-300/70">Typed Monitor Configuration</p>
            <h2 className="mt-2 font-display text-[3rem] font-semibold text-white">
              {mode === "create" ? "Add New Monitor" : "Edit Monitor"}
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
              Configure production-grade monitor types, real incident storage, and the Signal Analyst context that travels with each alert.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              className="rounded-full border border-white/10 bg-white/[0.04] px-5 text-slate-200 hover:bg-white/[0.08]"
              onClick={onCancel}
            >
              <X className="h-4 w-4" />
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting} className="rounded-full bg-emerald-400 px-6 text-[#04110c] hover:bg-emerald-300">
              <Save className="h-4 w-4" />
              {isSubmitting ? "Saving" : mode === "create" ? "Create Monitor" : "Save Monitor"}
            </Button>
          </div>
        </div>

        <div className="grid gap-6 2xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <section className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
              <h3 className="text-[2rem] font-semibold text-white">General</h3>
              <div className="mt-6 grid gap-5 xl:grid-cols-2">
                <div>
                  <label className="text-lg font-medium text-slate-200">Monitor Type</label>
                  <select
                    value={form.type}
                    onChange={(event) => setForm((current) => applyTypeDefaults(current, event.target.value as MonitorType))}
                    className={`${fieldClassName} w-full appearance-none`}
                  >
                    {monitorTypes.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-lg font-medium text-slate-200">Friendly Name</label>
                  <Input
                    className={fieldClassName}
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Payments API"
                    autoFocus
                  />
                </div>

                {(type === "http" || type === "keyword" || type === "json-query" || type === "websocket") && (
                  <div className="xl:col-span-2">
                    <label className="text-lg font-medium text-slate-200">{type === "websocket" ? "WebSocket URL" : "URL to Monitor"}</label>
                    <Input
                      className={`${fieldClassName} font-mono`}
                      value={configValue(form.config, "url", form.url)}
                      onChange={(event) => {
                        const url = event.target.value;
                        setForm((current) => ({ ...current, url }));
                        setConfig({ url });
                      }}
                      placeholder={type === "websocket" ? "wss://api.example.com/stream" : "https://api.example.com/health"}
                    />
                  </div>
                )}

                <div className="xl:col-span-2">
                  <label className="text-lg font-medium text-slate-200">Description</label>
                  <Textarea
                    className={`${textareaClassName} min-h-[120px] font-sans`}
                    value={form.description}
                    onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Explain what this monitor protects and why operators should care."
                  />
                </div>
              </div>
            </section>

            <section className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
              <h3 className="text-[2rem] font-semibold text-white">Schedule</h3>
              <div className="mt-6 grid gap-5 xl:grid-cols-2">
                <div>
                  <label className="text-lg font-medium text-slate-200">Heartbeat Interval (seconds)</label>
                  <Input
                    className={fieldClassName}
                    type="number"
                    min={20}
                    value={form.intervalSeconds}
                    onChange={(event) => setForm((current) => ({ ...current, intervalSeconds: Number(event.target.value || 60) }))}
                  />
                </div>
                <div>
                  <label className="text-lg font-medium text-slate-200">Timeout (ms)</label>
                  <Input
                    className={fieldClassName}
                    type="number"
                    min={2000}
                    value={form.timeoutMs}
                    onChange={(event) => setForm((current) => ({ ...current, timeoutMs: Number(event.target.value || 10000) }))}
                  />
                </div>
                <div>
                  <label className="text-lg font-medium text-slate-200">Retries</label>
                  <Input
                    className={fieldClassName}
                    type="number"
                    min={0}
                    value={form.retries}
                    onChange={(event) => setForm((current) => ({ ...current, retries: Number(event.target.value || 0) }))}
                  />
                </div>
                <div>
                  <label className="text-lg font-medium text-slate-200">Environment</label>
                  <Input
                    className={fieldClassName}
                    value={form.environment}
                    onChange={(event) => setForm((current) => ({ ...current, environment: event.target.value }))}
                    placeholder="production"
                  />
                </div>
                <div>
                  <label className="text-lg font-medium text-slate-200">Owner</label>
                  <Input
                    className={fieldClassName}
                    value={form.owner}
                    onChange={(event) => setForm((current) => ({ ...current, owner: event.target.value }))}
                    placeholder="platform"
                  />
                </div>
              </div>
            </section>

            <section className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
              <h3 className="text-[2rem] font-semibold text-white">Type-Specific Config</h3>
              <div className="mt-6 grid gap-5 xl:grid-cols-2">
                {(type === "http" || type === "keyword" || type === "json-query") && (
                  <>
                    <div>
                      <label className="text-lg font-medium text-slate-200">Method</label>
                      <select
                        value={form.method}
                        onChange={(event) => {
                          setForm((current) => ({ ...current, method: event.target.value as CreateMonitorInput["method"] }));
                          setConfig({ method: event.target.value });
                        }}
                        className={`${fieldClassName} w-full appearance-none`}
                      >
                        {["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((method) => (
                          <option key={method} value={method}>
                            {method}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-lg font-medium text-slate-200">Accepted Status Codes</label>
                      <Input
                        className={`${fieldClassName} font-mono`}
                        value={form.expectedStatusCodes}
                        onChange={(event) => {
                          setForm((current) => ({ ...current, expectedStatusCodes: event.target.value }));
                          setConfig({ expectedStatusCodes: event.target.value });
                        }}
                        placeholder="200-299"
                      />
                    </div>
                    {type === "http" && (
                      <div className="xl:col-span-2">
                        <label className="text-lg font-medium text-slate-200">Expected Body Includes</label>
                        <Input
                          className={fieldClassName}
                          value={form.expectedBodyIncludes}
                          onChange={(event) => {
                            setForm((current) => ({ ...current, expectedBodyIncludes: event.target.value }));
                            setConfig({ expectedBodyIncludes: event.target.value });
                          }}
                          placeholder="ok"
                        />
                      </div>
                    )}
                    {type === "keyword" && (
                      <div className="xl:col-span-2">
                        <label className="text-lg font-medium text-slate-200">Keyword</label>
                        <Input
                          className={fieldClassName}
                          value={configValue(form.config, "keyword")}
                          onChange={(event) => setConfig({ keyword: event.target.value })}
                          placeholder="healthy"
                        />
                      </div>
                    )}
                    {type === "json-query" && (
                      <>
                        <div>
                          <label className="text-lg font-medium text-slate-200">JSON Path</label>
                          <Input
                            className={fieldClassName}
                            value={configValue(form.config, "jsonPath")}
                            onChange={(event) => setConfig({ jsonPath: event.target.value })}
                            placeholder="status"
                          />
                        </div>
                        <div>
                          <label className="text-lg font-medium text-slate-200">Expected Value</label>
                          <Input
                            className={fieldClassName}
                            value={configValue(form.config, "expectedValue")}
                            onChange={(event) => setConfig({ expectedValue: event.target.value })}
                            placeholder="ok"
                          />
                        </div>
                      </>
                    )}
                    <div className="xl:col-span-2">
                      <label className="text-lg font-medium text-slate-200">Headers</label>
                      <Textarea
                        className={`${textareaClassName} min-h-[140px]`}
                        value={form.headerText}
                        onChange={(event) => {
                          setForm((current) => ({ ...current, headerText: event.target.value }));
                          setConfig({ headersText: event.target.value });
                        }}
                        placeholder={"Authorization: Bearer local-token\nX-Tenant: west"}
                      />
                    </div>
                    <div className="xl:col-span-2">
                      <label className="text-lg font-medium text-slate-200">Body</label>
                      <Textarea
                        className={`${textareaClassName} min-h-[140px]`}
                        value={form.body}
                        onChange={(event) => {
                          setForm((current) => ({ ...current, body: event.target.value }));
                          setConfig({ body: event.target.value });
                        }}
                        placeholder='{"ping": true}'
                      />
                    </div>
                  </>
                )}

                {(type === "tcp" || type === "steam") && (
                  <>
                    <div>
                      <label className="text-lg font-medium text-slate-200">Host</label>
                      <Input className={fieldClassName} value={configValue(form.config, "host")} onChange={(event) => setConfig({ host: event.target.value })} />
                    </div>
                    <div>
                      <label className="text-lg font-medium text-slate-200">Port</label>
                      <Input className={fieldClassName} type="number" value={configValue(form.config, "port", "80")} onChange={(event) => setConfig({ port: Number(event.target.value || 80) })} />
                    </div>
                  </>
                )}

                {type === "websocket" && (
                  <>
                    <div>
                      <label className="text-lg font-medium text-slate-200">Send Text</label>
                      <Input className={fieldClassName} value={configValue(form.config, "sendText")} onChange={(event) => setConfig({ sendText: event.target.value })} />
                    </div>
                    <div>
                      <label className="text-lg font-medium text-slate-200">Expected Response Includes</label>
                      <Input className={fieldClassName} value={configValue(form.config, "expectText")} onChange={(event) => setConfig({ expectText: event.target.value })} />
                    </div>
                  </>
                )}

                {type === "ping" && (
                  <div className="xl:col-span-2">
                    <label className="text-lg font-medium text-slate-200">Host</label>
                    <Input className={fieldClassName} value={configValue(form.config, "host")} onChange={(event) => setConfig({ host: event.target.value })} />
                  </div>
                )}

                {type === "dns" && (
                  <>
                    <div>
                      <label className="text-lg font-medium text-slate-200">Host</label>
                      <Input className={fieldClassName} value={configValue(form.config, "host")} onChange={(event) => setConfig({ host: event.target.value })} />
                    </div>
                    <div>
                      <label className="text-lg font-medium text-slate-200">Record Type</label>
                      <Input className={fieldClassName} value={configValue(form.config, "recordType", "A")} onChange={(event) => setConfig({ recordType: event.target.value.toUpperCase() })} />
                    </div>
                    <div className="xl:col-span-2">
                      <label className="text-lg font-medium text-slate-200">Expected Answer Contains</label>
                      <Input className={fieldClassName} value={configValue(form.config, "expectedContains")} onChange={(event) => setConfig({ expectedContains: event.target.value })} />
                    </div>
                  </>
                )}

                {type === "push" && (
                  <>
                    <div>
                      <label className="text-lg font-medium text-slate-200">Grace Seconds</label>
                      <Input className={fieldClassName} type="number" value={configValue(form.config, "graceSeconds", "0")} onChange={(event) => setConfig({ graceSeconds: Number(event.target.value || 0) })} />
                    </div>
                    <div>
                      <label className="text-lg font-medium text-slate-200">Push Token</label>
                      <Input className={fieldClassName} value={form.pushToken ?? ""} onChange={(event) => setForm((current) => ({ ...current, pushToken: event.target.value }))} placeholder="auto-generated if empty" />
                    </div>
                  </>
                )}

                {type === "docker" && (
                  <div className="xl:col-span-2">
                    <label className="text-lg font-medium text-slate-200">Container Name</label>
                    <Input className={fieldClassName} value={configValue(form.config, "container")} onChange={(event) => setConfig({ container: event.target.value })} />
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
              <h3 className="text-[2rem] font-semibold text-white">Tags</h3>
              <div className="mt-5 flex gap-3">
                <Input
                  className={`${fieldClassName} mt-0`}
                  value={tagInput}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="critical"
                />
                <Button type="button" onClick={addTag} className="mt-0 h-12 rounded-[1.15rem] bg-emerald-400 px-5 text-[#04110c] hover:bg-emerald-300">
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </div>
              <div className="mt-4 flex min-h-[72px] flex-wrap gap-2 rounded-[1.15rem] border border-white/8 bg-[#0b1118] p-4">
                {form.tags.length > 0 ? (
                  form.tags.map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="rounded-full border border-emerald-300/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100 transition hover:bg-rose-500/15 hover:text-rose-200"
                    >
                      {tag} x
                    </button>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">Tags help route incidents and notifications.</p>
                )}
              </div>
            </section>

            <section className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
              <h3 className="text-[2rem] font-semibold text-white">Advanced JSON</h3>
              <p className="mt-2 text-sm text-slate-400">Optional proxy and notification policy objects travel with the monitor and are stored in PostgreSQL.</p>
              <div className="mt-5 space-y-5">
                <div>
                  <label className="text-lg font-medium text-slate-200">Proxy Config</label>
                  <Textarea
                    className={`${textareaClassName} min-h-[120px]`}
                    value={form.proxyConfig ? JSON.stringify(form.proxyConfig, null, 2) : ""}
                    onChange={(event) => {
                      try {
                        const value = event.target.value.trim() ? JSON.parse(event.target.value) : null;
                        setForm((current) => ({ ...current, proxyConfig: value }));
                      } catch {
                        setForm((current) => current);
                      }
                    }}
                    placeholder='{"url":"http://proxy.internal:8080"}'
                  />
                </div>
                <div>
                  <label className="text-lg font-medium text-slate-200">Notification Policy</label>
                  <Textarea
                    className={`${textareaClassName} min-h-[120px]`}
                    value={form.notificationPolicy ? JSON.stringify(form.notificationPolicy, null, 2) : ""}
                    onChange={(event) => {
                      try {
                        const value = event.target.value.trim() ? JSON.parse(event.target.value) : null;
                        setForm((current) => ({ ...current, notificationPolicy: value }));
                      } catch {
                        setForm((current) => current);
                      }
                    }}
                    placeholder='{"ruleIds":["default-rule"]}'
                  />
                </div>
              </div>
            </section>
          </div>
        </div>
      </form>
    </motion.section>
  );
};
