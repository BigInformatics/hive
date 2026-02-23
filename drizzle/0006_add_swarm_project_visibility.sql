-- Migration: project-level visibility for swarm (mirrors notebook page pattern)
-- null or '[]' = open to all; non-empty array = restricted to listed identities

ALTER TABLE swarm_projects ADD COLUMN IF NOT EXISTS tagged_users jsonb;

-- GRANTs for Docker container user
GRANT ALL ON swarm_projects TO team_user;
