import {
  buildOtpAuthUrl,
  createId,
  createOpaqueToken,
  decryptSecret,
  encryptSecret,
  generateTotpSecret,
  hashPassword,
  hashToken,
  nowIso,
  verifyPassword,
  verifyTotpCode,
} from "./security.mjs";
import { ensureSchema, one, query } from "./store.mjs";

const SESSION_COOKIE_NAME = "sentinel_session";
const SESSION_TTL_HOURS = Math.max(1, Number(process.env.SESSION_TTL_HOURS ?? 12));
const PASSWORD_RESET_TTL_MINUTES = Math.max(5, Number(process.env.PASSWORD_RESET_TTL_MINUTES ?? 20));

const safeUser = (row) =>
  row
    ? {
        id: row.id,
        email: row.email,
        name: row.name,
        role: row.role,
        totpEnabled: Boolean(row.totpEnabled),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        lastLoginAt: row.lastLoginAt ?? null,
      }
    : null;

const parseCookies = (headerValue) =>
  String(headerValue ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const separatorIndex = part.indexOf("=");

      if (separatorIndex === -1) {
        return cookies;
      }

      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();

      if (key) {
        cookies[key] = decodeURIComponent(value);
      }

      return cookies;
    }, {});

export const getSessionCookieName = () => SESSION_COOKIE_NAME;

export const createSessionCookie = (token, expiresAt) =>
  `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}`;

export const clearSessionCookie = () =>
  `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(0).toUTCString()}`;

export const getBootstrapState = async () => {
  await ensureSchema();
  const row = await one(`SELECT COUNT(*)::int AS "count" FROM "users"`);
  return {
    hasUsers: Number(row?.count ?? 0) > 0,
  };
};

const createSession = async ({ userId, userAgent, ipAddress }) => {
  const token = createOpaqueToken(32);
  const sessionId = createId("ses");
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000).toISOString();

  await query(
    `
      INSERT INTO "sessions" ("id", "userId", "tokenHash", "createdAt", "expiresAt", "lastSeenAt", "userAgent", "ipAddress")
      VALUES ($1, $2, $3, $4, $5, $4, $6, $7)
    `,
    [sessionId, userId, hashToken(token), createdAt, expiresAt, userAgent ?? null, ipAddress ?? null],
  );

  return {
    id: sessionId,
    token,
    expiresAt,
  };
};

export const bootstrapAdmin = async ({ email, name, password, userAgent, ipAddress }) => {
  await ensureSchema();
  const state = await getBootstrapState();

  if (state.hasUsers) {
    throw new Error("Bootstrap is disabled because an admin account already exists.");
  }

  if (!String(email ?? "").trim() || !String(password ?? "").trim()) {
    throw new Error("Email and password are required.");
  }

  const createdAt = nowIso();
  const userId = createId("usr");
  const passwordHash = await hashPassword(password);

  await query(
    `
      INSERT INTO "users" ("id", "email", "name", "role", "passwordHash", "isActive", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, 'admin', $4, TRUE, $5, $5)
    `,
    [userId, String(email).trim().toLowerCase(), String(name ?? "Administrator").trim() || "Administrator", passwordHash, createdAt],
  );

  const session = await createSession({
    userId,
    userAgent,
    ipAddress,
  });

  return {
    user: safeUser(
      await one(`SELECT * FROM "users" WHERE "id" = $1 LIMIT 1`, [userId]),
    ),
    session,
  };
};

export const login = async ({ email, password, totpCode, userAgent, ipAddress }) => {
  await ensureSchema();
  const user = await one(`SELECT * FROM "users" WHERE LOWER("email") = LOWER($1) LIMIT 1`, [String(email ?? "").trim()]);

  if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    throw new Error("Invalid email or password.");
  }

  if (!user.isActive) {
    throw new Error("This account is inactive.");
  }

  if (user.totpEnabled) {
    const secret = user.totpSecretEncrypted ? decryptSecret(user.totpSecretEncrypted) : null;

    if (!secret || !verifyTotpCode(secret, totpCode)) {
      throw new Error("A valid 2FA code is required.");
    }
  }

  const session = await createSession({
    userId: user.id,
    userAgent,
    ipAddress,
  });

  await query(`UPDATE "users" SET "lastLoginAt" = $2, "updatedAt" = $2 WHERE "id" = $1`, [user.id, nowIso()]);

  return {
    user: safeUser({ ...user, lastLoginAt: nowIso() }),
    session,
  };
};

export const getSessionFromRequest = async (request, { touch = true } = {}) => {
  await ensureSchema();
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[SESSION_COOKIE_NAME];

  if (!token) {
    return null;
  }

  const tokenHash = hashToken(token);
  const sessionRow = await one(
    `
      SELECT
        s.*,
        u."email",
        u."name",
        u."role",
        u."totpEnabled",
        u."createdAt" AS "userCreatedAt",
        u."updatedAt" AS "userUpdatedAt",
        u."lastLoginAt"
      FROM "sessions" s
      JOIN "users" u ON u."id" = s."userId"
      WHERE s."tokenHash" = $1
        AND s."expiresAt" > $2
        AND u."isActive" = TRUE
      LIMIT 1
    `,
    [tokenHash, nowIso()],
  );

  if (!sessionRow) {
    return null;
  }

  if (touch) {
    await query(`UPDATE "sessions" SET "lastSeenAt" = $2 WHERE "id" = $1`, [sessionRow.id, nowIso()]);
  }

  return {
    token,
    session: {
      id: sessionRow.id,
      userId: sessionRow.userId,
      expiresAt: sessionRow.expiresAt,
      lastSeenAt: sessionRow.lastSeenAt,
    },
    user: safeUser({
      id: sessionRow.userId,
      email: sessionRow.email,
      name: sessionRow.name,
      role: sessionRow.role,
      totpEnabled: sessionRow.totpEnabled,
      createdAt: sessionRow.userCreatedAt,
      updatedAt: sessionRow.userUpdatedAt,
      lastLoginAt: sessionRow.lastLoginAt,
    }),
  };
};

export const logout = async (token) => {
  if (!token) {
    return;
  }

  await ensureSchema();
  await query(`DELETE FROM "sessions" WHERE "tokenHash" = $1`, [hashToken(token)]);
};

export const requireSession = async (request) => {
  const session = await getSessionFromRequest(request);

  if (!session) {
    throw new Error("Authentication is required.");
  }

  return session;
};

export const setupTotp = async (userId, accountName) => {
  await ensureSchema();
  const user = await one(`SELECT * FROM "users" WHERE "id" = $1 LIMIT 1`, [userId]);

  if (!user) {
    throw new Error("User not found.");
  }

  const secret = generateTotpSecret();
  await query(
    `UPDATE "users" SET "totpSecretEncrypted" = $2, "totpEnabled" = FALSE, "updatedAt" = $3 WHERE "id" = $1`,
    [userId, encryptSecret(secret), nowIso()],
  );

  return {
    secret,
    otpauthUrl: buildOtpAuthUrl({
      accountName: accountName || user.email,
      secret,
    }),
  };
};

export const enableTotp = async (userId, code) => {
  await ensureSchema();
  const user = await one(`SELECT * FROM "users" WHERE "id" = $1 LIMIT 1`, [userId]);

  if (!user?.totpSecretEncrypted) {
    throw new Error("2FA setup has not been started.");
  }

  const secret = decryptSecret(user.totpSecretEncrypted);

  if (!verifyTotpCode(secret, code)) {
    throw new Error("The provided 2FA code is invalid.");
  }

  await query(`UPDATE "users" SET "totpEnabled" = TRUE, "updatedAt" = $2 WHERE "id" = $1`, [userId, nowIso()]);
  return true;
};

export const disableTotp = async (userId) => {
  await ensureSchema();
  await query(
    `UPDATE "users" SET "totpEnabled" = FALSE, "totpSecretEncrypted" = NULL, "updatedAt" = $2 WHERE "id" = $1`,
    [userId, nowIso()],
  );
};

export const changePassword = async ({ userId, currentPassword, nextPassword }) => {
  await ensureSchema();
  const user = await one(`SELECT * FROM "users" WHERE "id" = $1 LIMIT 1`, [userId]);

  if (!user || !user.passwordHash || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new Error("Current password is incorrect.");
  }

  await query(
    `UPDATE "users" SET "passwordHash" = $2, "updatedAt" = $3, "passwordResetTokenHash" = NULL, "passwordResetExpiresAt" = NULL WHERE "id" = $1`,
    [userId, await hashPassword(nextPassword), nowIso()],
  );
};

export const requestPasswordReset = async ({ email }) => {
  await ensureSchema();
  const user = await one(`SELECT * FROM "users" WHERE LOWER("email") = LOWER($1) LIMIT 1`, [String(email ?? "").trim()]);

  if (!user) {
    return {
      ok: true,
      previewToken: null,
      expiresAt: null,
    };
  }

  const token = createOpaqueToken(24);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000).toISOString();
  await query(
    `UPDATE "users" SET "passwordResetTokenHash" = $2, "passwordResetExpiresAt" = $3, "updatedAt" = $4 WHERE "id" = $1`,
    [user.id, hashToken(token), expiresAt, nowIso()],
  );

  return {
    ok: true,
    previewToken: token,
    expiresAt,
  };
};

export const confirmPasswordReset = async ({ token, password }) => {
  await ensureSchema();
  const tokenHash = hashToken(String(token ?? ""));
  const user = await one(
    `
      SELECT *
      FROM "users"
      WHERE "passwordResetTokenHash" = $1
        AND "passwordResetExpiresAt" > $2
      LIMIT 1
    `,
    [tokenHash, nowIso()],
  );

  if (!user) {
    throw new Error("This password reset token is invalid or expired.");
  }

  await query(
    `
      UPDATE "users"
      SET "passwordHash" = $2,
          "passwordResetTokenHash" = NULL,
          "passwordResetExpiresAt" = NULL,
          "updatedAt" = $3
      WHERE "id" = $1
    `,
    [user.id, await hashPassword(password), nowIso()],
  );

  await query(`DELETE FROM "sessions" WHERE "userId" = $1`, [user.id]);
};

export const listApiKeys = async () => {
  await ensureSchema();
  const rows = await query(
    `
      SELECT "id", "label", "scope", "createdAt", "lastUsedAt", "revokedAt"
      FROM "api_keys"
      ORDER BY "createdAt" DESC
    `,
  );

  return rows.rows;
};

export const createApiKey = async ({ label, scope, createdByUserId }) => {
  await ensureSchema();
  const rawKey = `sentinel_${createOpaqueToken(24)}`;
  const row = {
    id: createId("key"),
    label: String(label ?? "").trim() || "Metrics Key",
    scope: String(scope ?? "metrics").trim() || "metrics",
    createdAt: nowIso(),
  };

  await query(
    `
      INSERT INTO "api_keys" ("id", "label", "scope", "keyHash", "createdAt", "createdByUserId")
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
    [row.id, row.label, row.scope, hashToken(rawKey), row.createdAt, createdByUserId ?? null],
  );

  return {
    ...row,
    token: rawKey,
  };
};

export const revokeApiKey = async (apiKeyId) => {
  await ensureSchema();
  await query(`UPDATE "api_keys" SET "revokedAt" = $2 WHERE "id" = $1`, [apiKeyId, nowIso()]);
};

export const authenticateApiKey = async (request, requiredScope = "metrics") => {
  await ensureSchema();
  const header = request.headers.authorization ?? request.headers["x-api-key"] ?? "";
  const token = String(header).startsWith("Bearer ") ? String(header).slice(7).trim() : String(header).trim();

  if (!token) {
    return null;
  }

  const apiKey = await one(
    `
      SELECT *
      FROM "api_keys"
      WHERE "keyHash" = $1
        AND "revokedAt" IS NULL
      LIMIT 1
    `,
    [hashToken(token)],
  );

  if (!apiKey) {
    return null;
  }

  if (!(apiKey.scope === "*" || apiKey.scope === requiredScope)) {
    return null;
  }

  await query(`UPDATE "api_keys" SET "lastUsedAt" = $2 WHERE "id" = $1`, [apiKey.id, nowIso()]);
  return apiKey;
};

