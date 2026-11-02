import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Encryption contexts bind secrets to their tenant, owner and record. */
export class BotSecretVault {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32) throw new Error("YoinkBot needs a 32-byte encryption key.");
  }

  encrypt(value: unknown, context: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(context));
    const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return [nonce, cipher.getAuthTag(), body].map(part => part.toString("base64url")).join(".");
  }

  decrypt<T>(value: string, context: string): T {
    const [nonce, tag, body] = value.split(".").map(part => Buffer.from(part, "base64url"));
    const cipher = createDecipheriv("aes-256-gcm", this.key, nonce!);
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(tag!);
    return JSON.parse(Buffer.concat([cipher.update(body!), cipher.final()]).toString("utf8")) as T;
  }
}
