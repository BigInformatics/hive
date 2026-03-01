-- Migration: Add workflows and swarm_task_workflows tables

CREATE TABLE IF NOT EXISTS workflows (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  document_url TEXT,
  document JSONB,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  tagged_users JSONB,
  expires_at TIMESTAMPTZ,
  review_at TIMESTAMPTZ,
  created_by VARCHAR(50) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS swarm_task_workflows (
  task_id TEXT NOT NULL REFERENCES swarm_tasks(id) ON DELETE CASCADE,
  workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  attached_by VARCHAR(50) NOT NULL,
  attached_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (task_id, workflow_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON workflows TO team_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON swarm_task_workflows TO team_user;
