import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import type { MonitorCheck } from "@/types/monitoring";

interface LatencyChartProps {
  heartbeats: MonitorCheck[];
  monitorName: string;
}

type RangeKey = "recent" | "extended" | "all";

const rangeSizes: Record<RangeKey, number | null> = {
  recent: 16,
  extended: 36,
  all: null,
};

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ payload: { latency: number; status: string; statusCode: number | null; timestamp: string } }>;
}

const ChartTooltip = ({ active, payload }: TooltipProps) => {
  if (!active || !payload?.length) {
    return null;
  }

  const point = payload[0].payload;

  return (
    <div className="rounded-2xl border border-white/10 bg-[#111823]/95 px-4 py-3 text-xs text-slate-200 shadow-[0_18px_40px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <p className="font-mono uppercase tracking-[0.18em] text-slate-500">{point.timestamp}</p>
      <p className="mt-2 text-lg font-semibold text-white">{point.latency}ms</p>
      <p className="mt-1 text-slate-400">
        {point.status}
        {point.statusCode ? ` - HTTP ${point.statusCode}` : ""}
      </p>
    </div>
  );
};

export const LatencyChart = ({ heartbeats, monitorName }: LatencyChartProps) => {
  const [range, setRange] = useState<RangeKey>("extended");

  const data = useMemo(() => {
    const usable = [...heartbeats]
      .filter((heartbeat) => heartbeat.latencyMs > 0)
      .sort((left, right) => new Date(left.checkedAt).getTime() - new Date(right.checkedAt).getTime());

    const size = rangeSizes[range];
    const sliced = size ? usable.slice(-size) : usable;

    return sliced.map((heartbeat) => ({
      id: heartbeat.id,
      timestamp: new Date(heartbeat.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      latency: heartbeat.latencyMs,
      status: heartbeat.status,
      statusCode: heartbeat.statusCode,
    }));
  }, [heartbeats, range]);

  const average = data.length ? Math.round(data.reduce((total, point) => total + point.latency, 0) / data.length) : 0;

  if (data.length === 0) {
    return (
      <section className="rounded-[1.6rem] border border-white/8 bg-[#11161f] px-5 py-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-slate-500">Response Time</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">{monitorName}</h3>
          </div>
        </div>
        <div className="mt-4 flex h-[220px] items-center justify-center rounded-[1.5rem] border border-dashed border-white/10 bg-[#0b1016] text-sm text-slate-400">
          Response-time points will appear after healthy checks record latency.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-[1.6rem] border border-white/8 bg-[#11161f] px-5 py-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-slate-500">Response Time</p>
          <h3 className="mt-2 text-2xl font-semibold text-white">Latency</h3>
          <p className="mt-1 text-xs text-slate-400">Recent response times for this monitor.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm text-emerald-100">
            <span className="h-3 w-8 rounded-full border border-emerald-300/60 bg-emerald-400/20" />
            Avg Ping {average}ms
          </div>

          <label className="relative block">
            <select
              value={range}
              onChange={(event) => setRange(event.target.value as RangeKey)}
              className="h-11 appearance-none rounded-full border border-white/10 bg-[#0b1118] px-4 pr-10 text-sm text-slate-100 outline-none transition focus:border-emerald-400/40"
            >
              <option value="recent">Recent</option>
              <option value="extended">Extended</option>
              <option value="all">All Recorded</option>
            </select>
            <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-slate-500">v</span>
          </label>
        </div>
      </div>

      <div className="mt-4 h-[260px] rounded-[1.5rem] border border-white/6 bg-[#0b1016] px-3 py-3">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 18, right: 24, left: 8, bottom: 8 }}>
            <defs>
              <linearGradient id="latency-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5EEA8A" stopOpacity={0.34} />
                <stop offset="75%" stopColor="#5EEA8A" stopOpacity={0.08} />
                <stop offset="100%" stopColor="#5EEA8A" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(148, 163, 184, 0.12)" vertical={false} />
            <XAxis dataKey="timestamp" tick={{ fontSize: 12, fill: "#768396" }} axisLine={false} tickLine={false} minTickGap={12} />
            <YAxis tick={{ fontSize: 12, fill: "#768396" }} axisLine={false} tickLine={false} width={52} unit="ms" />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(94, 234, 138, 0.25)", strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey="latency"
              stroke="#5EEA8A"
              strokeWidth={3}
              fill="url(#latency-fill)"
              activeDot={{ r: 5, fill: "#5EEA8A", stroke: "#08100c", strokeWidth: 2 }}
              animationDuration={700}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
};
