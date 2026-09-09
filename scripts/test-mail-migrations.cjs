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
   await run(db,'CREATE TABLE host_sentinel(value TEXT)'); await run(db,"INSERT INTO host_sentinel VALUES('untouched')");
   await close(db);
  }
  for(let round=0;round<2;round++)execFileSync(process.execPath,['scripts/migrate-db.js'],{cwd:projectRoot,env:{...process.env,DATABASE_PATH:filename},stdio:'pipe'});
  const db=open(filename);
  const topic=await get(db,"SELECT * FROM mail_topics WHERE id='default'"); assert(topic);
  if(scenario!=='fresh'){
   const row=await get(db,"SELECT * FROM mail_messages WHERE id='old-letter'");
   assert.equal(row.topic_id,scenario==='current'?'old-topic':'default'); assert.equal(row.is_read,1);assert.equal(row.is_favorited,1);assert.equal(row.text,'kept');assert.equal(row.sender_hash,'stable-hash');assert.equal(row.created_at,'2020-01-02T03:04:05.000Z');
   if(scenario==='current'){ const historic=await get(db,"SELECT * FROM mail_topics WHERE id='old-topic'");assert.equal(historic.slug,'historic-event');assert.equal(historic.note,'内部备注');assert.equal(historic.archived_at,'2020-01-03T00:00:00.000Z');assert.equal(row.is_flagged,1);}
   assert.equal(topic.is_enabled,0);assert.equal((await get(db,'SELECT COUNT(*) AS count FROM mail_blocklist')).count,1);assert.equal((await get(db,'SELECT value FROM host_sentinel')).value,'untouched');
  }
  console.log(`${site} ${scenario}: both CLI migration runs passed; mailbox and host data retained`);
  await close(db);
 }
}
fs.rmSync(folder,{recursive:true});
})().catch(error=>{console.error(error);process.exitCode=1});
