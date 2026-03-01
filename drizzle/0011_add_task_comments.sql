-- Add comments to swarm tasks
CREATE TABLE IF NOT EXISTS swarm_task_comments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  task_id TEXT NOT NULL REFERENCES swarm_tasks(id) ON DELETE CASCADE,
  user_id VARCHAR(50) NOT NULL,
  body TEXT NOT NULL,
  sentiment VARCHAR(10) NULL CHECK (sentiment IN ('wait', 'proceed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_swarm_task_comments_task_id ON swarm_task_comments(task_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON swarm_task_comments TO team_user;

-- Add PR reviewer field to swarm projects
ALTER TABLE swarm_projects ADD COLUMN IF NOT EXISTS pr_reviewer_user_id VARCHAR(50);
