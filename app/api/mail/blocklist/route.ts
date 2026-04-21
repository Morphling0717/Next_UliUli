import { NextResponse } from 'next/server';
import { all } from '@/lib/db';
import { verifyMailAdmin } from '@/lib/mail-auth';

/** 管理端：读取黑名单列表。 */
export async function GET(req: Request) {
  const auth = await verifyMailAdmin(req);
  if (auth) return auth;
  try {
    const rows = (await all(
      `SELECT hash, label, blocked_at, sample_text
       FROM mail_blocklist
       ORDER BY datetime(blocked_at) DESC`,
    )) as Array<{
      hash: string;
      label: string | null;
      blocked_at: string;
      sample_text: string | null;
    }>;
    return NextResponse.json(
      rows.map((r) => ({
        hash: r.hash,
        label: r.label,
        blockedAt: r.blocked_at,
        sampleText: r.sample_text,
      })),
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : '读取失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
