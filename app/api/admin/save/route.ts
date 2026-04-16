import { NextRequest, NextResponse } from 'next/server';
import { run } from '@/lib/db';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

export async function POST(request: NextRequest) {
  try {
    if (!ADMIN_PASSWORD) {
      return NextResponse.json({
        success: false,
        message: '服务器未配置 ADMIN_PASSWORD 环境变量'
      }, { status: 500 });
    }

    const body = await request.json();

    if (!body) {
      return NextResponse.json({ success: false, message: 'No data received' });
    }

    if (body.password !== ADMIN_PASSWORD) {
      return NextResponse.json({ success: false, message: '密码错误，拒绝访问' });
    }

    const { site_info, song_data, hidden_songs } = body;

    if (!site_info || !song_data) {
      return NextResponse.json({ success: false, message: '数据格式不完整' });
    }

    // 防止误请求把数据库覆盖成空内容
    if (
      typeof site_info !== 'object' ||
      site_info === null ||
      Object.keys(site_info).length === 0
    ) {
      return NextResponse.json({
        success: false,
        message: '配置为空，已拒绝保存'
      });
    }

    if (!Array.isArray(song_data) || song_data.length === 0) {
      return NextResponse.json({
        success: false,
        message: '歌曲列表为空，已拒绝保存'
      });
    }

    const safeHiddenSongs = Array.isArray(hidden_songs) ? hidden_songs : [];

    // 开始事务
    await run('BEGIN TRANSACTION');

    try {
      // 1. 保存 site_config
      const siteConfigJson = JSON.stringify(site_info);
      await run(
        `INSERT OR REPLACE INTO site_config (key, value, updated_at) 
         VALUES (?, ?, CURRENT_TIMESTAMP)`,
        ['site_config', siteConfigJson]
      );

      // 2. 清空并重新插入 songs
      await run('DELETE FROM songs');
      for (const song of song_data) {
        await run(
          `INSERT INTO songs (category, name, artist) VALUES (?, ?, ?)`,
          [song.category, song.name, song.artist]
        );
      }

      // 3. 清空并重新插入 hidden_songs
      await run('DELETE FROM hidden_songs');
      for (const hidden of safeHiddenSongs) {
        await run(
          `INSERT INTO hidden_songs (name) VALUES (?)`,
          [hidden.name]
        );
      }

      // 提交事务
      await run('COMMIT');

      return NextResponse.json({ 
        success: true, 
        message: '数据已保存到数据库' 
      });

    } catch (txError) {
      // 回滚事务
      await run('ROLLBACK').catch(() => {});
      throw txError;
    }

  } catch (error: any) {
    console.error("Save API Error:", error);
    return NextResponse.json({ 
      success: false, 
      message: '服务器错误: ' + error.message 
    });
  }
}