import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { once } from "node:events";
import test from "node:test";
import { createYoinkServer } from "../apps/api/src/app.js";
import { YoinkDatabase } from "../packages/database/src/database.js";

test("the loopback API serves the control center and processes a dry-run signal", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({
    db,
    webRoot: join(process.cwd(), "apps", "web"),
    version: "0.1.0-test"
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const page = await fetch(`${baseUrl}/`);
    assert.equal(page.status, 200);
    const pageBody = await page.text();
    assert.match(pageBody, /My purchase assistant/);
    assert.match(pageBody, /Purchase plans/);
    assert.match(pageBody, /Products, price, and purchase preferences/);
    assert.match(pageBody, /Spending limits/);
    assert.match(pageBody, /Review before anything is enabled/);
    assert.match(pageBody, /Create purchase plan/);
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);

    const adminPage = await fetch(`${baseUrl}/admin`);
    assert.equal(adminPage.status, 200);
    const adminPageBody = await adminPage.text();
    assert.match(adminPageBody, /Admin control center/);
    assert.match(adminPageBody, /Target add-only qualification/);
    assert.match(adminPageBody, /Adapter repair queue/);
    assert.match(adminPageBody, /Catalog review queue/);
    assert.match(adminPageBody, /Merge, split, and compensation/);

    const health = await fetch(`${baseUrl}/api/v1/health`).then((response) => response.json()) as Record<string, unknown>;
    assert.deepEqual(health, {
      status: "ready",
      version: "0.1.0-test",
      database: "ready",
      storageEngine: "sqlite",
      portabilityArchiveFormat: "yoink-portability-ndjson-v1",
      productionPostgresReady: false,
      executionMode: "shadow",
      actionsPaused: true,
      chromeMutationEnabled: false,
      targetAddExecutionEnabled: false,
      walmartAddExecutionEnabled: false,
      amazonAddExecutionEnabled: false,
      bestBuyAddExecutionEnabled: false,
      observerRecipeWitnessRequired: false,
      observerRecipeWitnessState: "disabled",
      observerRecipeWitnessHealthy: false,
      observerRecipeDeliveryWitnessSatisfied: true
    });

    const listingResponse = await fetch(`${baseUrl}/api/v1/user/catalog/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        sourceConnectionId: "source_trackalacker_local",
        source: "trackalacker",
        sourceProductId: "api-product-1",
        sourceListingId: "api-listing-1",
        title: "Yoink API Test Product",
        retailerId: "target",
        retailerSku: "1011483414",
        canonicalUrl: "https://www.target.com/p/-/A-1011483414",
        listingStatus: "out_of_stock",
        executionSupported: true,
        msrpCents: 6999,
        currency: "USD"
      })
    });
    assert.equal(listingResponse.status, 202);
    const catalogProposal = (await listingResponse.json() as {
      proposal: { id: string; status: string };
      disposition: string;
    }).proposal;
    assert.equal(catalogProposal.status, "pending");
    assert.equal(db.get<{ count: number }>("SELECT COUNT(*) AS count FROM listings")?.count, 0);

    const decisionResponse = await fetch(`${baseUrl}/api/v1/admin/catalog/proposals/${encodeURIComponent(catalogProposal.id)}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        outcome: "approve",
        note: "Test fixture exact retailer SKU verified.",
        confirmation: "APPROVE_CATALOG_PROPOSAL"
      })
    });
    assert.equal(decisionResponse.status, 200);
    assert.equal((await decisionResponse.json() as { proposal: { status: string } }).proposal.status, "approved");

    const signalResponse = await fetch(`${baseUrl}/api/v1/signals`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        sourceConnectionId: "source_trackalacker_local",
        source: "trackalacker",
        externalEventId: "api-event-1",
        eventType: "restock",
        observedAt: new Date().toISOString(),
        test: true,
        identity: {
          sourceProductId: "api-product-1",
          sourceListingId: "api-listing-1",
          retailerId: "target",
          retailerSku: "1011483414",
          title: "Yoink API Test Product"
        },
        offer: { availability: "in_stock", unitPriceCents: 6999, currency: "USD" }
      })
    });
    assert.equal(signalResponse.status, 202);
    const signal = await signalResponse.json() as Record<string, unknown>;
    assert.equal(signal.decision, "test_signal");
    assert.equal(signal.actionJobId, "");

    const snapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      counts: Record<string, number>;
      capabilities: Record<string, unknown>;
    };
    assert.equal(snapshot.counts.listings, 1);
    assert.equal(snapshot.counts.catalogProposals, 1);
    assert.equal(snapshot.counts.pendingCatalogProposals, 0);
    assert.equal(snapshot.counts.signals, 1);
    assert.equal(snapshot.counts.actionJobs, 0);
    assert.equal(snapshot.counts.catalogIdentityOperations, 0);
    assert.equal(snapshot.counts.pendingCatalogIdentityOperations, 0);
    assert.equal(snapshot.capabilities.retailerMutation, false);
    assert.equal(snapshot.capabilities.communityReadOnlyEvidence, true);
    assert.equal(snapshot.capabilities.storageEngine, "sqlite");
    assert.equal(snapshot.capabilities.freshDatabaseRestoreParity, true);
    assert.equal(snapshot.capabilities.productionPostgresReady, false);
    assert.equal(snapshot.capabilities.reversibleCatalogIdentityGovernance, true);
    assert.equal(snapshot.capabilities.hostedGlobalCatalogAuthority, false);

    const libraryPage = await fetch(`${baseUrl}/api/v1/library?limit=1&offset=0&q=Yoink%20API`).then((response) => response.json()) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };
    assert.equal(libraryPage.total, 1);
    assert.equal(libraryPage.items.length, 1);
    const missionPage = await fetch(`${baseUrl}/api/v1/missions?limit=1&offset=0&q=Yoink%20API`).then((response) => response.json()) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };
    assert.equal(missionPage.total, 0);
    const purchaseIntentResponse = await fetch(`${baseUrl}/api/v1/user/purchase-intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        contractVersion: 1,
        listingId: String(libraryPage.items[0]?.listingId ?? ""),
        targetQuantity: 1,
        maxUnitPriceCents: 6999,
        maxAllInCents: 6999,
        actionCeiling: "notify",
        sellerPolicy: "first_party_only",
        fulfillment: "shipping",
        substitutionPolicy: "exact_only",
        cooldownSeconds: 900,
        confirmation: "CREATE_EXACT_PURCHASE_PLAN"
      })
    });
    assert.equal(purchaseIntentResponse.status, 201);
    const createdPurchaseIntent = await purchaseIntentResponse.json() as {
      created: boolean;
      purchaseIntent: {
        id: string;
        intentPolicy: {
          revision: number;
          actionCeiling: string;
          decisionMode: string;
          maxSignalAgeSeconds: number;
          maxAllInCents: number;
        };
        targets: Array<Record<string, unknown>>;
      };
    };
    assert.equal(createdPurchaseIntent.created, true);
    assert.equal(createdPurchaseIntent.purchaseIntent.intentPolicy.revision, 1);
    assert.equal(createdPurchaseIntent.purchaseIntent.intentPolicy.actionCeiling, "notify");
    assert.equal(createdPurchaseIntent.purchaseIntent.intentPolicy.decisionMode, "purchase_intent");
    assert.equal(createdPurchaseIntent.purchaseIntent.intentPolicy.maxSignalAgeSeconds, 120);
    assert.equal(createdPurchaseIntent.purchaseIntent.intentPolicy.maxAllInCents, 6999);
    const intentId = createdPurchaseIntent.purchaseIntent.id;
    const target = createdPurchaseIntent.purchaseIntent.targets[0];
    assert.ok(target);
    assert.equal(target.maxUnitPriceCents, 6999);
    assert.equal(target.sellerPolicy, "first_party_only");
    assert.equal(target.fulfillment, "shipping");
    const duplicateIntent = await fetch(`${baseUrl}/api/v1/user/purchase-intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        contractVersion: 1,
        listingId: String(libraryPage.items[0]?.listingId ?? ""),
        targetQuantity: 1,
        maxUnitPriceCents: 6999,
        maxAllInCents: 6999,
        actionCeiling: "notify",
        sellerPolicy: "first_party_only",
        fulfillment: "shipping",
        substitutionPolicy: "exact_only",
        cooldownSeconds: 900,
        confirmation: "CREATE_EXACT_PURCHASE_PLAN"
      })
    });
    assert.equal(duplicateIntent.status, 409);
    assert.equal((await duplicateIntent.json() as { error: string }).error, "purchase_intent_exists");
    const malformedContract = await fetch(`${baseUrl}/api/v1/user/purchase-intents`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        contractVersion: "1",
        listingId: String(libraryPage.items[0]?.listingId ?? ""),
        targetQuantity: "1",
        maxUnitPriceCents: "6999",
        maxAllInCents: "6999",
        actionCeiling: "notify",
        sellerPolicy: "first_party_only",
        fulfillment: "shipping",
        substitutionPolicy: "exact_only",
        cooldownSeconds: "0",
        confirmation: "CREATE_EXACT_PURCHASE_PLAN"
      })
    });
    assert.equal(malformedContract.status, 400);
    assert.equal((await malformedContract.json() as { error: string }).error, "purchase_intent_contract_unsupported");
    const updateIntent = await fetch(`${baseUrl}/api/v1/user/purchase-intents/${encodeURIComponent(intentId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        status: "active",
        targetQuantity: 2,
        targets: [{
          id: target.id,
          enabled: true,
          maxUnitPriceCents: 6999,
          sellerPolicy: "first_party_only",
          fulfillment: "shipping"
        }],
        policy: {
          expectedRevision: 1,
          maxAllInCents: 19_000,
          actionCeiling: "add_to_cart",
          decisionMode: "purchase_intent",
          maxSignalAgeSeconds: 120,
          substitutionPolicy: "exact_only",
          cooldownSeconds: 60,
          expiresAt: new Date(Date.now() + 86_400_000).toISOString()
        }
      })
    });
    assert.equal(updateIntent.status, 200);
    const updatedIntent = await updateIntent.json() as {
      purchaseIntent: { intentPolicy: { revision: number; maxAllInCents: number; decisionMode: string } };
    };
    assert.equal(updatedIntent.purchaseIntent.intentPolicy.revision, 2);
    assert.equal(updatedIntent.purchaseIntent.intentPolicy.maxAllInCents, 19_000);
    assert.equal(updatedIntent.purchaseIntent.intentPolicy.decisionMode, "purchase_intent");
    const staleUpdate = await fetch(`${baseUrl}/api/v1/user/purchase-intents/${encodeURIComponent(intentId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        status: "active",
        targetQuantity: 2,
        targets: [{
          id: target.id, enabled: true, maxUnitPriceCents: 6999,
          sellerPolicy: "first_party_only", fulfillment: "shipping"
        }],
        policy: { expectedRevision: 1, maxAllInCents: 15_000 }
      })
    });
    assert.equal(staleUpdate.status, 409);
    assert.equal((await staleUpdate.json() as { error: string }).error, "intent_revision_conflict");

    const spendResponse = await fetch(`${baseUrl}/api/v1/user/spend-policy`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        expectedRevision: 1,
        perOrderCapCents: 20_000,
        dailyCapCents: 30_000,
        monthlyCapCents: 100_000
      })
    });
    assert.equal(spendResponse.status, 200);
    assert.equal((await spendResponse.json() as { summary: { policy: { revision: number } } }).summary.policy.revision, 2);
    const spendLedger = await fetch(`${baseUrl}/api/v1/user/spend-ledger`).then((response) => response.json()) as {
      items: unknown[];
      summary: { activeReservedCents: number; spentTodayCents: number };
    };
    assert.deepEqual(spendLedger.items, []);
    assert.equal(spendLedger.summary.activeReservedCents, 0);
    assert.equal(spendLedger.summary.spentTodayCents, 0);

    const updatedMissionPage = await fetch(`${baseUrl}/api/v1/user/purchase-intents?limit=1&offset=0`).then((response) => response.json()) as {
      items: Array<Record<string, unknown>>;
      total: number;
    };
    assert.equal(updatedMissionPage.total, 1);
    assert.equal(updatedMissionPage.items[0]?.title, "Yoink API Test Product");
    assert.equal(updatedMissionPage.items[0]?.intentRevision, 2);
    const activity = await fetch(`${baseUrl}/api/v1/audit?limit=10&q=test_signal`).then((response) => response.json()) as {
      items: Array<Record<string, unknown>>;
      total: number;
      outbox: { pendingOutboxEvents: number };
    };
    assert.ok(activity.total >= 1);
    assert.ok(activity.items.length >= 1);
    assert.ok(activity.outbox.pendingOutboxEvents >= 1);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});

test("the loopback API rejects a foreign browser origin for mutations", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps", "web"), version: "test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/settings/actions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
      body: JSON.stringify({ paused: false })
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json() as { error: string }).error, "origin_rejected");
    const rejectedDelete = await fetch(`http://127.0.0.1:${address.port}/api/v1/community/contributions`, {
      method: "DELETE",
      headers: { Origin: "https://attacker.example" }
    });
    assert.equal(rejectedDelete.status, 403);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});

test("Chrome pairing uses a one-time code and authenticated heartbeat", async () => {
  const db = new YoinkDatabase();
  const server = createYoinkServer({ db, webRoot: join(process.cwd(), "apps", "web"), version: "test" });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const extensionOrigin = `chrome-extension://${"a".repeat(32)}`;
  try {
    const codeResponse = await fetch(`${baseUrl}/api/v1/devices/pairing-code`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: "{}"
    });
    assert.equal(codeResponse.status, 201);
    const code = (await codeResponse.json() as { pairing: { code: string } }).pairing.code;

    const foreignPair = await fetch(`${baseUrl}/api/v1/devices/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
      body: JSON.stringify({ pairingCode: code })
    });
    assert.equal(foreignPair.status, 403);

    const pairResponse = await fetch(`${baseUrl}/api/v1/devices/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify({
        pairingCode: code,
        name: "Desktop - Windows - Chrome",
        platform: "windows-chrome",
        extensionVersion: "0.11.0",
        capabilities: {
          readiness: true,
          jobReconciliation: true,
          communityReadOnlyEvidence: true,
          exactSelectedOfferEvidence: true,
          retailerMutation: false,
          targetAddOnly: true,
          targetAddAdapterVersion: "target-add-v1",
          walmartAddOnly: true,
          walmartAddAdapterVersion: "walmart-add-v3",
          amazonAddOnly: true,
          amazonAddAdapterVersion: "amazon-add-v5",
          bestBuyAddOnly: true,
          bestBuyAddAdapterVersion: "bestbuy-add-v3"
        }
      })
    });
    assert.equal(pairResponse.status, 201);
    const paired = (await pairResponse.json() as { device: { id: string; token: string } }).device;
    assert.ok(paired.id);
    assert.match(paired.token, /^[A-Za-z0-9_-]{40,100}$/);

    const reused = await fetch(`${baseUrl}/api/v1/devices/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin },
      body: JSON.stringify({ pairingCode: code })
    });
    assert.equal(reused.status, 400);

    const heartbeat = await fetch(`${baseUrl}/api/v1/devices/self/heartbeat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.token}`
      },
      body: JSON.stringify({
        platform: "windows-chrome",
        extensionVersion: "0.11.0",
        capabilities: {
          readiness: true,
          jobReconciliation: true,
          communityReadOnlyEvidence: true,
          exactSelectedOfferEvidence: true,
          retailerMutation: false,
          targetAddOnly: true,
          targetAddAdapterVersion: "target-add-v1",
          walmartAddOnly: true,
          walmartAddAdapterVersion: "walmart-add-v3",
          amazonAddOnly: true,
          amazonAddAdapterVersion: "amazon-add-v5",
          bestBuyAddOnly: true,
          bestBuyAddAdapterVersion: "bestbuy-add-v3"
        }
      })
    });
    assert.equal(heartbeat.status, 200);
    const heartbeatBody = await heartbeat.json() as { controlPlane: { retailerMutationEnabled: boolean } };
    assert.equal(heartbeatBody.controlPlane.retailerMutationEnabled, false);

    const nextJob = await fetch(`${baseUrl}/api/v1/devices/self/jobs/next`, {
      headers: { Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` }
    });
    assert.equal(nextJob.status, 200);
    assert.deepEqual(await nextJob.json(), { job: null, reason: "shadow_mode" });

    const shadowResponse = await fetch(`${baseUrl}/api/v1/devices/self/shadow-observations/target`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.token}`
      },
      body: JSON.stringify({
        adapterVersion: "target-observer-v1",
        contractVersion: 1,
        observedAt: new Date().toISOString(),
        pageKind: "product",
        retailerId: "target",
        retailerSku: "1011483414",
        availability: "in_stock",
        unitPriceCents: 5999,
        currency: "USD",
        sellerName: "Target",
        sellerType: "first_party",
        fulfillment: "shipping",
        addControlActionable: true,
        securityChallenge: false,
        interactiveBlock: "",
        selectedOffer: {
          schemaVersion: 1,
          selectionState: "exact",
          childOfferKey: "1011483414",
          attributes: {}
        },
        cookie: "DO_NOT_STORE"
      })
    });
    assert.equal(shadowResponse.status, 201);
    const shadow = (await shadowResponse.json() as { observation: Record<string, unknown> }).observation;
    assert.equal(shadow.observationState, "actionable_candidate");
    assert.equal(shadow.canonicalUrl, "https://www.target.com/p/-/A-1011483414");
    assert.equal("cookie" in shadow, false);

    const consentResponse = await fetch(`${baseUrl}/api/v1/community/consents/target`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        enabled: true,
        locationScope: "country:US",
        privacyVersion: "community-readonly-v1",
        confirmation: "SHARE_READ_ONLY_STOCK_EVIDENCE"
      })
    });
    assert.equal(consentResponse.status, 200);
    const nonceResponse = await fetch(`${baseUrl}/api/v1/devices/self/community/nonces/target`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` },
      body: "{}"
    });
    assert.equal(nonceResponse.status, 201);
    const nonce = (await nonceResponse.json() as { nonce: string }).nonce;
    const contributionResponse = await fetch(`${baseUrl}/api/v1/devices/self/community/contributions/target`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` },
      body: JSON.stringify({
        contractVersion: 1,
        nonce,
        shadowObservationId: shadow.id,
        rawDom: "DO_NOT_STORE"
      })
    });
    assert.equal(contributionResponse.status, 201);
    const contribution = await contributionResponse.json() as {
      receipt: { disposition: string };
      assertion: Record<string, unknown>;
    };
    assert.equal(contribution.receipt.disposition, "accepted");
    assert.equal(contribution.assertion.retailerSku, "1011483414");
    const replay = await fetch(`${baseUrl}/api/v1/devices/self/community/contributions/target`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` },
      body: JSON.stringify({ contractVersion: 1, nonce, shadowObservationId: shadow.id })
    });
    assert.equal(replay.status, 400);

    const rehearsalResponse = await fetch(`${baseUrl}/api/v1/devices/self/qualification-trials/target-add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.token}`
      },
      body: JSON.stringify({
        adapterVersion: "target-add-v1",
        observerVersion: "target-observer-v1",
        contractVersion: 1,
        shadowObservationId: shadow.id,
        observedAt: new Date().toISOString(),
        outcome: "passed",
        reasonCode: "verified",
        cookie: "DO_NOT_STORE"
      })
    });
    assert.equal(rehearsalResponse.status, 201);
    const rehearsal = (await rehearsalResponse.json() as { trial: Record<string, unknown> }).trial;
    assert.equal(rehearsal.outcome, "passed");
    assert.equal("cookie" in rehearsal, false);

    const snapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      devices: Array<Record<string, unknown>>;
      counts: Record<string, number>;
      shadowObservations: Array<Record<string, unknown>>;
      community: {
        advisoryOnly: boolean;
        assertions: Array<Record<string, unknown>>;
        aggregates: Array<Record<string, unknown>>;
      };
      targetQualification: {
        liveEvidenceReady: boolean;
        rehearsalReady: boolean;
        qualificationEvidenceReady: boolean;
        addToCartQualified: boolean;
        mutationAuthorized: boolean;
        distinctSkuCount: number;
        qualificationEvidenceHash: string;
        checks: Array<{ id: string; met: boolean }>;
      };
    };
    assert.equal(snapshot.counts.devices, 1);
    assert.equal(snapshot.counts.onlineDevices, 1);
    assert.equal(snapshot.counts.shadowObservations, 1);
    assert.equal(snapshot.counts.communityAssertions, 1);
    assert.equal(snapshot.community.advisoryOnly, true);
    assert.equal(snapshot.community.assertions.length, 1);
    assert.equal(snapshot.community.aggregates[0]?.publicationState, "insufficient_quorum");
    assert.equal(snapshot.shadowObservations[0]?.retailerSku, "1011483414");
    assert.equal(snapshot.targetQualification.liveEvidenceReady, false);
    assert.equal(snapshot.targetQualification.rehearsalReady, true);
    assert.equal(snapshot.targetQualification.qualificationEvidenceReady, false);
    assert.equal(snapshot.targetQualification.addToCartQualified, false);
    assert.equal(snapshot.targetQualification.mutationAuthorized, false);
    assert.equal(snapshot.targetQualification.distinctSkuCount, 1);
    assert.equal(snapshot.targetQualification.checks.find((check) => check.id === "first_party_actionable")?.met, true);
    assert.equal(JSON.stringify(snapshot).includes(paired.token), false);
    assert.equal(JSON.stringify(snapshot).includes("DO_NOT_STORE"), false);
    assert.equal(JSON.stringify(db.all("SELECT * FROM community_inventory_assertions")).includes("DO_NOT_STORE"), false);
    assert.equal(JSON.stringify(db.all("SELECT * FROM retailer_shadow_observations")).includes("DO_NOT_STORE"), false);

    const secondShadowResponse = await fetch(`${baseUrl}/api/v1/devices/self/shadow-observations/target`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.token}`
      },
      body: JSON.stringify({
        adapterVersion: "target-observer-v1",
        contractVersion: 1,
        observedAt: new Date().toISOString(),
        pageKind: "product",
        retailerId: "target",
        retailerSku: "202258620",
        availability: "in_stock",
        unitPriceCents: 4499,
        currency: "USD",
        sellerName: "Target",
        sellerType: "first_party",
        fulfillment: "shipping",
        addControlActionable: true,
        securityChallenge: false,
        interactiveBlock: ""
      })
    });
    assert.equal(secondShadowResponse.status, 201);
    const readySnapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      targetQualification: {
        qualificationEvidenceReady: boolean;
        qualificationEvidenceHash: string;
      };
    };
    assert.equal(readySnapshot.targetQualification.qualificationEvidenceReady, true);
    const activation = await fetch(`${baseUrl}/api/v1/qualifications/target-add/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        adapterVersion: "target-add-v1",
        evidenceHash: readySnapshot.targetQualification.qualificationEvidenceHash,
        confirmation: "ENABLE_TARGET_ADD_V1"
      })
    });
    assert.equal(activation.status, 200);
    const activationBody = await activation.json() as { readiness: { mutationAuthorized: boolean; addToCartQualified: boolean } };
    assert.equal(activationBody.readiness.addToCartQualified, true);
    assert.equal(activationBody.readiness.mutationAuthorized, true);
    const liveHealth = await fetch(`${baseUrl}/api/v1/health`).then((response) => response.json()) as Record<string, unknown>;
    assert.equal(liveHealth.executionMode, "live");
    assert.equal(liveHealth.actionsPaused, false);
    assert.equal(liveHealth.chromeMutationEnabled, true);

    const pause = await fetch(`${baseUrl}/api/v1/settings/actions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ paused: true })
    });
    assert.equal(pause.status, 200);
    const resume = await fetch(`${baseUrl}/api/v1/settings/actions`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({ paused: false })
    });
    assert.equal(resume.status, 200);

    const walmartShadowIds: string[] = [];
    for (const [retailerSku, unitPriceCents] of [["17354421975", 4499], ["98765432101", 3999]] as const) {
      const response = await fetch(`${baseUrl}/api/v1/devices/self/shadow-observations/walmart`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: extensionOrigin,
          Authorization: `Bearer ${paired.token}`
        },
        body: JSON.stringify({
          adapterVersion: "walmart-observer-v4",
          contractVersion: 1,
          observedAt: new Date().toISOString(),
          pageKind: "product",
          retailerId: "walmart",
          retailerSku,
          availability: "in_stock",
          unitPriceCents,
          currency: "USD",
          sellerName: "Walmart",
          sellerType: "first_party",
          fulfillment: "shipping",
          addControlActionable: true,
          securityChallenge: false,
          interactiveBlock: ""
        })
      });
      assert.equal(response.status, 201);
      walmartShadowIds.push(String((await response.json() as { observation: { id: string } }).observation.id));
    }
    const walmartRehearsal = await fetch(`${baseUrl}/api/v1/devices/self/qualification-trials/walmart-add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.token}`
      },
      body: JSON.stringify({
        adapterVersion: "walmart-add-v3",
        observerVersion: "walmart-observer-v4",
        contractVersion: 1,
        shadowObservationId: walmartShadowIds[0],
        observedAt: new Date().toISOString(),
        outcome: "passed",
        reasonCode: "verified"
      })
    });
    assert.equal(walmartRehearsal.status, 201);
    const walmartReadySnapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      walmartQualification: { qualificationEvidenceReady: boolean; qualificationEvidenceHash: string };
    };
    assert.equal(walmartReadySnapshot.walmartQualification.qualificationEvidenceReady, true);
    const walmartActivation = await fetch(`${baseUrl}/api/v1/qualifications/walmart-add/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        adapterVersion: "walmart-add-v3",
        evidenceHash: walmartReadySnapshot.walmartQualification.qualificationEvidenceHash,
        confirmation: "ENABLE_WALMART_ADD_V3"
      })
    });
    assert.equal(walmartActivation.status, 200);
    const walmartActivationBody = await walmartActivation.json() as {
      readiness: { addToCartQualified: boolean; mutationAuthorized: boolean };
    };
    assert.equal(walmartActivationBody.readiness.addToCartQualified, true);
    assert.equal(walmartActivationBody.readiness.mutationAuthorized, true);
    const dualLaneHealth = await fetch(`${baseUrl}/api/v1/health`).then((response) => response.json()) as Record<string, unknown>;
    assert.equal(dualLaneHealth.targetAddExecutionEnabled, true);
    assert.equal(dualLaneHealth.walmartAddExecutionEnabled, true);

    const amazonShadowIds: string[] = [];
    for (const [retailerSku, unitPriceCents] of [["B0GYTRYV7P", 2186], ["B0AMZN0001", 3199]] as const) {
      const response = await fetch(`${baseUrl}/api/v1/devices/self/shadow-observations/amazon`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: extensionOrigin,
          Authorization: `Bearer ${paired.token}`
        },
        body: JSON.stringify({
          adapterVersion: "amazon-observer-v6",
          contractVersion: 1,
          observedAt: new Date().toISOString(),
          pageKind: "product",
          retailerId: "amazon",
          retailerSku,
          availability: "in_stock",
          unitPriceCents,
          currency: "USD",
          sellerName: "Amazon.com",
          sellerType: "first_party",
          fulfillment: "shipping",
          addControlActionable: true,
          securityChallenge: false,
          interactiveBlock: "",
          purchaseRouteKind: "amazon_buy_now",
          purchaseRouteReady: true,
          routeReasonCode: "offer_route_verified"
        })
      });
      assert.equal(response.status, 201);
      amazonShadowIds.push(String((await response.json() as { observation: { id: string } }).observation.id));
    }
    const amazonRehearsal = await fetch(`${baseUrl}/api/v1/devices/self/qualification-trials/amazon-add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.token}`
      },
      body: JSON.stringify({
        adapterVersion: "amazon-add-v5",
        observerVersion: "amazon-observer-v6",
        contractVersion: 1,
        shadowObservationId: amazonShadowIds[0],
        observedAt: new Date().toISOString(),
        outcome: "passed",
        reasonCode: "verified"
      })
    });
    assert.equal(amazonRehearsal.status, 201);
    const amazonReadySnapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      amazonQualification: { qualificationEvidenceReady: boolean; qualificationEvidenceHash: string };
    };
    assert.equal(amazonReadySnapshot.amazonQualification.qualificationEvidenceReady, true);
    const amazonActivation = await fetch(`${baseUrl}/api/v1/qualifications/amazon-add/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        adapterVersion: "amazon-add-v5",
        evidenceHash: amazonReadySnapshot.amazonQualification.qualificationEvidenceHash,
        confirmation: "ENABLE_AMAZON_ADD_V5"
      })
    });
    assert.equal(amazonActivation.status, 200);
    const amazonActivationBody = await amazonActivation.json() as {
      readiness: { addToCartQualified: boolean; mutationAuthorized: boolean };
    };
    assert.equal(amazonActivationBody.readiness.addToCartQualified, true);
    assert.equal(amazonActivationBody.readiness.mutationAuthorized, true);
    const tripleLaneHealth = await fetch(`${baseUrl}/api/v1/health`).then((response) => response.json()) as Record<string, unknown>;
    assert.equal(tripleLaneHealth.amazonAddExecutionEnabled, true);

    const bestBuyShadowIds: string[] = [];
    for (const [retailerSku, unitPriceCents] of [["6588149", 699], ["6550001", 1299]] as const) {
      const response = await fetch(`${baseUrl}/api/v1/devices/self/shadow-observations/bestbuy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: extensionOrigin,
          Authorization: `Bearer ${paired.token}`
        },
        body: JSON.stringify({
          adapterVersion: "bestbuy-observer-v5",
          contractVersion: 1,
          observedAt: new Date().toISOString(),
          pageKind: "product",
          retailerId: "bestbuy",
          retailerSku,
          availability: "in_stock",
          unitPriceCents,
          currency: "USD",
          sellerName: "Best Buy",
          sellerType: "first_party",
          fulfillment: "shipping",
          addControlActionable: true,
          securityChallenge: false,
          interactiveBlock: ""
        })
      });
      assert.equal(response.status, 201);
      bestBuyShadowIds.push(String((await response.json() as { observation: { id: string } }).observation.id));
    }
    const bestBuyRehearsal = await fetch(`${baseUrl}/api/v1/devices/self/qualification-trials/bestbuy-add`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.token}`
      },
      body: JSON.stringify({
        adapterVersion: "bestbuy-add-v3",
        observerVersion: "bestbuy-observer-v5",
        contractVersion: 1,
        shadowObservationId: bestBuyShadowIds[0],
        observedAt: new Date().toISOString(),
        outcome: "passed",
        reasonCode: "verified"
      })
    });
    assert.equal(bestBuyRehearsal.status, 201);
    const bestBuyReadySnapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      bestBuyQualification: { qualificationEvidenceReady: boolean; qualificationEvidenceHash: string };
    };
    assert.equal(bestBuyReadySnapshot.bestBuyQualification.qualificationEvidenceReady, true);
    const bestBuyActivation = await fetch(`${baseUrl}/api/v1/qualifications/bestbuy-add/activate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: JSON.stringify({
        adapterVersion: "bestbuy-add-v3",
        evidenceHash: bestBuyReadySnapshot.bestBuyQualification.qualificationEvidenceHash,
        confirmation: "ENABLE_BESTBUY_ADD_V3"
      })
    });
    assert.equal(bestBuyActivation.status, 200);
    const bestBuyActivationBody = await bestBuyActivation.json() as {
      readiness: { addToCartQualified: boolean; mutationAuthorized: boolean };
    };
    assert.equal(bestBuyActivationBody.readiness.addToCartQualified, true);
    assert.equal(bestBuyActivationBody.readiness.mutationAuthorized, true);
    const fourLaneHealth = await fetch(`${baseUrl}/api/v1/health`).then((response) => response.json()) as Record<string, unknown>;
    assert.equal(fourLaneHealth.bestBuyAddExecutionEnabled, true);

    const disneyObservation = await fetch(`${baseUrl}/api/v1/devices/self/shadow-observations/disney`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: extensionOrigin,
        Authorization: `Bearer ${paired.token}`
      },
      body: JSON.stringify({
        adapterVersion: "disney-observer-v1",
        contractVersion: 1,
        observedAt: new Date().toISOString(),
        pageKind: "product",
        retailerId: "disney",
        retailerSku: "409914998395",
        canonicalUrl: "https://www.disneystore.com/dumbo-jeweled-figurine-409914998395.html?CMP=DO_NOT_STORE",
        availability: "in_stock",
        unitPriceCents: 12900,
        currency: "USD",
        sellerName: "Disney Store",
        sellerType: "first_party",
        fulfillment: "shipping",
        addControlActionable: true,
        securityChallenge: false,
        interactiveBlock: "",
        purchaseRouteKind: "none",
        purchaseRouteReady: false,
        routeReasonCode: "not_applicable"
      })
    });
    assert.equal(disneyObservation.status, 201);
    const disneyStored = (await disneyObservation.json() as { observation: Record<string, unknown> }).observation;
    assert.equal(disneyStored.canonicalUrl, "https://www.disneystore.com/dumbo-jeweled-figurine-409914998395.html");
    assert.equal(db.get<{ execution_supported: number }>(
      "SELECT execution_supported FROM retailers WHERE id = 'disney'"
    )?.execution_supported, 0);
    const expandedSnapshot = await fetch(`${baseUrl}/api/v1/snapshot`).then((response) => response.json()) as {
      retailerEvidence: Array<{ retailerId: string; mode: string; observationCount: number }>;
    };
    assert.equal(expandedSnapshot.retailerEvidence.find((item) => item.retailerId === "disney")?.mode, "read_only");
    assert.equal(expandedSnapshot.retailerEvidence.find((item) => item.retailerId === "disney")?.observationCount, 1);

    const revoke = await fetch(`${baseUrl}/api/v1/devices/${paired.id}/revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: baseUrl },
      body: "{}"
    });
    assert.equal(revoke.status, 200);
    const rejectedHeartbeat = await fetch(`${baseUrl}/api/v1/devices/self/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` },
      body: "{}"
    });
    assert.equal(rejectedHeartbeat.status, 401);
    const rejectedShadow = await fetch(`${baseUrl}/api/v1/devices/self/shadow-observations/target`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: extensionOrigin, Authorization: `Bearer ${paired.token}` },
      body: "{}"
    });
    assert.equal(rejectedShadow.status, 401);
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
