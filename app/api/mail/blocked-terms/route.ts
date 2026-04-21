import { NextResponse } from 'next/server';
import { getMailBlockedTerms, setMailBlockedTerms } from '@/lib/db';
import { verifyMailAdmin } from '@/lib/mail-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** 读当前敏感词列表（管理端） */
export async function GET(req: Request) {
  const auth = await verifyMailAdmin(req);
  if (auth) return auth;
  try {
    const terms = await getMailBlockedTerms();
    return NextResponse.json({ terms });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '读取失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/** 覆盖保存敏感词列表（管理端）。body: { terms: string[] } */
export async function PUT(req: Request) {
  const auth = await verifyMailAdmin(req);
  if (auth) return auth;
  try {
    const body = (await req.json()) as { terms?: unknown };
    if (!Array.isArray(body.terms)) {
      return NextResponse.json(
        { error: 'terms 必须是字符串数组' },
        { status: 400 },
      );
    }
    const normalized = await setMailBlockedTerms(body.terms as string[]);
    return NextResponse.json({ terms: normalized });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '保存失败';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
