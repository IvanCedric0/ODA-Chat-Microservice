-- DropIndex
DROP INDEX "topics_service_name_idx";

-- AlterTable
ALTER TABLE "topics" ADD COLUMN     "tenant_id" UUID NOT NULL;

-- AlterTable
ALTER TABLE "topic_participants" DROP CONSTRAINT "topic_participants_pkey",
DROP COLUMN "user_id",
ADD COLUMN     "user_id" UUID NOT NULL,
ADD CONSTRAINT "topic_participants_pkey" PRIMARY KEY ("topic_id", "user_id");

-- AlterTable
ALTER TABLE "messages" DROP COLUMN "sender_id",
ADD COLUMN     "sender_id" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "topics_tenant_id_service_name_idx" ON "topics"("tenant_id", "service_name");

-- CreateIndex
CREATE INDEX "topic_participants_user_id_idx" ON "topic_participants"("user_id");
