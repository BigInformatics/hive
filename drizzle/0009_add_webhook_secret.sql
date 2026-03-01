-- Add secret and requireSecret columns to broadcast_webhooks for optional webhook authentication
ALTER TABLE broadcast_webhooks ADD COLUMN IF NOT EXISTS secret varchar(64);
ALTER TABLE broadcast_webhooks ADD COLUMN IF NOT EXISTS require_secret boolean NOT NULL DEFAULT false;

-- Index for faster lookups when validating secrets (optional, but useful for high traffic)
CREATE INDEX IF NOT EXISTS idx_broadcast_webhooks_secret ON broadcast_webhooks(secret) WHERE secret IS NOT NULL;
