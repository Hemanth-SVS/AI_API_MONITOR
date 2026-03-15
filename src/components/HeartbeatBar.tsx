import { useRef, useState } from "react";

import type { MonitorCheck } from "@/types/monitoring";

interface HeartbeatBarProps {
  heartbeats: MonitorCheck[];
  maxBars?: number;
  height?: number;
}

const heartbeatClass = (status: MonitorCheck["status"] | "empty") => {
  if (status === "up") {
    return "bg-emerald-400";
  }

  if (status === "degraded") {
    return "bg-amber-400";
  }

  if (status === "down") {
    return "bg-rose-500";
  }

  if (status === "pending") {
    return "bg-slate-500";
  }

  return "bg-slate-700";
};

export const HeartbeatBar = ({ heartbeats, maxBars = 42, height = 32 }: HeartbeatBarProps) => {
  const [tooltip, setTooltip] = useState<{ x: number; text: string } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const displayBeats = heartbeats.slice(-maxBars);
  const filled = [...Array(Math.max(0, maxBars - displayBeats.length)).fill(null), ...displayBeats];

  const handleMouseEnter = (heartbeat: MonitorCheck, event: React.MouseEvent) => {
    if (!containerRef.current) {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const time = new Date(heartbeat.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const text = `${heartbeat.status.toUpperCase()} - ${heartbeat.latencyMs > 0 ? `${heartbeat.latencyMs}ms` : "No latency"} - ${time}`;
    setTooltip({ x, text });
  };

  return (
    <div ref={containerRef} className="relative flex items-center gap-[8px]" style={{ height }}>
      {filled.map((heartbeat, index) => (
        <div
          key={heartbeat?.id ?? `empty-${index}`}
          className={`flex-1 rounded-full transition-transform duration-150 hover:scale-y-[1.08] ${heartbeatClass(heartbeat?.status ?? "empty")}`}
          style={{ height: "100%", minWidth: 8 }}
          onMouseEnter={heartbeat ? (event) => handleMouseEnter(heartbeat, event) : undefined}
          onMouseLeave={() => setTooltip(null)}
        />
      ))}

      {tooltip ? (
        <div className="hb-tooltip" style={{ left: tooltip.x, top: -8 }}>
          {tooltip.text}
        </div>
      ) : null}
    </div>
  );
};
