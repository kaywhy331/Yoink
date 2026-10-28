import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {copyFileSync,mkdtempSync,readFileSync,readdirSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {MIGRATIONS} from "../packages/database/src/migrations.js";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import test from "node:test";
import {YoinkDatabase} from "../packages/database/src/database.js";

// Build the historical schema from the committed migrations, with synthetic rows only.
// A clean checkout must not depend on an ignored local database under data/.
function schema72(path:string){
 const db=new DatabaseSync(path);
 try{
  db.exec("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL) STRICT;");
  for(const migration of MIGRATIONS.filter(m=>m.version<=72)){
   db.exec(migration.sql);
   db.prepare("INSERT INTO schema_migrations VALUES(?,?,?)").run(migration.version,migration.name,"2026-10-01T00:00:00Z");
  }
  db.exec(`
   INSERT INTO retailers(id,display_name,created_at,updated_at) VALUES('target','Target','2026-10-01','2026-10-01');
   INSERT INTO product_families(id,title,created_at,updated_at) VALUES('fixture_family','Synthetic item','2026-10-01','2026-10-01');
   INSERT INTO variants(id,family_id,title,created_at,updated_at) VALUES('fixture_variant','fixture_family','Single item','2026-10-01','2026-10-01');
   INSERT INTO listings(id,variant_id,retailer_id,retailer_sku,canonical_url,msrp_cents,created_at,updated_at)
    VALUES('fixture_listing','fixture_variant','target','95280894','https://www.target.com/p/-/A-95280894',2999,'2026-10-01','2026-10-01');
   INSERT INTO source_connections(id,tenant_id,user_id,source,name,status,created_at,updated_at)
    VALUES('fixture_source','tenant_local','user_local','trackalacker','Synthetic source','disconnected','2026-10-01','2026-10-01');
   INSERT INTO app_settings(user_id,actions_paused,pause_reason,updated_at) VALUES('user_local',1,'Synthetic safety pause','2026-10-01');
   INSERT INTO missions(id,tenant_id,user_id,variant_id,status,target_quantity,created_at,updated_at)
    VALUES('fixture_mission','tenant_local','user_local','fixture_variant','paused',2,'2026-10-01','2026-10-01');
   INSERT INTO mission_targets(id,mission_id,listing_id,max_unit_price_cents,created_at,updated_at)
    VALUES('fixture_target','fixture_mission','fixture_listing',2999,'2026-10-01','2026-10-01');
   INSERT INTO official_msrp_evidence(id,tenant_id,user_id,listing_id,revision,identity_hash,evidence_hash,
    desired_variant,variant_attributes_json,msrp_cents,source_url,manufacturer_host,source_excerpt,source_checked_at,
    reviewed_by_actor_id,reviewed_at,expires_at,status)
    VALUES('fixture_evidence','tenant_local','user_local','fixture_listing',1,'synthetic-identity','synthetic-evidence',
    'Single item','{}',2999,'https://maker.example/item','maker.example','Synthetic evidence','2026-10-01',
    'user_local','2026-10-01','2026-11-01','approved');
  `);
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length,0);
 }finally{db.close();}
}
test("migrations73 and74 preserve schema72 data and the verified cold backup restores byte-for-byte",()=>{
 const root=mkdtempSync(join(tmpdir(),"yoink-migration73-"));
 try{
 const base=join(root,"synthetic-before73.sqlite");const work=join(root,"migrated.sqlite");
 schema72(base);
 const backup=join(root,"cold-backup72.sqlite");const restored=join(root,"restored72.sqlite");
 const hash=(p:string)=>createHash("sha256").update(readFileSync(p)).digest("hex");
 const snapshot=(p:string)=>{
  const db=new DatabaseSync(p,{readOnly:true});try{
   const names=(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('schema_migrations','single_cart_attempts','amazon_approved_test') ORDER BY name").all() as Array<{name:string}>).map(r=>r.name);
   return Object.fromEntries(names.map(name=>[name,db.prepare(`SELECT * FROM "${name}"`).all().map(row=>{
    return JSON.stringify(row);
   }).sort()]));
  }finally{db.close();}
 };
 copyFileSync(base,backup);copyFileSync(base,work);const before=snapshot(base);assert.equal(hash(base),hash(backup));
 // Isolate 73/74 from later migrations so every pre-existing field is compared.
 const intermediate=new DatabaseSync(work);
 try{
  intermediate.exec("PRAGMA foreign_keys=ON;");
  for(const migration of MIGRATIONS.filter(m=>m.version===73||m.version===74)){
   intermediate.exec(migration.sql);
   intermediate.prepare("INSERT INTO schema_migrations VALUES(?,?,?)").run(migration.version,migration.name,"2026-10-02T00:00:00Z");
  }
  assert.equal(intermediate.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v,74);
 }finally{intermediate.close();}
 assert.deepEqual(snapshot(work),before,"73/74 change no existing settings, plans, evidence, source state or other rows");
 // Separately exercise normal current startup and its automatic pre-migration backup.
 const startup=join(root,"startup.sqlite");copyFileSync(base,startup);
 const upgraded=new YoinkDatabase(startup);
 try{
  assert.equal(upgraded.get<{v:number}>("SELECT MAX(version) AS v FROM schema_migrations")?.v,84);
  assert.equal(upgraded.get<{actions_paused:number}>("SELECT actions_paused FROM app_settings")?.actions_paused,1);
  assert.equal(upgraded.get<{n:number}>("SELECT COUNT(*) AS n FROM single_cart_attempts")?.n,0);
  assert.equal(upgraded.get<{n:number}>("SELECT COUNT(*) AS n FROM amazon_approved_test")?.n,0);
  assert.equal(upgraded.get<{n:number}>("SELECT COUNT(*) AS n FROM action_jobs")?.n,0);
  assert.equal(upgraded.connection.prepare("PRAGMA integrity_check").get()?.integrity_check,"ok");
  assert.equal(upgraded.connection.prepare("PRAGMA foreign_key_check").all().length,0);
  // Later migrations may add fields and startup defaults; every original fixture field survives.
  for(const table of ["app_settings","missions","mission_targets","official_msrp_evidence","source_connections"]){
   for(const encoded of before[table]!){
    const row=JSON.parse(encoded) as Record<string,unknown>;
    const key=table==="app_settings"?"user_id":"id";
    const actual=upgraded.get<Record<string,unknown>>(`SELECT * FROM "${table}" WHERE "${key}"=?`,String(row[key]));
    assert.ok(actual,`startup preserves ${table} row`);
    assert.deepEqual(Object.fromEntries(Object.keys(row).map(column=>[column,actual[column]])),row);
   }
  }
 }finally{upgraded.close();}
 const automatic=readdirSync(root).filter(n=>n.startsWith("startup.sqlite.before-v84.")&&n.endsWith(".sqlite"));
 assert.equal(automatic.length,1,"normal startup makes its own pre-migration backup");
 const automaticDb=new DatabaseSync(join(root,automatic[0]!),{readOnly:true});
 try{assert.equal(automaticDb.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v,72);}finally{automaticDb.close();}
 copyFileSync(backup,restored);assert.equal(hash(restored),hash(base));assert.deepEqual(snapshot(restored),before);
 const rollback=new DatabaseSync(restored,{readOnly:true});try{
  assert.equal(rollback.prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v,72);
  assert.equal(rollback.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='single_cart_attempts'").get()?.n,0);
  assert.equal(rollback.prepare("PRAGMA integrity_check").get()?.integrity_check,"ok");
 }finally{rollback.close();}
 }finally{rmSync(root,{recursive:true,force:true});}
});
