CREATE TABLE "BalanceAdjustment" (
    "id" SERIAL NOT NULL,
    "account" TEXT NOT NULL,
    "previousBalance" BIGINT NOT NULL,
    "newBalance" BIGINT NOT NULL,
    "delta" BIGINT NOT NULL,
    "note" TEXT,
    "createdById" INTEGER NOT NULL,
    "sourceDraftId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BalanceAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BalanceAdjustment_sourceDraftId_key" ON "BalanceAdjustment"("sourceDraftId");
CREATE INDEX "BalanceAdjustment_account_createdAt_idx" ON "BalanceAdjustment"("account", "createdAt");
CREATE INDEX "BalanceAdjustment_createdById_createdAt_idx" ON "BalanceAdjustment"("createdById", "createdAt");

ALTER TABLE "BalanceAdjustment"
  ADD CONSTRAINT "BalanceAdjustment_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BalanceAdjustment"
  ADD CONSTRAINT "BalanceAdjustment_sourceDraftId_fkey"
  FOREIGN KEY ("sourceDraftId") REFERENCES "TelegramDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;
