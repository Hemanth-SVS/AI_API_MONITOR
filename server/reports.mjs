import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { nowIso } from "./security.mjs";

const REPORT_ROOT = path.resolve(process.cwd(), "server", "runtime", "reports");

const safeFilePart = (value) =>
  String(value ?? "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

export const buildIncidentReport = ({ incident, monitor, analysis, timeline }) => {
  const summary = analysis?.reportSummary ?? incident.summary;
  const markdown = [
    `# ${incident.title}`,
    "",
    `- Generated: ${nowIso()}`,
    `- Monitor: ${monitor.name} (${monitor.id})`,
    `- Status: ${incident.status}`,
    `- Severity: ${incident.severity}`,
    `- Opened: ${incident.openedAt}`,
    incident.resolvedAt ? `- Resolved: ${incident.resolvedAt}` : null,
    "",
    "## Summary",
    "",
    summary,
    "",
    "## Root Cause",
    "",
    analysis?.probableRootCause ?? "No structured root cause has been stored yet.",
    "",
    "## Suggested Fixes",
    "",
    ...(analysis?.suggestedFixes?.length ? analysis.suggestedFixes.map((item) => `- ${item}`) : ["- No suggested fixes stored yet."]),
    "",
    "## Recommended Checks",
    "",
    ...(analysis?.recommendedChecks?.length
      ? analysis.recommendedChecks.map((item) => `- ${item}`)
      : ["- No recommended checks stored yet."]),
    "",
    "## Timeline",
    "",
    ...(timeline?.length
      ? timeline.map((event) => `- ${event.timestamp}: ${event.title} - ${event.message}`)
      : ["- No timeline events have been recorded yet."]),
  ]
    .filter(Boolean)
    .join("\n");

  return {
    title: incident.title,
    summary,
    markdown,
    jsonPayload: {
      incident,
      monitor,
      analysis,
      timeline,
    },
  };
};

export const writeReportArtifacts = async ({ incidentId, version, report }) => {
  const folderName = safeFilePart(incidentId) || "incident";
  const filePrefix = `v${version}-${safeFilePart(report.title) || "report"}`;
  const outputDir = path.join(REPORT_ROOT, folderName);
  await mkdir(outputDir, { recursive: true });

  const basePath = path.join(outputDir, filePrefix);
  await Promise.all([
    writeFile(`${basePath}.md`, report.markdown, "utf8"),
    writeFile(`${basePath}.json`, JSON.stringify(report.jsonPayload, null, 2), "utf8"),
  ]);

  return basePath;
};

