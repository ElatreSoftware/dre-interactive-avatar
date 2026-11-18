-- CreateTable
CREATE TABLE "EmbedKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "avatarId" TEXT NOT NULL,
    "allowedOrigins" TEXT[],
    "dynamicVariables" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmbedKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Footprint" (
    "id" SERIAL NOT NULL,
    "v" INTEGER NOT NULL DEFAULT 1,
    "eventId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "avatarSessionId" TEXT,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "clientTs" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "embedKeyValue" TEXT NOT NULL,
    "parentOrigin" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "userAgent" TEXT NOT NULL,

    CONSTRAINT "Footprint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmbedKey_key_key" ON "EmbedKey"("key");

-- CreateIndex
CREATE INDEX "EmbedKey_enabled_idx" ON "EmbedKey"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "Footprint_eventId_key" ON "Footprint"("eventId");

-- CreateIndex
CREATE INDEX "Footprint_receivedAt_idx" ON "Footprint"("receivedAt");

-- CreateIndex
CREATE INDEX "Footprint_sessionKey_seq_idx" ON "Footprint"("sessionKey", "seq");

-- CreateIndex
CREATE INDEX "Footprint_embedKeyValue_receivedAt_idx" ON "Footprint"("embedKeyValue", "receivedAt");

-- CreateIndex
CREATE INDEX "Footprint_type_idx" ON "Footprint"("type");

-- AddForeignKey
ALTER TABLE "Footprint" ADD CONSTRAINT "Footprint_embedKeyValue_fkey" FOREIGN KEY ("embedKeyValue") REFERENCES "EmbedKey"("key") ON DELETE SET NULL ON UPDATE CASCADE;
