-- Migration: notebook tags/dates, task-notebook links, swarm follow_up
-- Applied manually (db:push unsafe due to unmapped search_tsv column)

-- Notebook page metadata
ALTER TABLE notebook_pages ADD COLUMN IF NOT EXISTS tags jsonb DEFAULT '[]';
ALTER TABLE notebook_pages ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE notebook_pages ADD COLUMN IF NOT EXISTS review_at timestamptz;

-- Task ↔ Notebook page junction table
CREATE TABLE IF NOT EXISTS swarm_task_notebook_pages (
  task_id text NOT NULL REFERENCES swarm_tasks(id) ON DELETE CASCADE,
  notebook_page_id uuid NOT NULL REFERENCES notebook_pages(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (task_id, notebook_page_id)
);

-- Swarm task follow_up field
ALTER TABLE swarm_tasks ADD COLUMN IF NOT EXISTS follow_up text;

-- GRANTs for Docker container user
GRANT ALL ON swarm_task_notebook_pages TO team_user;
