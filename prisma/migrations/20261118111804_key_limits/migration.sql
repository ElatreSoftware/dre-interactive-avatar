-- AlterTable
ALTER TABLE "EmbedKey" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "maxConcurrentSessions" INTEGER;

-- CreateTable
CREATE TABLE "ActiveSession" (
    "id" TEXT NOT NULL,
    "avatarSessionId" TEXT NOT NULL,
    "sessionKey" TEXT,
    "embedKeyValue" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActiveSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActiveSession_avatarSessionId_key" ON "ActiveSession"("avatarSessionId");

-- CreateIndex
CREATE INDEX "ActiveSession_embedKeyValue_lastSeenAt_idx" ON "ActiveSession"("embedKeyValue", "lastSeenAt");

-- CreateIndex
CREATE INDEX "ActiveSession_sessionKey_idx" ON "ActiveSession"("sessionKey");
