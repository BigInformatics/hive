-- Full-text search for chat_messages
-- search_tsv generated column + GIN index were added in commit 62ff00d
-- This file documents the migration for reference

-- The generated column approach (applied directly to DB):
-- ALTER TABLE chat_messages ADD COLUMN search_tsv tsvector
--   GENERATED ALWAYS AS (to_tsvector('english', COALESCE(body, ''))) STORED;
-- CREATE INDEX idx_chat_messages_search ON chat_messages USING GIN (search_tsv);
