/* eslint-disable @typescript-eslint/no-require-imports */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sqlite3 = require('sqlite3');

const projectRoot = path.resolve(__dirname, '..');
const configuredDbPath = (process.env.DATABASE_PATH || 'data/codes.db').trim();
const dbPath = path.isAbsolute(configuredDbPath)
  ? configuredDbPath
  : path.resolve(projectRoot, configuredDbPath);
const backupDir = path.resolve(
  process.env.DB_BACKUP_DIR || path.join(path.dirname(dbPath), 'backups'),
);
const retention = Number.parseInt(process.env.DB_BACKUP_RETENTION || '20', 10);

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function quoteSqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function run(db, query, params = []) {
  return new Promise((resolve, reject) => {
    db.run(query, params, function onRun(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

function close(db) {
  return new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function pruneOldBackups() {
  if (!Number.isFinite(retention) || retention <= 0) return;
  const backups = fs.readdirSync(backupDir)
    .filter((file) => /^codes-\d{8}T\d{6}Z\.db$/.test(file))
    .map((file) => ({
      file,
      path: path.join(backupDir, file),
      time: fs.statSync(path.join(backupDir, file)).mtimeMs,
    }))
    .sort((a, b) => b.time - a.time);

  for (const oldBackup of backups.slice(retention)) {
    fs.rmSync(oldBackup.path, { force: true });
    fs.rmSync(`${oldBackup.path}.json`, { force: true });
  }
}

async function main() {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }
  fs.mkdirSync(backupDir, { recursive: true });

  const backupPath = path.join(backupDir, `codes-${timestamp()}.db`);
  const db = new sqlite3.Database(dbPath);
  try {
    await run(db, 'PRAGMA wal_checkpoint(TRUNCATE)');
    await run(db, `VACUUM INTO ${quoteSqlString(backupPath)}`);
  } finally {
    await close(db);
  }

  const manifest = {
    source: dbPath,
    backup: backupPath,
    createdAt: new Date().toISOString(),
    bytes: fs.statSync(backupPath).size,
    sha256: sha256(backupPath),
  };
  fs.writeFileSync(`${backupPath}.json`, `${JSON.stringify(manifest, null, 2)}\n`);

  const metaDb = new sqlite3.Database(dbPath);
  try {
    await run(
      metaDb,
      `INSERT INTO global_config (key, value)
       VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      ['db.last_backup', JSON.stringify(manifest)],
    );
  } finally {
    await close(metaDb);
  }

  pruneOldBackups();

  console.log(`Database backup created: ${backupPath}`);
  console.log(`Size: ${manifest.bytes} bytes`);
  console.log(`SHA256: ${manifest.sha256}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
