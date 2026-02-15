-- Add role column to project_agents
ALTER TABLE "project_agents" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'general';
