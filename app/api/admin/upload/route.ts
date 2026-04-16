import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const ALLOWED_DIRS = ['memes', 'pic'];
const ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

export async function POST(request: NextRequest) {
  try {
    if (!ADMIN_PASSWORD) {
      return NextResponse.json({
        success: false,
        message: '服务器未配置 ADMIN_PASSWORD 环境变量'
      }, { status: 500 });
    }

    const contentType = request.headers.get('content-type') || '';
    
    let action = '', folder = '', password = '', filename = '', newname = '';
    let file: File | null = null;

    // 处理 FormData (上传图片) 和 JSON (列表、重命名、删除) 两种请求
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      action = formData.get('action') as string;
      folder = formData.get('folder') as string;
      password = formData.get('password') as string;
      file = formData.get('file') as File;
    } else {
      const body = await request.json();
      action = body.action;
      folder = body.folder;
      password = body.password;
      filename = body.filename;
      newname = body.newname;
    }

    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json({ success: false, message: '密码错误，拒绝访问' });
    }

    if (!ALLOWED_DIRS.includes(folder)) {
      return NextResponse.json({ success: false, message: '无效的文件夹权限' });
    }

    const targetDir = path.join(process.cwd(), 'public', folder);

    // 确保目标文件夹存在
    try {
      await fs.access(targetDir);
    } catch {
      await fs.mkdir(targetDir, { recursive: true });
    }

    // === 功能 1: 获取文件列表 ===
    if (action === 'list') {
      const files = await fs.readdir(targetDir);
      const result = [];
      
      for (const f of files) {
        if (f === '.' || f === '..') continue;
        const ext = f.split('.').pop()?.toLowerCase() || '';
        if (ALLOWED_EXTS.includes(ext)) {
          const stat = await fs.stat(path.join(targetDir, f));
          result.push({
            name: f,
            path: `${folder}/${f}`,
            size: (stat.size / 1024).toFixed(2) + ' KB',
            time: Math.floor(stat.mtimeMs / 1000)
          });
        }
      }
      
      // 按时间倒序
      result.sort((a, b) => b.time - a.time);
      return NextResponse.json({ success: true, files: result });
    }

    // === 功能 2: 上传文件 ===
    if (action === 'upload') {
      if (!file) return NextResponse.json({ success: false, message: '没有接收到文件' });
      
      const rawName = file.name;
      const ext = rawName.split('.').pop()?.toLowerCase() || '';
      
      if (!ALLOWED_EXTS.includes(ext)) {
        return NextResponse.json({ success: false, message: '不支持的文件类型: ' + ext });
      }

      // 安全处理文件名
      const safeName = /[^a-zA-Z0-9\._-]/.test(rawName) ? `safe_${Date.now()}.${ext}` : rawName;
      const buffer = Buffer.from(await file.arrayBuffer());
      
      await fs.writeFile(path.join(targetDir, safeName), buffer);
      return NextResponse.json({ success: true, message: '上传成功', file: `${folder}/${safeName}` });
    }

    // === 功能 3: 重命名文件 ===
    if (action === 'rename') {
      if (!filename || !newname) return NextResponse.json({ success: false, message: '文件名不能为空' });
      
      const ext = newname.split('.').pop()?.toLowerCase() || '';
      if (!ALLOWED_EXTS.includes(ext)) return NextResponse.json({ success: false, message: '新文件名必须包含合法的图片后缀' });
      if (/[^a-zA-Z0-9\._-]/.test(newname)) return NextResponse.json({ success: false, message: '新文件名包含非法字符' });

      const oldPath = path.join(targetDir, path.basename(filename));
      const newPath = path.join(targetDir, path.basename(newname));

      try { await fs.access(oldPath); } catch { return NextResponse.json({ success: false, message: '原文件不存在' }); }
      try { await fs.access(newPath); return NextResponse.json({ success: false, message: '目标文件名已存在' }); } catch {}

      await fs.rename(oldPath, newPath);
      return NextResponse.json({ success: true, message: '重命名成功' });
    }

    // === 功能 4: 删除文件 ===
    if (action === 'delete') {
      if (!filename) return NextResponse.json({ success: false, message: '文件名不能为空' });
      const targetPath = path.join(targetDir, path.basename(filename));
      
      try {
        await fs.unlink(targetPath);
        return NextResponse.json({ success: true, message: '删除成功' });
      } catch {
        return NextResponse.json({ success: false, message: '文件不存在' });
      }
    }

    return NextResponse.json({ success: false, message: '未知操作' });

  } catch (error: any) {
    console.error("Upload API Error:", error);
    return NextResponse.json({ success: false, message: '服务器内部错误: ' + error.message });
  }
}