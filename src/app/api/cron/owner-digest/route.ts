import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { sendOwnerDigest } from '@/lib/services/owner-digest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Dipanggil Vercel Cron setiap malam. Vercel otomatis mengirim "Authorization: Bearer $CRON_SECRET".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: 'CRON_SECRET belum diset.' }, { status: 503 });
  const expected = Buffer.from('Bearer ' + secret);
  const given = Buffer.from(request.headers.get('authorization') ?? '');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  const result = await sendOwnerDigest();
  return NextResponse.json({ ok: true, ...result });
}
