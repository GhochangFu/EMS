import { createDecipheriv } from "node:crypto";

const TAG_LENGTH = 16;

/** Returns true when CREDENTIAL_ENCRYPTION_KEY is set. */
export function isCredentialKeyConfigured() {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    return false;
  }
  try {
    return Buffer.from(raw, "base64").length === 32;
  } catch {
    return false;
  }
}

/** Decrypts AES-256-GCM credentials stored by the API onboarding flow. */
export function decryptCredentials(ciphertext, iv) {
  const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("CREDENTIAL_ENCRYPTION_KEY is required");
  }
  const key = Buffer.from(raw, "base64");
  const encrypted = ciphertext.subarray(0, ciphertext.length - TAG_LENGTH);
  const tag = ciphertext.subarray(ciphertext.length - TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(decrypted.toString("utf8"));
}

/** Resolves MQTT connection options from per-RTU config or global env. */
export function resolveMqttConnection(configRow) {
  const globalHost = process.env.MQTT_HOST ?? "phe.thinkiot.co.in";
  const globalPort = Number(process.env.MQTT_PORT ?? "8883");
  const globalUser = process.env.MQTT_USERNAME;
  const globalPass = process.env.MQTT_PASSWORD;

  if (!configRow) {
    return {
      host: globalHost,
      port: globalPort,
      username: globalUser,
      password: globalPass,
      source: "env",
    };
  }

  const cfg = configRow.config ?? {};
  let username = globalUser;
  let password = globalPass;
  if (
    configRow.credentials_ciphertext &&
    configRow.credentials_iv &&
    isCredentialKeyConfigured()
  ) {
    const creds = decryptCredentials(
      configRow.credentials_ciphertext,
      configRow.credentials_iv,
    );
    if (typeof creds.username === "string") {
      username = creds.username;
    }
    if (typeof creds.password === "string") {
      password = creds.password;
    }
  }

  return {
    host: typeof cfg.host === "string" ? cfg.host : globalHost,
    port: typeof cfg.port === "number" ? cfg.port : globalPort,
    username,
    password,
    source: "db",
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/** Unit checks for env fallback resolution. */
export function runRtuConfigTests() {
  process.env.MQTT_HOST = "broker.example.com";
  process.env.MQTT_PORT = "8883";
  process.env.MQTT_USERNAME = "u";
  process.env.MQTT_PASSWORD = "p";
  const conn = resolveMqttConnection(null);
  assert(conn.host === "broker.example.com", "env host");
  assert(conn.source === "env", "env source");
  delete process.env.MQTT_HOST;
  delete process.env.MQTT_PORT;
  delete process.env.MQTT_USERNAME;
  delete process.env.MQTT_PASSWORD;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}`) {
  runRtuConfigTests();
  process.stdout.write("rtu-config tests: ok\n");
}
