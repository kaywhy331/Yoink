import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject
} from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  SignedObserverRecipeEnvelope,
  SignedObserverRecipePayload
} from "../../contracts/src/index.js";

const PRIVATE_KEY_FILE = "observer-recipe-ed25519-private.pem";
const PUBLIC_KEY_FILE = "observer-recipe-ed25519-public.pem";

function canonicalPayload(payload: SignedObserverRecipePayload): string {
  return JSON.stringify(payload);
}

export class ObserverRecipeSigner {
  readonly keyId: string;
  readonly publicKeySpki: string;

  private constructor(
    private readonly privateKey: KeyObject,
    private readonly publicKey: KeyObject
  ) {
    const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
    this.publicKeySpki = spki.toString("base64url");
    this.keyId = createHash("sha256").update(spki).digest("hex");
  }

  static ephemeral(): ObserverRecipeSigner {
    const pair = generateKeyPairSync("ed25519");
    return new ObserverRecipeSigner(pair.privateKey, pair.publicKey);
  }

  static persistent(dataDirectory: string): ObserverRecipeSigner {
    mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    const privatePath = join(dataDirectory, PRIVATE_KEY_FILE);
    const publicPath = join(dataDirectory, PUBLIC_KEY_FILE);
    let privateKey: KeyObject;
    if (existsSync(privatePath)) {
      privateKey = createPrivateKey(readFileSync(privatePath));
      chmodSync(privatePath, 0o600);
    } else {
      const pair = generateKeyPairSync("ed25519");
      privateKey = pair.privateKey;
      writeFileSync(privatePath, pair.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600, flag: "wx" });
      writeFileSync(publicPath, pair.publicKey.export({ type: "spki", format: "pem" }), { mode: 0o644, flag: "wx" });
    }
    const publicKey = createPublicKey(privateKey);
    if (!existsSync(publicPath)) {
      writeFileSync(publicPath, publicKey.export({ type: "spki", format: "pem" }), { mode: 0o644, flag: "wx" });
    }
    return new ObserverRecipeSigner(privateKey, publicKey);
  }

  envelope(payload: SignedObserverRecipePayload): SignedObserverRecipeEnvelope {
    const signature = sign(null, Buffer.from(canonicalPayload(payload), "utf8"), this.privateKey).toString("base64url");
    return {
      algorithm: "Ed25519",
      keyId: this.keyId,
      publicKeySpki: this.publicKeySpki,
      payload,
      signature
    };
  }

  verify(envelope: SignedObserverRecipeEnvelope): boolean {
    if (envelope.algorithm !== "Ed25519" || envelope.keyId !== this.keyId
      || envelope.publicKeySpki !== this.publicKeySpki || !/^[A-Za-z0-9_-]{80,120}$/.test(envelope.signature)) {
      return false;
    }
    return verify(
      null,
      Buffer.from(canonicalPayload(envelope.payload), "utf8"),
      this.publicKey,
      Buffer.from(envelope.signature, "base64url")
    );
  }
}
