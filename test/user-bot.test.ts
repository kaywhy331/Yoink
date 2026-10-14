import assert from "node:assert/strict";
import test from "node:test";
import { YoinkDatabase } from "../packages/database/src/database.js";
import { UserActionConnectorRepository } from "../packages/database/src/user-action-connector-repository.js";
import { runWithRequestScope } from "../packages/database/src/request-scope.js";
import { UserBotConnections, UserBotTransport } from "../packages/engine/src/user-bot-connections.js";
import { UserActionConnectorDispatchService } from "../packages/engine/src/user-action-connector-dispatch.js";
import { UserBotDispatchRuntime } from "../packages/engine/src/user-bot-dispatch-runtime.js";
import { loadUserActionWebhookRegistry } from "../packages/engine/src/user-action-webhook.js";
import { readDiscordNotification } from "../packages/sources/src/discord-notification.js";
import { userBotMessage } from "../packages/engine/src/user-bot-message.js";
const NOW = Date.parse("2026-10-14T16:00:00Z");
const TOKEN = `123456789:${"a".repeat(35)}`;
const WEBHOOK = `https://discord.com/api/webhooks/123456789012345678/${"b".repeat(60)}`;
const empty = loadUserActionWebhookRegistry({});
const fallback = { async deliver() { throw new Error("Unexpected fallback"); } };

test("Discord setup is opted in, verified, encrypted, scoped, and removable", async () => {
  const db = new YoinkDatabase();
  try {
    let calls = 0;
    const service = new UserBotConnections(db, Buffer.alloc(32, 1), async () => { calls++; return Response.json({id:"1",channel_id:"2",type:1}); });
    await assert.rejects(service.connectDiscord({webhookUrl:WEBHOOK}), /Choose to receive/);
    await assert.rejects(service.connectDiscord({webhookUrl:"https://localhost/private",optedIn:true}), /private Discord channel/);
    assert.equal(calls,0);
    const connector = await service.connectDiscord({webhookUrl:WEBHOOK,optedIn:true},NOW);
    const repo = new UserActionConnectorRepository(db);
    assert.equal(repo.list()[0]?.runtimeBound,true);
    assert.deepEqual(connector.events,["carted","needs_you","test"]);
    const stored = JSON.stringify(db.all("SELECT * FROM user_bot_credentials"));
    assert.ok(!stored.includes(WEBHOOK));
    assert.ok(!JSON.stringify(repo.list()).includes(WEBHOOK));
    assert.equal(runWithRequestScope({tenantId:"another_tenant",userId:"another_user",actorKind:"user",actorId:"another_user"},()=>service.credential(connector.endpointReference)),null);
    assert.ok(service.credential(connector.endpointReference));
    repo.remove(connector.id,NOW+1);
    assert.equal(service.credential(connector.endpointReference),null);
  } finally {db.close();}
});

test("Telegram pairing binds only the private chat that used its one-use Start link", async () => {
  const db = new YoinkDatabase();
  try {
    let updates: unknown[] = [];
    const service = new UserBotConnections(db,Buffer.alloc(32,2),async(url)=>{
      const path=String(url);
      return Response.json({ok:true,result:path.endsWith("getMe")?{is_bot:true,username:"YoinkFixtureBot"}:path.endsWith("getWebhookInfo")?{url:""}:updates});
    });
    const pairing=await service.beginTelegram({token:TOKEN,optedIn:true},NOW);
    const code=new URL(pairing.url).searchParams.get("start");
    updates=[{message:{text:`/start ${code}`,chat:{type:"group",id:-10},from:{id:42}}}];
    assert.deepEqual(await service.finishTelegram(pairing.id,NOW+1),{pending:true});
    updates=[{message:{text:`/start ${code}`,chat:{type:"private",id:42},from:{id:42,is_bot:false}}}];
    const connected=await service.finishTelegram(pairing.id,NOW+2);
    assert.equal(connected.pending,false);
    assert.equal(new UserActionConnectorRepository(db).list()[0]?.kind,"telegram");
    await assert.rejects(service.finishTelegram(pairing.id,NOW+3),/expired/);
    assert.ok(!JSON.stringify(db.all("SELECT * FROM user_bot_credentials")).includes(TOKEN));
  } finally {db.close();}
});

test("YoinkBot sends useful Discord content, keeps its receipt, and cannot re-enter stock intake",async()=>{
 const db=new YoinkDatabase();
 try {
  const connections=new UserBotConnections(db,Buffer.alloc(32,3),async()=>Response.json({id:"1",channel_id:"2",type:1}));
  const connector=await connections.connectDiscord({webhookUrl:WEBHOOK,optedIn:true},NOW);
  const repo=new UserActionConnectorRepository(db);repo.queueTest(connector.id,NOW);
  let sent:any;
  const transport=new UserBotTransport(connections,fallback,async(url,init)=>{
   assert.equal(String(url),`${WEBHOOK}?wait=true`);sent=JSON.parse(String(init?.body));return Response.json({id:"receipt_1"});
  });
  const dispatch=new UserActionConnectorDispatchService(db,empty,transport);
  assert.equal((await dispatch.execute(NOW+1)).userConnectorDeliveriesSucceeded,1);
  assert.equal(repo.listDeliveries()[0]?.providerMessageId,"receipt_1");
  assert.match(sent.content,/stay logged in to the same store account/i);
  assert.deepEqual(sent.allowed_mentions,{parse:[]});
  const alert=userBotMessage({eventType:"carted",title:"Pokemon cards",retailerId:"amazon",quantity:1,unitPriceCents:5999});
  assert.match(alert.text,/59\.99/);assert.match(alert.text,/amazon.com\/gp\/cart/);
  const read=readDiscordNotification({app:"browser",title:"YoinkBot (#checkout-alerts, Personal Alerts)",body:alert.text});
  assert.equal(read.skip,true);assert.equal(read.relevant,false);
 } finally {db.close();}
});

test("stale success alerts expire and a disabled destination never leases",()=>{
 const db=new YoinkDatabase();
 try {
  const repo=new UserActionConnectorRepository(db,{fixture:"a".repeat(64)});
  const connector=repo.save({contractVersion:1,kind:"webhook",name:"Fixture",endpointReference:"fixture",events:["test"]},"",NOW);
  const queued=repo.queueTest(connector.id,NOW);
  db.run("UPDATE user_action_connector_deliveries SET event_type='carted',expires_at=? WHERE id=?",new Date(NOW+60_000).toISOString(),queued.id);
  assert.equal(repo.leaseNext(NOW+60_001),null);assert.equal(repo.listDeliveries()[0]?.lastErrorCode,"notification_expired");
  repo.queueTest(connector.id,NOW+70_000);
  repo.save({...connector,contractVersion:1,enabled:false},connector.id,NOW+70_001);
  assert.equal(repo.leaseNext(NOW+70_002),null);
  assert.equal(repo.listDeliveries()[0]?.state,"cancelled");
  repo.save({...connector,contractVersion:1,enabled:true},connector.id,NOW+70_003);
  assert.equal(repo.leaseNext(NOW+70_004),null);
 }finally{db.close();}
});

test("a slow destination does not delay the other destination",async()=>{
 const db=new YoinkDatabase();let release!:()=>void;
 try{
  const registry=loadUserActionWebhookRegistry({YOINK_USER_ACTION_CONNECTORS_JSON:JSON.stringify([
   {reference:"slow",kind:"webhook",endpoint:"https://example.test/slow"},{reference:"fast",kind:"webhook",endpoint:"https://example.test/fast"}])});
  const repo=new UserActionConnectorRepository(db,registry.bindings);
  for(const name of ["slow","fast"]){const c=repo.save({contractVersion:1,kind:"webhook",name,endpointReference:name,events:["test"]},"",NOW);repo.queueTest(c.id,NOW);}
  const held=new Promise<void>(resolve=>{release=resolve;});const seen:string[]=[];
  const dispatch=new UserActionConnectorDispatchService(db,registry,{async deliver(req){seen.push(req.endpointReference);if(req.endpointReference==="slow")await held;return{delivered:true,retryable:false,reasonCode:"ok",httpStatus:200};}});
  const running=dispatch.execute(NOW+1);await new Promise(resolve=>setImmediate(resolve));
  assert.ok(seen.includes("fast"));assert.ok(seen.includes("slow"));release();await running;
  assert.equal(repo.listDeliveries().filter(d=>d.state==="delivered").length,2);
 }finally{release?.();db.close();}
});

test("urgent runtime wakes independently of the maintenance schedule",async()=>{
 const db=new YoinkDatabase();let count=0;
 const repo=new UserActionConnectorRepository(db,{fixture:"a".repeat(64)});
 const c=repo.save({contractVersion:1,kind:"webhook",name:"Fixture",endpointReference:"fixture",events:["test"]});repo.queueTest(c.id);
 const runtime=new UserBotDispatchRuntime(db,{async execute(){count++;return{};}});
 try{runtime.start();await new Promise(resolve=>setImmediate(resolve));assert.ok(count>0);const first=count;runtime.wake();await new Promise(resolve=>setImmediate(resolve));assert.ok(count>first);}
 finally{await runtime.stop();db.close();}
});

test("Telegram delivery includes the cart button, receipt, and provider retry delay", async () => {
  const db = new YoinkDatabase();
  try {
    let code = "";
    const connections = new UserBotConnections(db, Buffer.alloc(32, 4), async (url) => Response.json({ok: true,
      result: String(url).endsWith("getMe") ? {is_bot: true, username: "YoinkFixtureBot"}
        : String(url).endsWith("getWebhookInfo") ? {url: ""}
          : [{message: {text: `/start ${code}`, chat: {type: "private", id: 42}, from: {id: 42}}}]}));
    const pairing = await connections.beginTelegram({token: TOKEN, optedIn: true}, NOW);
    code = new URL(pairing.url).searchParams.get("start")!;
    const connected = await connections.finishTelegram(pairing.id, NOW + 1);
    assert.ok(!connected.pending);
    const request = {deliveryId: "fixture", connectorKind: "telegram" as const,
      endpointReference: connected.connector.endpointReference,
      payload: {eventType: "carted", retailerId: "amazon", title: "Your product", quantity: 1}};
    let status = 200;
    const transport = new UserBotTransport(connections, fallback, async (url, init) => {
      assert.equal(String(url), `https://api.telegram.org/bot${TOKEN}/sendMessage`);
      const body = JSON.parse(String(init?.body));
      assert.equal(body.chat_id, "42");
      assert.equal(body.disable_notification, false);
      assert.match(body.text, /stay logged in to the same store account/);
      assert.match(body.reply_markup.inline_keyboard[0][0].url, /^https:\/\/www.amazon.com\/gp\/cart/);
      return Response.json(status === 200 ? {ok: true, result: {message_id: 123}}
        : {ok: false, parameters: {retry_after: 7}}, {status});
    });
    assert.equal((await transport.deliver(request)).providerMessageId, "123");
    status = 429;
    const limited = await transport.deliver(request);
    assert.equal(limited.retryable, true);
    assert.equal(limited.retryAfterMs, 7000);
    status = 403;
    assert.equal((await transport.deliver(request)).reasonCode, "bot_blocked_or_removed");
    assert.equal((await transport.deliver(request)).retryable, false);
    const repo = new UserActionConnectorRepository(db);
    const queued = repo.queueTest(connected.connector.id, NOW + 2);
    const lease = repo.leaseNext(NOW + 3)!;
    repo.fail(lease.id, lease.capabilityToken, "limited", true, NOW + 4, 7000);
    assert.equal(repo.leaseNext(NOW + 7003), null);
    const retried = repo.leaseNext(NOW + 7004)!;
    const dead = repo.fail(retried.id, retried.capabilityToken, "blocked", false, NOW + 7005);
    assert.equal(repo.retry(queued.id, dead.updatedAt, dead.attemptCount, NOW + 7006).state, "pending");
  } finally { db.close(); }
});

test("a newly arriving alert starts while an earlier destination is still waiting", async () => {
  const db = new YoinkDatabase();
  let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  const registry = loadUserActionWebhookRegistry({YOINK_USER_ACTION_CONNECTORS_JSON: JSON.stringify([
    {reference: "slow", kind: "webhook", endpoint: "https://example.test/slow"},
    {reference: "fast", kind: "webhook", endpoint: "https://example.test/fast"}])});
  const repo = new UserActionConnectorRepository(db, registry.bindings);
  const slow = repo.save({contractVersion: 1, kind: "webhook", name: "Slow", endpointReference: "slow", events: ["test"]});
  const fast = repo.save({contractVersion: 1, kind: "webhook", name: "Fast", endpointReference: "fast", events: ["test"]});
  repo.queueTest(slow.id);
  const seen: string[] = [];
  const dispatcher = new UserActionConnectorDispatchService(db, registry, {async deliver(request) {
    seen.push(request.endpointReference);
    if (request.endpointReference === "slow") await held;
    return {delivered: true, retryable: false, reasonCode: "ok", httpStatus: 200};
  }});
  const runtime = new UserBotDispatchRuntime(db, dispatcher);
  try {
    runtime.start(); await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(seen, ["slow"]);
    repo.queueTest(fast.id); runtime.wake();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(seen, ["slow", "fast"]);
    assert.equal(repo.listDeliveries().find(item => item.connectorId === fast.id)?.state, "delivered");
  } finally { release(); await runtime.stop(); db.close(); }
});
