-- DropIndex
DROP INDEX "ActiveSession_embedKeyValue_lastSeenAt_idx";

-- AlterTable
ALTER TABLE "ActiveSession" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ActiveSession_embedKeyValue_deletedAt_idx" ON "ActiveSession"("embedKeyValue", "deletedAt");

-- CreateIndex
CREATE INDEX "ActiveSession_deletedAt_lastSeenAt_idx" ON "ActiveSession"("deletedAt", "lastSeenAt");
