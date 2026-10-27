-- Isolate Telegram-native identities from RMCS web-login users.
CREATE TABLE "TelegramIdentity" (
    "id" TEXT NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "displayName" TEXT NOT NULL,
    "username" TEXT,
    "lastGroupId" BIGINT NOT NULL,
    "linkedUserId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TelegramIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramIdentity_telegramUserId_key" ON "TelegramIdentity"("telegramUserId");
CREATE UNIQUE INDEX "TelegramIdentity_linkedUserId_key" ON "TelegramIdentity"("linkedUserId");
CREATE INDEX "TelegramIdentity_lastGroupId_idx" ON "TelegramIdentity"("lastGroupId");

ALTER TABLE "TelegramIdentity"
  ADD CONSTRAINT "TelegramIdentity_linkedUserId_fkey"
  FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Preserve pre-existing linked identities and attach their existing Telegram records.
INSERT INTO "TelegramIdentity" ("id", "telegramUserId", "displayName", "username", "lastGroupId", "linkedUserId", "createdAt", "updatedAt")
SELECT
  'legacy_telegram_' || u."id"::text,
  u."telegramUserId",
  COALESCE(NULLIF(u."username", ''), 'Telegram user ' || u."telegramUserId"::text),
  u."username",
  COALESCE(
    (SELECT s."chatId" FROM "TelegramSession" s WHERE s."userId" = u."id" ORDER BY s."updatedAt" DESC LIMIT 1),
    (SELECT r."chatId" FROM "TelegramShiftReport" r WHERE r."userId" = u."id" ORDER BY r."confirmedAt" DESC LIMIT 1),
    0
  ),
  u."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "User" u
WHERE u."telegramUserId" IS NOT NULL;

ALTER TABLE "TelegramSession" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "TelegramSession" DROP CONSTRAINT "TelegramSession_userId_fkey";
ALTER TABLE "TelegramSession" ADD CONSTRAINT "TelegramSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TelegramSession" ADD COLUMN "telegramIdentityId" TEXT;
ALTER TABLE "TelegramSession" ADD CONSTRAINT "TelegramSession_telegramIdentityId_fkey"
  FOREIGN KEY ("telegramIdentityId") REFERENCES "TelegramIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
UPDATE "TelegramSession" s SET "telegramIdentityId" = i."id"
FROM "TelegramIdentity" i WHERE s."userId" = i."linkedUserId";
CREATE UNIQUE INDEX "TelegramSession_chatId_telegramIdentityId_key" ON "TelegramSession"("chatId", "telegramIdentityId");

ALTER TABLE "TelegramDraft" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "TelegramDraft" DROP CONSTRAINT "TelegramDraft_userId_fkey";
ALTER TABLE "TelegramDraft" ADD CONSTRAINT "TelegramDraft_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TelegramDraft" ADD COLUMN "telegramIdentityId" TEXT;
ALTER TABLE "TelegramDraft" ADD CONSTRAINT "TelegramDraft_telegramIdentityId_fkey"
  FOREIGN KEY ("telegramIdentityId") REFERENCES "TelegramIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE "TelegramDraft" d SET "telegramIdentityId" = i."id"
FROM "TelegramIdentity" i WHERE d."userId" = i."linkedUserId";
CREATE INDEX "TelegramDraft_telegramIdentityId_status_expiresAt_idx" ON "TelegramDraft"("telegramIdentityId", "status", "expiresAt");

ALTER TABLE "TelegramShiftReport" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "TelegramShiftReport" DROP CONSTRAINT "TelegramShiftReport_userId_fkey";
ALTER TABLE "TelegramShiftReport" ADD CONSTRAINT "TelegramShiftReport_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TelegramShiftReport" ADD COLUMN "telegramIdentityId" TEXT;
ALTER TABLE "TelegramShiftReport" ADD CONSTRAINT "TelegramShiftReport_telegramIdentityId_fkey"
  FOREIGN KEY ("telegramIdentityId") REFERENCES "TelegramIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE "TelegramShiftReport" r SET "telegramIdentityId" = i."id"
FROM "TelegramIdentity" i WHERE r."userId" = i."linkedUserId";
CREATE INDEX "TelegramShiftReport_telegramIdentityId_confirmedAt_idx" ON "TelegramShiftReport"("telegramIdentityId", "confirmedAt");

ALTER TABLE "InventoryMovement" ADD COLUMN "telegramIdentityId" TEXT;
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_telegramIdentityId_fkey"
  FOREIGN KEY ("telegramIdentityId") REFERENCES "TelegramIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE "InventoryMovement" m SET "telegramIdentityId" = r."telegramIdentityId"
FROM "TelegramInventoryPosting" p
JOIN "TelegramShiftReport" r ON r."id" = p."reportId"
WHERE p."movementId" = m."id" AND r."telegramIdentityId" IS NOT NULL;

ALTER TABLE "TelegramReportCorrection" ALTER COLUMN "requestedById" DROP NOT NULL;
ALTER TABLE "TelegramReportCorrection" DROP CONSTRAINT "TelegramReportCorrection_requestedById_fkey";
ALTER TABLE "TelegramReportCorrection" ADD CONSTRAINT "TelegramReportCorrection_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TelegramReportCorrection" ADD COLUMN "requestedByTelegramIdentityId" TEXT;
ALTER TABLE "TelegramReportCorrection" ADD COLUMN "approvedByTelegramIdentityId" TEXT;
ALTER TABLE "TelegramReportCorrection" ADD CONSTRAINT "TelegramReportCorrection_requestedByTelegramIdentityId_fkey"
  FOREIGN KEY ("requestedByTelegramIdentityId") REFERENCES "TelegramIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TelegramReportCorrection" ADD CONSTRAINT "TelegramReportCorrection_approvedByTelegramIdentityId_fkey"
  FOREIGN KEY ("approvedByTelegramIdentityId") REFERENCES "TelegramIdentity"("id") ON DELETE SET NULL ON UPDATE CASCADE;
UPDATE "TelegramReportCorrection" c SET "requestedByTelegramIdentityId" = i."id"
FROM "TelegramIdentity" i WHERE c."requestedById" = i."linkedUserId";
UPDATE "TelegramReportCorrection" c SET "approvedByTelegramIdentityId" = i."id"
FROM "TelegramIdentity" i WHERE c."approvedById" = i."linkedUserId";
UPDATE "InventoryMovement" m SET "telegramIdentityId" = c."approvedByTelegramIdentityId"
FROM "TelegramReportCorrection" c WHERE c."movementId" = m."id" AND c."approvedByTelegramIdentityId" IS NOT NULL;

