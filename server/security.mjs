import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const DEFAULT_SECRET = "auto-ops-sentinel-development-secret";

const getAppSecret = () => {
  const configured =
    process.env.SENTINEL_APP_SECRET ??
    process.env.APP_SECRET ??
    process.env.SLM_SECRET ??
    DEFAULT_SECRET;

  return createHash("sha256").update(String(configured)).digest();
};

const base32ValueMap = BASE32_ALPHABET.split("").reduce((map, char, index) => {
  map[char] = index;
  return map;
}, {});

export const nowIso = () => new Date().toISOString();

export const createId = (prefix) => `${prefix}-${randomBytes(4).toString("hex")}`;

export const createOpaqueToken = (bytes = 32) => randomBytes(bytes).toString("base64url");

export const hashToken = (token) => createHash("sha256").update(String(token)).digest("hex");

export const hashPassword = async (password) => {
  const salt = randomBytes(16).toString("base64url");
  const derived = await scrypt(String(password), salt, 64);
  return `${salt}:${Buffer.from(derived).toString("base64url")}`;
};

export const verifyPassword = async (password, storedHash) => {
  const [salt, expected] = String(storedHash ?? "").split(":");

  if (!salt || !expected) {
    return false;
  }

  const actual = Buffer.from(await scrypt(String(password), salt, 64));
  const expectedBuffer = Buffer.from(expected, "base64url");

  if (actual.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actual, expectedBuffer);
};

export const encryptSecret = (value) => {
  if (value == null || value === "") {
    return null;
  }

  const key = getAppSecret();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(String(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `v1:${iv.toString("base64url")}:${authTag.toString("base64url")}:${ciphertext.toString("base64url")}`;
};

export const decryptSecret = (value) => {
  if (!value) {
    return null;
  }

  const [version, ivPart, tagPart, ciphertextPart] = String(value).split(":");

  if (version !== "v1" || !ivPart || !tagPart || !ciphertextPart) {
    throw new Error("Encrypted secret has an unsupported format.");
  }

  const decipher = createDecipheriv("aes-256-gcm", getAppSecret(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, "base64url")),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
};

const normalizeBase32 = (value) =>
  String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, "");

export const encodeBase32 = (buffer) => {
  let bits = "";
  let output = "";

  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, "0");
  }

  while (bits.length >= 5) {
    output += BASE32_ALPHABET[Number.parseInt(bits.slice(0, 5), 2)];
    bits = bits.slice(5);
  }

  if (bits.length > 0) {
    output += BASE32_ALPHABET[Number.parseInt(bits.padEnd(5, "0"), 2)];
  }

  return output;
};

export const decodeBase32 = (value) => {
  const normalized = normalizeBase32(value);
  let bits = "";

  for (const char of normalized) {
    const nextValue = base32ValueMap[char];

    if (nextValue == null) {
      continue;
    }

    bits += nextValue.toString(2).padStart(5, "0");
  }

  const bytes = [];
  while (bits.length >= 8) {
    bytes.push(Number.parseInt(bits.slice(0, 8), 2));
    bits = bits.slice(8);
  }

  return Buffer.from(bytes);
};

export const generateTotpSecret = () => encodeBase32(randomBytes(20));

export const generateTotpCode = (secret, timestamp = Date.now(), stepSeconds = 30) => {
  const counter = Math.floor(timestamp / 1000 / stepSeconds);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac("sha1", decodeBase32(secret)).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(code % 1_000_000).padStart(6, "0");
};

export const verifyTotpCode = (secret, code, window = 1) => {
  const normalizedCode = String(code ?? "").trim();

  if (!/^\d{6}$/.test(normalizedCode)) {
    return false;
  }

  for (let offset = -window; offset <= window; offset += 1) {
    const timestamp = Date.now() + offset * 30_000;
    const expected = generateTotpCode(secret, timestamp);

    if (expected === normalizedCode) {
      return true;
    }
  }

  return false;
};

export const buildOtpAuthUrl = ({ issuer = "Auto-Ops Sentinel", accountName, secret }) => {
  const safeIssuer = encodeURIComponent(issuer);
  const safeAccount = encodeURIComponent(String(accountName ?? "operator"));
  const safeSecret = encodeURIComponent(String(secret));
  return `otpauth://totp/${safeIssuer}:${safeAccount}?secret=${safeSecret}&issuer=${safeIssuer}&algorithm=SHA1&digits=6&period=30`;
};

