import assert from 'node:assert/strict';
import test from 'node:test';

test('webhook requires a configured secret and rejects invalid headers', async () => {
  const previousSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/rcms?schema=public';
  const { handleTelegramWebhook } = await import('./bot');
  try {
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const unconfigured = await handleTelegramWebhook(new Request('https://example.test/api/telegram/webhook', { method: 'POST', body: '{}' }));
    assert.equal(unconfigured.status, 503);

    process.env.TELEGRAM_WEBHOOK_SECRET = 'valid_secret-123';
    const unauthorized = await handleTelegramWebhook(new Request('https://example.test/api/telegram/webhook', {
      method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'wrong' }, body: '{}',
    }));
    assert.equal(unauthorized.status, 401);

    const acceptedSecret = await handleTelegramWebhook(new Request('https://example.test/api/telegram/webhook', {
      method: 'POST', headers: { 'x-telegram-bot-api-secret-token': 'valid_secret-123', 'content-type': 'application/json' }, body: JSON.stringify({ update_id: 123 }),
    }));
    assert.equal(acceptedSecret.status, 200);
  } finally {
    if (previousSecret === undefined) delete process.env.TELEGRAM_WEBHOOK_SECRET;
    else process.env.TELEGRAM_WEBHOOK_SECRET = previousSecret;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
