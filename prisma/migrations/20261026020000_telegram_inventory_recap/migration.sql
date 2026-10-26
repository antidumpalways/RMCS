-- Inventory deductions from confirmed aggregate Telegram reports are auditable and independent of SaleTransaction.
ALTER TABLE "Product" ADD COLUMN "sku" TEXT;
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE TABLE IF NOT EXISTS "TelegramInventoryPosting" (
  "id" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "lineId" TEXT NOT NULL,
  "productId" INTEGER NOT NULL,
  "sourceText" TEXT NOT NULL,
  "productLabel" TEXT NOT NULL,
  "reportedQty" INTEGER NOT NULL,
  "webAppQty" INTEGER NOT NULL DEFAULT 0,
  "coverage" TEXT NOT NULL DEFAULT 'UNRECORDED_ONLY',
  "appliedQty" INTEGER NOT NULL,
  "movementId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TelegramInventoryPosting_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TelegramInventoryPosting_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TelegramShiftReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TelegramInventoryPosting_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TelegramInventoryPosting_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "InventoryMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "TelegramInventoryPosting_operationKey_key" ON "TelegramInventoryPosting"("operationKey");
CREATE UNIQUE INDEX IF NOT EXISTS "TelegramInventoryPosting_movementId_key" ON "TelegramInventoryPosting"("movementId");
CREATE UNIQUE INDEX IF NOT EXISTS "TelegramInventoryPosting_reportId_lineId_key" ON "TelegramInventoryPosting"("reportId", "lineId");
CREATE INDEX IF NOT EXISTS "TelegramInventoryPosting_productId_createdAt_idx" ON "TelegramInventoryPosting"("productId", "createdAt");

CREATE TABLE IF NOT EXISTS "TelegramReportCorrection" (
  "id" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "postingId" TEXT NOT NULL,
  "requestedById" INTEGER NOT NULL,
  "approvedById" INTEGER,
  "reason" TEXT NOT NULL,
  "previousQty" INTEGER NOT NULL,
  "requestedQty" INTEGER NOT NULL,
  "deltaQty" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "movementId" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedAt" TIMESTAMP(3),
  CONSTRAINT "TelegramReportCorrection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TelegramReportCorrection_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TelegramShiftReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TelegramReportCorrection_postingId_fkey" FOREIGN KEY ("postingId") REFERENCES "TelegramInventoryPosting"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TelegramReportCorrection_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "TelegramReportCorrection_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "TelegramReportCorrection_movementId_fkey" FOREIGN KEY ("movementId") REFERENCES "InventoryMovement"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "TelegramReportCorrection_operationKey_key" ON "TelegramReportCorrection"("operationKey");
CREATE UNIQUE INDEX IF NOT EXISTS "TelegramReportCorrection_movementId_key" ON "TelegramReportCorrection"("movementId");
CREATE INDEX IF NOT EXISTS "TelegramReportCorrection_reportId_createdAt_idx" ON "TelegramReportCorrection"("reportId", "createdAt");
CREATE INDEX IF NOT EXISTS "TelegramReportCorrection_status_createdAt_idx" ON "TelegramReportCorrection"("status", "createdAt");
