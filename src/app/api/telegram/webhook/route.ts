import { NextResponse } from 'next/server';
import { handleTelegramWebhook } from '@/lib/telegram/bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const result = await handleTelegramWebhook(request);
  return NextResponse.json(result.body, { status: result.status });
}
