import nodemailer from "nodemailer";

import { decryptSecret, encryptSecret } from "./security.mjs";

const safeObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

export const serializeChannelConfig = (config) => {
  const normalized = safeObject(config);
  return {
    configEncrypted: encryptSecret(JSON.stringify(normalized)),
    configPreview: redactChannelConfig(normalized),
  };
};

export const deserializeChannelConfig = (row) => {
  if (!row?.configEncrypted) {
    return {};
  }

  try {
    return safeObject(JSON.parse(decryptSecret(row.configEncrypted)));
  } catch {
    return {};
  }
};

export const redactChannelConfig = (config) => {
  const normalized = safeObject(config);
  const preview = { ...normalized };

  for (const key of Object.keys(preview)) {
    if (/token|secret|password|key|webhook/i.test(key) && preview[key]) {
      preview[key] = "••••••••";
    }
  }

  return preview;
};

export const renderIncidentMessage = ({ eventType, incident, monitor, report, dashboardUrl }) => {
  const headline = `${eventType.toUpperCase()}: ${monitor.name} is ${monitor.status}`;
  const lines = [
    headline,
    `Monitor: ${monitor.name}`,
    `Type: ${monitor.type}`,
    monitor.url ? `Target: ${monitor.url}` : null,
    `Severity: ${incident?.severity ?? "info"}`,
    `Summary: ${report?.summary ?? incident?.summary ?? monitor.summary ?? "No summary available."}`,
    report?.markdown ? `Report Version: v${report.version}` : null,
    dashboardUrl ? `Dashboard: ${dashboardUrl}` : null,
  ].filter(Boolean);

  return {
    text: lines.join("\n"),
    title: headline,
  };
};

const sendWebhook = async (url, payload, headers = {}) => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Webhook returned HTTP ${response.status}`);
  }

  return {
    status: response.status,
    summary: `Webhook delivered with HTTP ${response.status}`,
  };
};

const sendEmail = async (config, message) => {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: Number(config.port ?? 587),
    secure: Boolean(config.secure),
    auth:
      config.user || config.password
        ? {
            user: config.user,
            pass: config.password,
          }
        : undefined,
  });

  const info = await transport.sendMail({
    from: config.from,
    to: config.to,
    subject: message.title,
    text: message.text,
  });

  return {
    status: 200,
    summary: `Email accepted with message id ${info.messageId}`,
  };
};

const sendSlack = async (config, message) =>
  sendWebhook(config.webhookUrl, {
    text: `*${message.title}*\n${message.text}`,
  });

const sendDiscord = async (config, message) =>
  sendWebhook(config.webhookUrl, {
    content: `**${message.title}**\n${message.text}`,
  });

const sendTelegram = async (config, message) => {
  const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: config.chatId,
      text: message.text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Telegram returned HTTP ${response.status}`);
  }

  return {
    status: response.status,
    summary: `Telegram delivered with HTTP ${response.status}`,
  };
};

export const deliverNotification = async ({ channel, payload }) => {
  const config = deserializeChannelConfig(channel);
  const message = renderIncidentMessage(payload);

  switch (channel.type) {
    case "webhook":
      return sendWebhook(config.url, {
        title: message.title,
        text: message.text,
        event: payload.eventType,
        incident: payload.incident,
        monitor: payload.monitor,
        report: payload.report,
      }, config.headers ?? {});
    case "email":
      return sendEmail(config, message);
    case "slack":
      return sendSlack(config, message);
    case "discord":
      return sendDiscord(config, message);
    case "telegram":
      return sendTelegram(config, message);
    default:
      throw new Error(`Unsupported notification channel type "${channel.type}".`);
  }
};

