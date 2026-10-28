ALTER TABLE "BalanceAdjustment" DROP CONSTRAINT "BalanceAdjustment_createdById_fkey";
ALTER TABLE "BalanceAdjustment" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "BalanceAdjustment"
  ADD CONSTRAINT "BalanceAdjustment_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;