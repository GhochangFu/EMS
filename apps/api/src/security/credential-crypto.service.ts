import { Injectable } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export type EncryptedPayload = {
  ciphertext: Buffer;
  iv: Buffer;
  keyVersion: number;
};

/** AES-256-GCM encrypt/decrypt for RTU connection credentials. */
@Injectable()
export class CredentialCryptoService {
  private readonly keyVersion = 1;

  private getKey(): Buffer {
    const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
    if (!raw) {
      throw new Error("CREDENTIAL_ENCRYPTION_KEY is required");
    }
    const key = Buffer.from(raw, "base64");
    if (key.length !== 32) {
      throw new Error("CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes (base64)");
    }
    return key;
  }

  /** Returns true when encryption key is configured (for optional dev paths). */
  static isConfigured(): boolean {
    try {
      const raw = process.env.CREDENTIAL_ENCRYPTION_KEY;
      if (!raw) {
        return false;
      }
      return Buffer.from(raw, "base64").length === 32;
    } catch {
      return false;
    }
  }

  /** Encrypts a JSON-serializable credential object. */
  encrypt(credentials: Record<string, unknown>): EncryptedPayload {
    const key = this.getKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, key, iv);
    const plaintext = Buffer.from(JSON.stringify(credentials), "utf8");
    const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return {
      ciphertext: Buffer.concat([encrypted, tag]),
      iv,
      keyVersion: this.keyVersion,
    };
  }

  /** Decrypts credentials ciphertext produced by encrypt(). */
  decrypt(ciphertext: Buffer, iv: Buffer): Record<string, unknown> {
    const key = this.getKey();
    if (ciphertext.length <= TAG_LENGTH) {
      throw new Error("Invalid credentials ciphertext");
    }
    const encrypted = ciphertext.subarray(0, ciphertext.length - TAG_LENGTH);
    const tag = ciphertext.subarray(ciphertext.length - TAG_LENGTH);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const parsed: unknown = JSON.parse(decrypted.toString("utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Decrypted credentials must be an object");
    }
    return parsed as Record<string, unknown>;
  }
}
