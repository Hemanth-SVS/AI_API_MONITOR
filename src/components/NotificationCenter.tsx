import { useState } from "react";
import { Bell, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { MonitorSummary, NotificationChannel, NotificationRule } from "@/types/monitoring";

interface NotificationCenterProps {
  channels: NotificationChannel[];
  rules: NotificationRule[];
  monitors: MonitorSummary[];
  onSaveChannel: (payload: Record<string, unknown>) => Promise<unknown>;
  onDeleteChannel: (channelId: string) => Promise<unknown>;
  onTestChannel: (channelId: string) => Promise<unknown>;
  onSaveRule: (payload: Record<string, unknown>) => Promise<unknown>;
  onDeleteRule: (ruleId: string) => Promise<unknown>;
}

export const NotificationCenter = ({
  channels,
  rules,
  monitors,
  onSaveChannel,
  onDeleteChannel,
  onTestChannel,
  onSaveRule,
  onDeleteRule,
}: NotificationCenterProps) => {
  const [channelName, setChannelName] = useState("");
  const [channelType, setChannelType] = useState("webhook");
  const [channelConfigText, setChannelConfigText] = useState("{}");
  const [ruleName, setRuleName] = useState("");
  const [ruleTags, setRuleTags] = useState("");

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <section className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-emerald-300" />
          <h2 className="text-[1.6rem] font-semibold text-white">Notification Channels</h2>
        </div>
        <div className="mt-5 space-y-4">
          <Input className="border-white/10 bg-[#0b1118]" value={channelName} onChange={(event) => setChannelName(event.target.value)} placeholder="Primary Slack" />
          <select value={channelType} onChange={(event) => setChannelType(event.target.value)} className="h-11 w-full rounded-xl border border-white/10 bg-[#0b1118] px-4 text-slate-100">
            {["webhook", "email", "slack", "telegram", "discord"].map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <Textarea className="min-h-[140px] border-white/10 bg-[#0b1118]" value={channelConfigText} onChange={(event) => setChannelConfigText(event.target.value)} placeholder='{"url":"https://hooks.example.com"}' />
          <Button
            className="rounded-full bg-emerald-400 text-[#04110c] hover:bg-emerald-300"
            onClick={async () => {
              await onSaveChannel({
                name: channelName,
                type: channelType,
                config: channelConfigText.trim() ? JSON.parse(channelConfigText) : {},
              });
              setChannelName("");
              setChannelConfigText("{}");
            }}
          >
            Save Channel
          </Button>
        </div>

        <div className="mt-6 space-y-3">
          {channels.map((channel) => (
            <div key={channel.id} className="rounded-[1.15rem] border border-white/8 bg-[#0b1118] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-100">{channel.name}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.18em] text-slate-500">{channel.type}</p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" className="border-white/10 bg-transparent" onClick={() => void onTestChannel(channel.id)}>
                    <Send className="h-4 w-4" />
                    Test
                  </Button>
                  <Button variant="outline" className="border-rose-300/10 bg-transparent text-rose-300" onClick={() => void onDeleteChannel(channel.id)}>
                    Delete
                  </Button>
                </div>
              </div>
              <pre className="mt-3 overflow-auto rounded-[1rem] border border-white/6 bg-[#070b10] px-3 py-3 text-xs text-slate-300">
                {JSON.stringify(channel.configPreview, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[2rem] border border-white/8 bg-[#11161f] p-6">
        <h2 className="text-[1.6rem] font-semibold text-white">Notification Rules</h2>
        <div className="mt-5 space-y-4">
          <Input className="border-white/10 bg-[#0b1118]" value={ruleName} onChange={(event) => setRuleName(event.target.value)} placeholder="Critical Monitors" />
          <Input className="border-white/10 bg-[#0b1118]" value={ruleTags} onChange={(event) => setRuleTags(event.target.value)} placeholder="critical, customer-facing" />
          <Button
            className="rounded-full bg-emerald-400 text-[#04110c] hover:bg-emerald-300"
            onClick={() =>
              void onSaveRule({
                name: ruleName,
                tags: ruleTags
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter(Boolean),
                eventTypes: ["opened", "updated", "recovered"],
                channelIds: channels.slice(0, 1).map((channel) => channel.id),
                monitorIds: monitors.slice(0, 3).map((monitor) => monitor.id),
              })
            }
          >
            Save Rule
          </Button>
        </div>

        <div className="mt-6 space-y-3">
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-[1.15rem] border border-white/8 bg-[#0b1118] px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-100">{rule.name}</p>
                  <p className="mt-1 text-xs text-slate-500">{rule.eventTypes.join(", ")}</p>
                </div>
                <Button variant="outline" className="border-rose-300/10 bg-transparent text-rose-300" onClick={() => void onDeleteRule(rule.id)}>
                  Delete
                </Button>
              </div>
              <p className="mt-3 text-xs text-slate-500">Tags: {rule.tags.join(", ") || "none"} - Channels: {rule.channelIds.length}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
