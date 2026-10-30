CREATE TABLE "TelegramShiftRegister" (
  "chatId" BIGINT NOT NULL,
  "activeShiftId" TEXT,
  "recapIdentityId" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelegramShiftRegister_pkey" PRIMARY KEY ("chatId")
);