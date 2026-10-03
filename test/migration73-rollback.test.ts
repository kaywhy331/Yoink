import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";
import {YoinkDatabase} from "../packages/database/src/database.js";

// Uses only a synthetic schema72 DB created by the installed Windows v1.30 runtime.
// No live user database or credentials are copied into this fixture.
test("migrations73 and74 preserve schema72 data and the verified cold backup restores byte-for-byte",()=>{
 const fixtures="data/review-fixtures/migration73";mkdirSync(fixtures,{recursive:true});
 const root=mkdtempSync(join(fixtures,"run-"));
 const base=join(fixtures,"synthetic-before73.sqlite");const work=join(root,"migrated.sqlite");
 const backup=join(root,"cold-backup72.sqlite");const restored=join(root,"restored72.sqlite");
 const hash=(p:string)=>createHash("sha256").update(readFileSync(p)).digest("hex");
 const snapshot=(p:string)=>{
  const db=new DatabaseSync(p,{readOnly:true});try{
   const names=(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('schema_migrations','single_cart_attempts','amazon_approved_test') ORDER BY name").all() as Array<{name:string}>).map(r=>r.name);
   return Object.fromEntries(names.map(name=>[name,db.prepare(`SELECT * FROM "${name}"`).all().map(row=>{
    // Existing startup seeding refreshes this metadata timestamp on every open.
    // Preserve and compare every other field, including all user-owned rows.
    if(name==="retailers")delete row.updated_at;
    return JSON.stringify(row);
   }).sort()]));
  }finally{db.close();}
 };
 copyFileSync(base,backup);copyFileSync(base,work);const before=snapshot(base);assert.equal(hash(base),hash(backup));
 const upgraded=new YoinkDatabase(work);
 try{
  assert.equal(upgraded.get<{v:number}>("SELECT MAX(version) AS v FROM schema_migrations")?.v,74);
  assert.equal(upgraded.get<{actions_paused:number}>("SELECT actions_paused FROM app_settings")?.actions_paused,1);
  assert.equal(upgraded.get<{n:number}>("SELECT COUNT(*) AS n FROM single_cart_attempts")?.n,0);
  assert.equal(upgraded.get<{n:number}>("SELECT COUNT(*) AS n FROM amazon_approved_test")?.n,0);
  assert.equal(upgraded.get<{n:number}>("SELECT COUNT(*) AS n FROM action_jobs")?.n,0);
  assert.equal(upgraded.connection.prepare("PRAGMA integrity_check").get()?.integrity_check,"ok");
  assert.equal(upgraded.connection.prepare("PRAGMA foreign_key_check").all().length,0);
 }finally{upgraded.close();}
 assert.deepEqual(snapshot(work),before,"migration changes no existing settings, plans, evidence, source state or other rows");
 const automatic=readdirSync(root).filter(n=>n.startsWith("migrated.sqlite.before-v74.")&&n.endsWith(".sqlite"));
 assert.equal(automatic.length,1,"normal startup makes its own pre-migration backup");
 const automaticDb=new DatabaseSync(join(root,automatic[0]!),{readOnly:true});
 try{assert.equal(automaticDb.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v,72);}finally{automaticDb.close();}
 copyFileSync(backup,restored);assert.equal(hash(restored),hash(base));assert.deepEqual(snapshot(restored),before);
 const rollback=new DatabaseSync(restored,{readOnly:true});try{
  assert.equal(rollback.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v,72);
  assert.equal(rollback.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='single_cart_attempts'").get()?.n,0);
  assert.equal(rollback.prepare("PRAGMA integrity_check").get()?.integrity_check,"ok");
 }finally{rollback.close();}
});
