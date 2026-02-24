-- Migration: drop is_admin from mailbox_tokens
-- Admin status is now sourced exclusively from users.is_admin.
-- Apply manually: psql $DATABASE_URL -f drizzle/0004_drop_mailbox_tokens_is_admin.sql

ALTER TABLE mailbox_tokens DROP COLUMN IF EXISTS is_admin;
