import sqlite3 from 'sqlite3';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';

// 防止开发环境下热更新导致数据库连接被多次实例化锁死
const globalForDb = global as unknown as { __db?: sqlite3.Database };

const configuredDbPath = (process.env.DATABASE_PATH || 'codes.db').trim();
const dbPath = path.isAbsolute(configuredDbPath)
  ? configuredDbPath
  : path.resolve(/* turbopackIgnore: true */ process.cwd(), configuredDbPath);
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = globalForDb.__db ?? new sqlite3.Database(dbPath);

if (process.env.NODE_ENV !== 'production') globalForDb.__db = db;

// 初始化表结构
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS gift_codes (
      code TEXT PRIMARY KEY,
      item_id INTEGER,
      status TEXT DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS global_config (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
  db.run(`INSERT OR IGNORE INTO global_config (key, value) VALUES ('pityCount', '0')`);
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password_hash TEXT,
      salt TEXT,
      token TEXT,
      gacha_data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ===== SITE CONFIG TABLE =====
  db.run(`
    CREATE TABLE IF NOT EXISTS site_config (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ===== SONGS TABLE =====
  db.run(`
    CREATE TABLE IF NOT EXISTS songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      name TEXT NOT NULL,
      artist TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ===== HIDDEN SONGS TABLE =====
  db.run(`
    CREATE TABLE IF NOT EXISTS hidden_songs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// 封装 Promise 版本的常用方法，替代原先的回调地狱
export const get = (query: string, params: any[] = []): Promise<any> => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err); else resolve(row);
    });
  });
};

export const all = (query: string, params: any[] = []): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err); else resolve(rows);
    });
  });
};

export const run = (query: string, params: any[] = []): Promise<any> => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) reject(err); else resolve(this);
    });
  });
};

export const getConfig = async (key: string) => {
  const row = await get("SELECT value FROM global_config WHERE key = ?", [key]);
  return row ? row.value : null;
};

export const setConfig = async (key: string, value: string | number) => {
  await run("UPDATE global_config SET value = ? WHERE key = ?", [String(value), key]);
};

export const hashPassword = (password: string, salt: string) => {
  return crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
};