import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedTelegramGroup, authorizedTelegramGroupSender, callbackBelongsToActor, formatTelegramRupiah, parseCashInput, parseTelegramCallback, parseTelegramCommand, parseTelegramOwnerIds, telegramId } from './core';

test('parses commands and optional bot mention', () => {
  assert.deepEqual(parseTelegramCommand('/Rekap'), { command: 'rekap', args: '' });
  assert.deepEqual(parseTelegramCommand('/status@RCellBot  hari ini'), { command: 'status', args: 'hari ini' });
  assert.equal(parseTelegramCommand('halo /rekap'), null);
});

test('allows only configured group and supergroup IDs', () => {
  assert.equal(allowedTelegramGroup(-100123, 'supergroup', '-100123, -100456'), true);
  assert.equal(allowedTelegramGroup(-100123, 'group', '-100456'), false);
  assert.equal(allowedTelegramGroup(123, 'private', '123'), false);
  assert.equal(allowedTelegramGroup(-100123, 'supergroup', undefined), false);
});

test('allowlisted group membership gives an unlinked numeric sender a Telegram identity', () => {
  assert.equal(authorizedTelegramGroupSender({ chatId: -100123, chatType: 'supergroup', senderId: 700001, configuredGroups: '-100123' }), 700001n);
  assert.equal(authorizedTelegramGroupSender({ chatId: -100999, chatType: 'supergroup', senderId: 700001, configuredGroups: '-100123' }), null);
  assert.equal(authorizedTelegramGroupSender({ chatId: 700001, chatType: 'private', senderId: 700001, configuredGroups: '-100123,700001' }), null);
});

test('anonymous and channel-originated senders are rejected in an authorized group', () => {
  assert.equal(authorizedTelegramGroupSender({ chatId: -100123, chatType: 'supergroup', senderId: 700001, senderChatId: -100123, configuredGroups: '-100123' }), null);
  assert.equal(authorizedTelegramGroupSender({ chatId: -100123, chatType: 'channel', senderId: 700001, configuredGroups: '-100123' }), null);
  assert.equal(authorizedTelegramGroupSender({ chatId: -100123, chatType: 'supergroup', senderId: undefined, configuredGroups: '-100123' }), null);
});

test('shared group callbacks remain bound to the Telegram identity that owns the draft', () => {
  assert.equal(callbackBelongsToActor('telegram-employee-a', 'telegram-employee-a'), true);
  assert.equal(callbackBelongsToActor('telegram-employee-a', 'telegram-employee-b'), false);
  assert.equal(callbackBelongsToActor(null, 'telegram-employee-a'), false);
});

test('owner authorization uses explicit numeric Telegram IDs only', () => {
  assert.deepEqual([...parseTelegramOwnerIds('123456, 700001, name, -5, 123456')], ['123456', '700001']);
});

test('parses non-negative rupiah input without accepting ambiguous text', () => {
  assert.equal(parseCashInput('Rp 1.250.000'), 1_250_000n);
  assert.equal(parseCashInput('0'), 0n);
  assert.equal(parseCashInput('12 ribu'), null);
  assert.equal(parseCashInput('1..000'), null);
  assert.equal(parseCashInput('1000000000001'), null);
});

test('rejects unsafe Telegram numeric IDs', () => {
  assert.equal(telegramId(123456), 123456n);
  assert.equal(telegramId(Number.MAX_SAFE_INTEGER + 1), null);
  assert.equal(telegramId('123456'), null);
});
test('validates inline callback payloads', () => {
  assert.deepEqual(parseTelegramCallback('rcms:ok:clx012345678901234567890'), { operation: 'ok', draftId: 'clx012345678901234567890' });
  assert.deepEqual(parseTelegramCallback('rcms:cancel:clx012345678901234567890'), { operation: 'cancel', draftId: 'clx012345678901234567890' });
  assert.deepEqual(parseTelegramCallback('rcms:ok:clx012345678901234567890:4'), { operation: 'ok', draftId: 'clx012345678901234567890', revision: 4 });
  assert.equal(parseTelegramCallback('rcms:ok:bad'), null);
  assert.equal(parseTelegramCallback('rcms:edit:clx012345678901234567890:2')?.operation, 'edit');
  assert.equal(parseTelegramCallback(undefined), null);
});

test('formats BigInt rupiah without converting to floating point', () => {
  assert.equal(formatTelegramRupiah(123456789012345678n), 'Rp 123.456.789.012.345.678');
  assert.equal(formatTelegramRupiah(-1250n), 'Rp −1.250');
});
