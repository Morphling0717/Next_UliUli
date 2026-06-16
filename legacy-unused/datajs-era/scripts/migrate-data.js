/* eslint-disable @typescript-eslint/no-require-imports */

/**
 * 一次性数据迁移脚本
 * 将 public/data.js 中的数据迁移到 SQLite 数据库
 * 
 * 使用方法：
 * node scripts/migrate-data.js
 */

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// 创建数据库连接
const dbPath = path.resolve(__dirname, '../codes.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ 数据库连接失败:', err);
    process.exit(1);
  }
  console.log('✅ 已连接到数据库:', dbPath);
});

// Promise 版本的 db.run
const dbRun = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
};

// 初始化数据库表结构
async function initTables() {
  try {
    console.log('\n📋 初始化数据库表结构...');
    
    await dbRun(`
      CREATE TABLE IF NOT EXISTS site_config (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await dbRun(`
      CREATE TABLE IF NOT EXISTS songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        name TEXT NOT NULL,
        artist TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await dbRun(`
      CREATE TABLE IF NOT EXISTS hidden_songs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ 表结构初始化完成');
  } catch (error) {
    console.error('❌ 表结构初始化失败:', error);
    throw error;
  }
}

// 读取 data.js
async function migrateData() {
  try {
    // 先初始化表结构
    await initTables();

    // 读取 data.js 文件
    const dataJsPath = path.resolve(__dirname, '../public/data.js');
    if (!fs.existsSync(dataJsPath)) {
      console.log('⚠️  public/data.js 不存在，跳过迁移');
      db.close();
      return;
    }

    const dataContent = fs.readFileSync(dataJsPath, 'utf-8');

    // 提取全局变量
    const siteConfigMatch = dataContent.match(/window\.SITE_CONFIG\s*=\s*({[\s\S]*?});/);
    const songDataMatch = dataContent.match(/window\.SONG_DATA\s*=\s*(\[[\s\S]*?\]);/);
    const hiddenSongsMatch = dataContent.match(/window\.HIDDEN_SONGS\s*=\s*(\[[\s\S]*?\]);/);

    const siteConfig = siteConfigMatch ? JSON.parse(siteConfigMatch[1]) : {};
    const songData = songDataMatch ? JSON.parse(songDataMatch[1]) : [];
    const hiddenSongs = hiddenSongsMatch ? JSON.parse(hiddenSongsMatch[1]) : [];

    console.log('\n📦 即将迁移的数据:');
    console.log('  - SITE_CONFIG 字段数:', Object.keys(siteConfig).length);
    console.log('  - 普通歌曲数:', songData.length);
    console.log('  - 隐藏歌曲数:', hiddenSongs.length);

    // 开始事务
    await dbRun('BEGIN TRANSACTION');

    // 1. 迁移 SITE_CONFIG
    console.log('\n🔄 迁移 SITE_CONFIG...');
    await dbRun(
      `INSERT OR REPLACE INTO site_config (key, value, updated_at) 
       VALUES (?, ?, CURRENT_TIMESTAMP)`,
      ['site_config', JSON.stringify(siteConfig)]
    );
    console.log('✅ SITE_CONFIG 迁移完成');

    // 2. 迁移 SONG_DATA
    console.log('🔄 迁移 SONG_DATA...');
    // 先清空原有数据
    await dbRun('DELETE FROM songs');
    // 插入新数据
    for (const song of songData) {
      await dbRun(
        `INSERT INTO songs (category, name, artist) VALUES (?, ?, ?)`,
        [song.category, song.name, song.artist]
      );
    }
    console.log(`✅ ${songData.length} 首歌曲迁移完成`);

    // 3. 迁移 HIDDEN_SONGS
    console.log('🔄 迁移 HIDDEN_SONGS...');
    // 先清空原有数据
    await dbRun('DELETE FROM hidden_songs');
    // 插入新数据
    for (const hidden of hiddenSongs) {
      await dbRun(
        `INSERT INTO hidden_songs (name) VALUES (?)`,
        [hidden.name]
      );
    }
    console.log(`✅ ${hiddenSongs.length} 首隐藏歌曲迁移完成`);

    // 提交事务
    await dbRun('COMMIT');

    console.log('\n✅ 数据迁移成功！');
    console.log('\n📝 后续步骤:');
    console.log('  1. 删除或重命名 public/data.js (可选)');
    console.log('  2. 启动应用，验证数据是否正确加载');
    console.log('  3. 访问 /admin 后台进行配置管理');

  } catch (error) {
    console.error('\n❌ 迁移失败:', error);
    // 回滚事务
    await dbRun('ROLLBACK').catch(() => {});
  } finally {
    db.close(() => {
      console.log('\n数据库连接已关闭');
    });
  }
}

// 执行迁移
migrateData();
