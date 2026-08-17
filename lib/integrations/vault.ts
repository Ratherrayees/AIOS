import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

import type { IntegrationSecrets } from "./catalog";

const VAULT_ENV_NAME = "TENANT_INTEGRATION_ENCRYPTION_KEY";

function readVaultKey() {
  const encoded = process.env[VAULT_ENV_NAME]?.trim();
  if (!encoded) {
    throw new Error(
      `${VAULT_ENV_NAME} is required before tenant credentials can be saved.`,
    );
  }

  const key = /^[0-9a-f]{64}$/i.test(encoded)
    ? Buffer.from(encoded, "hex")
    : Buffer.from(encoded, "base64url");
  if (key.length !== 32) {
    throw new Error(`${VAULT_ENV_NAME} must decode to exactly 32 bytes.`);
  }
  return key;
}

export function isIntegrationVaultConfigured() {
  try {
    readVaultKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptIntegrationSecrets(secrets: IntegrationSecrets) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", readVaultKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(secrets), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptIntegrationSecrets(value: string) {
  const [version, encodedIv, encodedTag, encodedCiphertext, extra] =
    value.split(".");
  if (
    version !== "v1" ||
    !encodedIv ||
    !encodedTag ||
    !encodedCiphertext ||
    extra
  ) {
    throw new Error("The stored tenant credential envelope is invalid.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    readVaultKey(),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
  const parsed = JSON.parse(plaintext) as unknown;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.values(parsed).some((item) => typeof item !== "string")
  ) {
    throw new Error("The stored tenant credentials have an invalid shape.");
  }
  return parsed as IntegrationSecrets;
}

