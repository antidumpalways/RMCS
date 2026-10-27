import { NextResponse } from 'next/server';
import { handleTelegramWebhook } from '@/lib/telegram/bot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: Request) {
  const result = await handleTelegramWebhook(request);
  return NextResponse.json(result.body, { status: result.status });
}
