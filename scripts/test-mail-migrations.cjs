/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {execFileSync} = require('node:child_process');
const sqlite = require('sqlite3');
const projectRoot=path.resolve(__dirname,'..');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'windchime-consumers-'));
const open=file=>new sqlite.Database(file);
const run=(db,sql,values=[])=>new Promise((resolve,reject)=>db.run(sql,values,error=>error?reject(error):resolve()));
const get=(db,sql)=>new Promise((resolve,reject)=>db.get(sql,(error,row)=>error?reject(error):resolve(row)));
const close=db=>new Promise((resolve,reject)=>db.close(error=>error?reject(error):resolve()));
(async()=>{
{
 const site=path.basename(projectRoot);
 for(const scenario of ['fresh','legacy','current']){
  const filename=path.join(folder,`${site}-${scenario}.db`);
  const expectedGrants=[];
  if(scenario!=='fresh'){
   const db=open(filename);
   await run(db,`CREATE TABLE mail_messages(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,text TEXT NOT NULL,nickname TEXT,link_url TEXT,deleted_at TEXT,is_read INTEGER DEFAULT 0,is_favorited INTEGER DEFAULT 0,sender_hash TEXT,sender_label TEXT${scenario==='current'?',is_flagged INTEGER DEFAULT 0,topic_id TEXT DEFAULT \'default\'':''})`);
   await run(db,"INSERT INTO mail_messages(id,created_at,text,is_read,is_favorited,sender_hash,sender_label) VALUES('old-letter','2020-01-02T03:04:05.000Z','kept',1,1,'stable-hash','User-STAB')");
   await run(db,'CREATE TABLE mail_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL)');
   await run(db,"INSERT INTO mail_settings VALUES('mail.enabled','0','2020-01-02T03:04:05.000Z')");
   await run(db,'CREATE TABLE mail_blocklist(hash TEXT PRIMARY KEY,label TEXT,blocked_at TEXT NOT NULL,sample_text TEXT)');
   await run(db,"INSERT INTO mail_blocklist VALUES('stable-hash','User-STAB','2020-01-02T03:04:05.000Z','kept')");
   if(scenario==='current') {
    await run(db,`CREATE TABLE mail_topics(id TEXT PRIMARY KEY,slug TEXT UNIQUE NOT NULL,title TEXT NOT NULL,description TEXT,note TEXT,is_default INTEGER DEFAULT 0,is_enabled INTEGER DEFAULT 1,starts_at TEXT,ends_at TEXT,archived_at TEXT,sort_order INTEGER DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);
    await run(db,`INSERT INTO mail_topics VALUES('default','default','常规信箱',NULL,NULL,1,0,NULL,NULL,NULL,0,'2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z')`);
    await run(db,`INSERT INTO mail_topics VALUES('old-topic','historic-event','旧活动','原描述','内部备注',0,1,NULL,NULL,'2020-01-03T00:00:00.000Z',2,'2020-01-01T00:00:00.000Z','2020-01-03T00:00:00.000Z')`);
    await run(db,`UPDATE mail_messages SET topic_id='old-topic',is_flagged=1 WHERE id='old-letter'`);
   }
   // Legacy pre-site keys must remain topic-scoped; 0.7 site keys keep their
   // existing scope, hashes, expiry and parent revocation relationships.
   const scoped=scenario==='current';
   await run(db,`CREATE TABLE mail_live_grants(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,${scoped ? "scope TEXT NOT NULL DEFAULT 'topic',topic_id TEXT" : 'topic_id TEXT NOT NULL'},label TEXT NOT NULL,expires_at INTEGER NOT NULL,revoked_at INTEGER,binding_id TEXT,platform_session TEXT,parent_grant_id TEXT)`);
   const addGrant=async(id,kind,scope,topicId,parentId,revokedAt=null)=>{
    const row={id,token_hash:`fixture-hash-${id}`,kind,scope,topic_id:topicId,label:`retained-${id}`,expires_at:4102444800000,revoked_at:revokedAt,binding_id:null,platform_session:null,parent_grant_id:parentId};
    const columns=Object.keys(row).filter(key=>scoped||key!=='scope');
    await run(db,`INSERT INTO mail_live_grants(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`,columns.map(key=>row[key]));
    expectedGrants.push(row);
   };
   await addGrant('old-topic-key','control','topic','default',null);
   await addGrant('old-topic-display','display','topic','default','old-topic-key');
   await addGrant('revoked-topic-key','control','topic','default',null,1580000000000);
   if(scoped){
    await addGrant('existing-site-key','control','site',null,null);
    await addGrant('site-child-display','display','topic','old-topic','existing-site-key');
   }
   await run(db,'CREATE TABLE host_sentinel(value TEXT)'); await run(db,"INSERT INTO host_sentinel VALUES('untouched')");
   await close(db);
  }
  for(let round=0;round<2;round++)execFileSync(process.execPath,['scripts/migrate-db.js'],{cwd:projectRoot,env:{...process.env,DATABASE_PATH:filename},stdio:'pipe'});
  const db=open(filename);
  const topic=await get(db,"SELECT * FROM mail_topics WHERE id='default'"); assert(topic);
  assert.equal((await get(db,'PRAGMA integrity_check')).integrity_check,'ok');
  assert.equal((await get(db,"SELECT COUNT(*) n FROM windchime_migrations WHERE id='0.8.2-live-queue-invalidation'")).n,1,'queue invalidation upgrade runs once');
  assert((await get(db,"SELECT sql FROM sqlite_master WHERE type='trigger' AND name='live_message_changed'")).sql.includes('current_snapshot IN'),'legacy topic-wide clearing trigger is replaced');
  assert(await get(db,"SELECT name FROM sqlite_master WHERE type='trigger' AND name='live_queue_cursor_removed'"),'queue removal preserves its cursor');
  for(const expected of expectedGrants) assert.deepEqual(await get(db,`SELECT * FROM mail_live_grants WHERE id='${expected.id}'`),expected,'existing authority is preserved without widening permissions');
  if(scenario!=='fresh'){
   const row=await get(db,"SELECT * FROM mail_messages WHERE id='old-letter'");
   assert.equal(row.topic_id,scenario==='current'?'old-topic':'default'); assert.equal(row.is_read,1);assert.equal(row.is_favorited,1);assert.equal(row.text,'kept');assert.equal(row.sender_hash,'stable-hash');assert.equal(row.created_at,'2020-01-02T03:04:05.000Z');
   if(scenario==='current'){ const historic=await get(db,"SELECT * FROM mail_topics WHERE id='old-topic'");assert.equal(historic.slug,'historic-event');assert.equal(historic.note,'内部备注');assert.equal(historic.archived_at,'2020-01-03T00:00:00.000Z');assert.equal(row.is_flagged,1);}
   assert.equal(topic.is_enabled,0);assert.equal((await get(db,'SELECT COUNT(*) AS count FROM mail_blocklist')).count,1);assert.equal((await get(db,'SELECT value FROM host_sentinel')).value,'untouched');
  }
  if(expectedGrants.length){
   await run(db,"UPDATE mail_live_grants SET revoked_at=1700000000000 WHERE id='old-topic-key'");
   assert.equal((await get(db,"SELECT revoked_at FROM mail_live_grants WHERE id='old-topic-display'")).revoked_at,1700000000000);
   if(scenario==='current'){
    assert.equal((await get(db,"SELECT revoked_at FROM mail_live_grants WHERE id='existing-site-key'")).revoked_at,null);
    await run(db,"UPDATE mail_live_grants SET revoked_at=1700000000001 WHERE id='existing-site-key'");
    assert.equal((await get(db,"SELECT revoked_at FROM mail_live_grants WHERE id='site-child-display'")).revoked_at,1700000000001);
   }
  }
  console.log(`${site} ${scenario}: both CLI migration runs passed; mailbox, host data, grant scope/hash/expiry/revocation retained`);
  await close(db);
 }
}
fs.rmSync(folder,{recursive:true});
})().catch(error=>{console.error(error);process.exitCode=1});
