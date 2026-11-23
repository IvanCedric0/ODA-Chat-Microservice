-- DropIndex
DROP INDEX "messages_topic_id_created_at_idx";
-- CreateIndex
CREATE INDEX "messages_topic_id_id_idx" ON "messages"("topic_id", "id" DESC);
