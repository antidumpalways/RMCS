-- Additive Sprint 1 Telegram support; existing transaction/accounting rows are untouched.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "telegramUserId" BIGINT,
  ADD COLUMN IF NOT EXISTS "telegramLinkCodeHash" TEXT,
  ADD COLUMN IF NOT EXISTS "telegramLinkExpiresAt" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "User_telegramUserId_key" ON "User"("telegramUserId");
CREATE UNIQUE INDEX IF NOT EXISTS "User_telegramLinkCodeHash_key" ON "User"("telegramLinkCodeHash");

ALTER TABLE "ShiftClosure" ADD COLUMN IF NOT EXISTS "telegramDraftId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ShiftClosure_telegramDraftId_key" ON "ShiftClosure"("telegramDraftId");

CREATE TABLE IF NOT EXISTS "TelegramUpdate" (
  "updateId" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROCESSING',
  "attempts" INTEGER NOT NULL DEFAULT 1,
  "leaseUntil" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramUpdate_pkey" PRIMARY KEY ("updateId")
);
CREATE INDEX IF NOT EXISTS "TelegramUpdate_status_leaseUntil_idx" ON "TelegramUpdate"("status", "leaseUntil");

CREATE TABLE IF NOT EXISTS "TelegramSession" (
  "id" TEXT NOT NULL,
  "chatId" BIGINT NOT NULL,
  "userId" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "draftId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TelegramSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "TelegramSession_chatId_userId_key" ON "TelegramSession"("chatId", "userId");
CREATE INDEX IF NOT EXISTS "TelegramSession_userId_expiresAt_idx" ON "TelegramSession"("userId", "expiresAt");

CREATE TABLE IF NOT EXISTS "TelegramDraft" (
  "id" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "chatId" BIGINT NOT NULL,
  "kind" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TelegramDraft_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TelegramDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "TelegramDraft_userId_status_expiresAt_idx" ON "TelegramDraft"("userId", "status", "expiresAt");
CREATE INDEX IF NOT EXISTS "TelegramDraft_chatId_status_idx" ON "TelegramDraft"("chatId", "status");

