-- Migration: project-level visibility for swarm (mirrors notebook page pattern)
-- null or '[]' = open to all; non-empty array = restricted to listed identities

ALTER TABLE swarm_projects ADD COLUMN IF NOT EXISTS tagged_users jsonb;

-- NOTE: GRANTs are applied at runtime (see src/lib/migrate.ts) to avoid failing
-- migrations on databases where the team_user role does not exist.
