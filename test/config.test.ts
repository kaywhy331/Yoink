import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../apps/api/src/config.js";

test("configuration keeps hosted authentication disabled by default", () => {
  const config = loadConfig(process.cwd(), {});
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.hosted, null);
});

test("hosted configuration requires a strong proxy secret and explicit Host/Origin allowlists", () => {
  assert.throws(() => loadConfig(process.cwd(), { YOINK_HOSTED_MODE: "1" }), /requires a 32-byte/);
  const config = loadConfig(process.cwd(), {
    YOINK_HOSTED_MODE: "1",
    YOINK_HOSTED_PROXY_SECRET: "a-secret-value-that-is-at-least-thirty-two-bytes",
    YOINK_HOSTED_HOSTS: "yoink.example.com,internal.example.com:443",
    YOINK_HOSTED_ORIGINS: "https://yoink.example.com"
  });
  assert.deepEqual(config.hosted, {
    proxySecret: "a-secret-value-that-is-at-least-thirty-two-bytes",
    allowedHosts: ["yoink.example.com", "internal.example.com:443"],
    allowedOrigins: ["https://yoink.example.com"]
  });
});
