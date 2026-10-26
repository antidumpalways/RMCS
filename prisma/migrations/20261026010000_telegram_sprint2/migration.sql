-- Sprint 2 stores confirmed Telegram shift reports separately from operational transactions.
ALTER TABLE "TelegramSession" ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS "TelegramShiftReport" (
  "id" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "userId" INTEGER NOT NULL,
  "chatId" BIGINT NOT NULL,
  "shiftLabel" TEXT,
  "payload" JSONB NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelegramShiftReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TelegramShiftReport_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "TelegramDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "TelegramShiftReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "TelegramShiftReport_draftId_key" ON "TelegramShiftReport"("draftId");
CREATE INDEX IF NOT EXISTS "TelegramShiftReport_userId_confirmedAt_idx" ON "TelegramShiftReport"("userId", "confirmedAt");
CREATE INDEX IF NOT EXISTS "TelegramShiftReport_chatId_confirmedAt_idx" ON "TelegramShiftReport"("chatId", "confirmedAt");

