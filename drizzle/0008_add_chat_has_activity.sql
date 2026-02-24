-- Add has_activity flag to chat_members for efficient wake polling.
-- Set to true when a message is sent in the channel (for all members except sender).
-- Cleared when the member reads the channel (via API or UI auto-read).

ALTER TABLE chat_members ADD COLUMN IF NOT EXISTS has_activity BOOLEAN NOT NULL DEFAULT false;

-- Partial index: only index rows with activity, keeping the index tiny
CREATE INDEX IF NOT EXISTS idx_chat_members_activity
  ON chat_members(identity)
  WHERE has_activity = true;
