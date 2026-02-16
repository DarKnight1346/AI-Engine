-- AlterTable: Add enhanced scheduling fields to scheduled_tasks
ALTER TABLE "scheduled_tasks" ADD COLUMN "user_prompt" TEXT;
ALTER TABLE "scheduled_tasks" ADD COLUMN "interval_ms" BIGINT;
ALTER TABLE "scheduled_tasks" ADD COLUMN "run_at" TIMESTAMP(3);
ALTER TABLE "scheduled_tasks" ADD COLUMN "end_at" TIMESTAMP(3);
ALTER TABLE "scheduled_tasks" ADD COLUMN "max_runs" INTEGER;
ALTER TABLE "scheduled_tasks" ADD COLUMN "total_runs" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "scheduled_tasks" ADD COLUMN "conversation_history" JSONB NOT NULL DEFAULT '[]';
