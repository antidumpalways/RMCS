CREATE TABLE "TelegramOwnerReviewTask" (
  "id" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "chatId" BIGINT NOT NULL,
  "telegramIdentityId" TEXT,
  "reportId" TEXT,
  "payload" JSONB NOT NULL,
  "reviewedByTelegramUserId" BIGINT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelegramOwnerReviewTask_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TelegramOwnerReviewTask_operationKey_key" ON "TelegramOwnerReviewTask"("operationKey");
CREATE INDEX "TelegramOwnerReviewTask_status_createdAt_idx" ON "TelegramOwnerReviewTask"("status", "createdAt");
CREATE INDEX "TelegramOwnerReviewTask_reportId_createdAt_idx" ON "TelegramOwnerReviewTask"("reportId", "createdAt");
CREATE INDEX "TelegramOwnerReviewTask_chatId_createdAt_idx" ON "TelegramOwnerReviewTask"("chatId", "createdAt");