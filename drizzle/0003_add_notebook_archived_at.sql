-- Migration: soft delete for notebook pages
ALTER TABLE notebook_pages ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- GRANTs for Docker container user
GRANT ALL ON notebook_pages TO team_user;
