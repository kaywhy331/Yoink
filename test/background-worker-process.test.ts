import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { loadWorkerConfig } from "../apps/worker/src/config.js";
import { ObserverRecipeSigner } from "../packages/observer-registry/src/signer.js";
import { SqliteBackgroundWorkerStore } from "../packages/database/src/background-worker-store.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

async function eventually(assertion: () => void | Promise<void>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw lastError ?? new Error("The expected standalone worker state did not arrive.");
}

function capture(child: ChildProcessWithoutNullStreams): { output: () => string } {
  let value = "";
  const append = (chunk: Buffer) => {
    value = `${value}${chunk.toString("utf8")}`.slice(-20_000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return { output: () => value };
}

test("standalone worker configuration is bounded and attests public connector references without retaining secrets", () => {
  const workerSource = readFileSync(join(process.cwd(), "apps", "worker", "src", "server.ts"), "utf8");
  assert.match(workerSource, /witnessVerificationOnly\(config\.dataDirectory\)/);
  assert.doesNotMatch(workerSource, /ObserverRecipeTrustAuthority\.persistent/);
  const config = loadWorkerConfig(process.cwd(), {
    YOINK_DATA_DIR: "worker-data",
    YOINK_WORKER_ID: "worker_process_01",
    YOINK_WORKER_POLL_MS: "750",
    YOINK_WORKER_LEASE_SECONDS: "45",
    YOINK_WORKER_PRINCIPALS_PER_CYCLE: "25",
    YOINK_WORKER_TASKS_PER_CYCLE: "80",
    YOINK_WORKER_TASKS_PER_PRINCIPAL: "8"
  });
  assert.equal(config.workerId, "worker_process_01");
  assert.equal(config.pollIntervalMs, 750);
  assert.equal(config.leaseSeconds, 45);
  assert.equal(config.maximumPrincipalsPerCycle, 25);
  assert.equal(config.maximumTasksPerCycle, 80);
  assert.equal(config.maximumTasksPerPrincipal, 8);
  assert.equal(config.observerRecipeWitness, null);
  assert.equal(config.observerRecipeWitnessRequired, false);
  assert.deepEqual(config.operatorAlertWebhookRegistry.definitions, []);
  assert.match(config.deploymentFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(Object.keys(config).some((key) => /secret|token|password|credential/i.test(key)), false);
  assert.throws(() => loadWorkerConfig(process.cwd(), { YOINK_WORKER_ID: "bad worker" }), /WORKER_ID/);
  assert.throws(() => loadWorkerConfig(process.cwd(), { YOINK_WORKER_POLL_MS: "499" }), /500 through 60000/);
  assert.throws(() => loadWorkerConfig(process.cwd(), { YOINK_DATA_DIR: "" }), /non-empty directory/);

  assert.throws(
    () => loadWorkerConfig(process.cwd(), { YOINK_HOSTED_MODE: "1", YOINK_DATA_DIR: "/srv/yoink-data" }),
    /Hosted workers require an independently operated observer recipe witness/
  );
  const witness = ObserverRecipeSigner.ephemeral();
  const hosted = loadWorkerConfig(process.cwd(), {
    YOINK_HOSTED_MODE: "1",
    YOINK_DATA_DIR: "/srv/yoink-data",
    YOINK_OBSERVER_RECIPE_WITNESS_URL: "https://witness.example.net/v1/checkpoints",
    YOINK_OBSERVER_RECIPE_WITNESS_LOG_ID: "yoink-production",
    YOINK_OBSERVER_RECIPE_WITNESS_KEY_ID: witness.keyId,
    YOINK_OBSERVER_RECIPE_WITNESS_PUBLIC_KEY_SPKI: witness.publicKeySpki
  });
  assert.equal(hosted.observerRecipeWitnessRequired, true);
  assert.equal(hosted.observerRecipeWitness?.key.keyId, witness.keyId);
  assert.notEqual(hosted.deploymentFingerprint, config.deploymentFingerprint);
  const hostedWithDifferentFreshness = loadWorkerConfig(process.cwd(), {
    YOINK_HOSTED_MODE: "1",
    YOINK_DATA_DIR: "/srv/yoink-data",
    YOINK_OBSERVER_RECIPE_WITNESS_URL: "https://witness.example.net/v1/checkpoints",
    YOINK_OBSERVER_RECIPE_WITNESS_LOG_ID: "yoink-production",
    YOINK_OBSERVER_RECIPE_WITNESS_KEY_ID: witness.keyId,
    YOINK_OBSERVER_RECIPE_WITNESS_PUBLIC_KEY_SPKI: witness.publicKeySpki,
    YOINK_OBSERVER_RECIPE_WITNESS_MAX_AGE_SECONDS: "600"
  });
  assert.notEqual(hostedWithDifferentFreshness.deploymentFingerprint, hosted.deploymentFingerprint);

  const connectorConfigured = loadWorkerConfig(process.cwd(), {
    YOINK_OPERATOR_ALERT_WEBHOOKS_JSON: JSON.stringify([{
      reference: "ops_primary",
      endpoint: "https://alerts.example.com/v1/yoink",
      signingSecretEnvironment: "YOINK_OPERATOR_ALERT_WEBHOOK_SECRET_OPS_PRIMARY"
    }])
  });
  assert.notEqual(connectorConfigured.deploymentFingerprint, config.deploymentFingerprint);
  assert.equal(JSON.stringify(connectorConfigured).includes("signing-secret-value"), false);
});

test("the standalone worker fails closed and redacts startup errors before API initialization", async () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-uninitialized-worker-"));
  const child = spawn(process.execPath, ["--import", "tsx", "apps/worker/src/server.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, YOINK_DATA_DIR: directory },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const captured = capture(child);
  try {
    const [exitCode] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
    // A database the API has not migrated yet is transient: exit 1 so the
    // supervisor retries, and keep 78 for configuration errors (API-24).
    assert.equal(exitCode, 1);
    assert.match(captured.output(), /could not start: The Yoink database must be initialized and migrated by the API/);
    assert.equal(captured.output().includes(directory), false);
    assert.equal(existsSync(join(directory, "yoink.sqlite")), false);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a separate worker process serves every principal and drives truthful external API health", async () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-standalone-worker-"));
  const workerId = "background_worker_process_test";
  const initialized = new YoinkDatabase(join(directory, "yoink.sqlite"));
  initialized.run(
    "INSERT INTO tenants(id, name, created_at) VALUES ('tenant_process_second', 'Second', ?)",
    new Date().toISOString()
  );
  initialized.run(
    "INSERT INTO users(id, tenant_id, display_name, created_at) VALUES ('user_process_second', 'tenant_process_second', 'Second', ?)",
    new Date().toISOString()
  );
  const workerEnvironment = {
    ...process.env,
    YOINK_DATA_DIR: directory,
    YOINK_WORKER_ID: workerId,
    YOINK_WORKER_POLL_MS: "500"
  };
  const workerConfig = loadWorkerConfig(process.cwd(), workerEnvironment);
  new SqliteBackgroundWorkerStore(initialized, { principalMode: "all" }).configureDeploymentExpectation(
    "external",
    workerConfig.deploymentFingerprint,
    workerConfig.version
  );
  initialized.close();
  const child = spawn(process.execPath, ["--import", "tsx", "apps/worker/src/server.ts"], {
    cwd: process.cwd(),
    env: workerEnvironment,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const captured = capture(child);
  let db: YoinkDatabase | null = null;
  let server: ReturnType<typeof createYoinkServer> | null = null;
  try {
    await eventually(() => assert.match(captured.output(), /standalone worker ready/));
    assert.equal(child.exitCode, null);
    assert.equal(/token|secret checkout/i.test(captured.output()), false);
    db = new YoinkDatabase(join(directory, "yoink.sqlite"));
    const store = new SqliteBackgroundWorkerStore(db, { principalMode: "all" });
    const status = await store.deploymentStatus(
      "standalone",
      workerConfig.deploymentFingerprint,
      Date.now()
    );
    assert.equal(status.state, "running");
    assert.equal(status.healthy, true);
    assert.equal(status.totalPrincipals, 2);
    assert.equal(status.coveredPrincipals, status.totalPrincipals);
    assert.equal(status.deploymentAttested, true);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_tasks WHERE state = 'succeeded'"
    )?.count, 0);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_task_events"
    )?.count, 0);
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_worker_heartbeats WHERE runtime_kind = 'local_in_process'"
    )?.count, 0);

    server = createYoinkServer({
      db,
      webRoot: join(process.cwd(), "apps", "web"),
      version: "external-worker-process-test",
      backgroundWorkerStatus: async () => ({
        ...await store.deploymentStatus(
          "standalone",
          workerConfig.deploymentFingerprint,
          Date.now()
        ),
        mode: "external"
      })
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const runningResponse = await fetch(`${baseUrl}/api/v1/health`);
    assert.equal(runningResponse.status, 200);
    const running = await runningResponse.json() as Record<string, unknown>;
    assert.equal(running.backgroundWorkerMode, "external");
    assert.equal(running.backgroundWorkerDeployment, "standalone");
    assert.equal(running.backgroundWorkerRuntime, "running");
    assert.equal(running.backgroundWorkerHealthy, true);
    assert.equal(running.backgroundWorkerDeploymentAttested, true);
    assert.equal("productionWorkerFleetReady" in running, false);

    child.kill("SIGTERM");
    const [exitCode] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
    assert.equal(exitCode, 0, captured.output());
    await eventually(async () => {
      const stoppedResponse = await fetch(`${baseUrl}/api/v1/health`);
      assert.equal(stoppedResponse.status, 503);
      const stopped = await stoppedResponse.json() as Record<string, unknown>;
      assert.equal(stopped.backgroundWorkerRuntime, "stopped");
      assert.equal(stopped.backgroundWorkerHealthy, false);
    });
    assert.equal(db.get<{ state: string }>(
      "SELECT state FROM background_worker_heartbeats WHERE worker_id = ?",
      workerId
    )?.state, "stopped");
  } finally {
    if (server) {
      server.close();
      if (server.listening) await once(server, "close");
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a mismatched standalone process remains online only as deployment-gated evidence", async () => {
  const directory = mkdtempSync(join(tmpdir(), "yoink-mismatched-worker-"));
  const expectedFingerprint = "a".repeat(64);
  const initialized = new YoinkDatabase(join(directory, "yoink.sqlite"));
  new SqliteBackgroundWorkerStore(initialized, { principalMode: "all" }).configureDeploymentExpectation(
    "external",
    expectedFingerprint,
    "intentionally-mismatched-version"
  );
  initialized.close();
  const child = spawn(process.execPath, ["--import", "tsx", "apps/worker/src/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      YOINK_DATA_DIR: directory,
      YOINK_WORKER_ID: "background_worker_mismatch_process",
      YOINK_WORKER_POLL_MS: "500"
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  const captured = capture(child);
  let db: YoinkDatabase | null = null;
  try {
    await eventually(() => assert.match(captured.output(), /online but deployment-gated/));
    db = new YoinkDatabase(join(directory, "yoink.sqlite"));
    await eventually(() => {
      assert.equal(db?.get<{ lastErrorCode: string }>(
        `SELECT last_error_code AS lastErrorCode FROM background_worker_heartbeats
         WHERE worker_id = 'background_worker_mismatch_process'`
      )?.lastErrorCode, "worker_deployment_mismatch");
    });
    assert.equal(db.get<{ count: number }>(
      "SELECT COUNT(*) AS count FROM background_tasks"
    )?.count, 0);
    const status = await new SqliteBackgroundWorkerStore(db, { principalMode: "all" }).deploymentStatus(
      "standalone",
      expectedFingerprint,
      Date.now()
    );
    assert.equal(status.healthy, false);
    assert.equal(status.deploymentAttested, false);
    assert.equal(status.lastErrorCode, "worker_deployment_mismatch");

    child.kill("SIGTERM");
    const [exitCode] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
    assert.equal(exitCode, 0, captured.output());
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
