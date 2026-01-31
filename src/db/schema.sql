-- Mailbox API schema (single table approach)

CREATE TABLE IF NOT EXISTS public.mailbox_messages (
    id BIGSERIAL PRIMARY KEY,
    recipient VARCHAR(50) NOT NULL,
    sender VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    body TEXT,
    status VARCHAR(10) NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read')),
    urgent BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    viewed_at TIMESTAMPTZ,
    thread_id VARCHAR(100),
    reply_to_message_id BIGINT REFERENCES public.mailbox_messages(id) ON DELETE SET NULL,
    dedupe_key VARCHAR(255),
    metadata JSONB,
    
    CONSTRAINT valid_recipient CHECK (recipient ~ '^[a-z][a-z0-9_-]*$'),
    CONSTRAINT valid_sender CHECK (sender ~ '^[a-z][a-z0-9_-]*$'),
    CONSTRAINT dedupe_key_nonempty CHECK (dedupe_key IS NULL OR length(dedupe_key) > 0)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mailbox_unread_poll 
    ON public.mailbox_messages (recipient, urgent DESC, created_at ASC)
    WHERE status = 'unread';

CREATE INDEX IF NOT EXISTS idx_mailbox_recipient_created 
    ON public.mailbox_messages (recipient, created_at DESC);

-- UNIQUE constraint for idempotent sends
CREATE UNIQUE INDEX IF NOT EXISTS uq_mailbox_dedupe 
    ON public.mailbox_messages (sender, recipient, dedupe_key)
    WHERE dedupe_key IS NOT NULL;

-- Full-text search
CREATE INDEX IF NOT EXISTS idx_mailbox_fts 
    ON public.mailbox_messages 
    USING gin(to_tsvector('english', coalesce(title, '') || ' ' || coalesce(body, '')));

COMMENT ON TABLE public.mailbox_messages IS 'Unified team mailbox for agent-to-agent communication';

-- Response waiting tracking (for task promises)
ALTER TABLE public.mailbox_messages 
ADD COLUMN IF NOT EXISTS response_waiting BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.mailbox_messages 
ADD COLUMN IF NOT EXISTS waiting_responder VARCHAR(50);

ALTER TABLE public.mailbox_messages 
ADD COLUMN IF NOT EXISTS waiting_since TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_mailbox_waiting 
    ON public.mailbox_messages (waiting_responder, created_at DESC)
    WHERE response_waiting = true;

-- ============================================================
-- BROADCAST WEBHOOKS (new channel for external notifications)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.broadcast_webhooks (
    id BIGSERIAL PRIMARY KEY,
    app_name VARCHAR(50) NOT NULL,
    token CHAR(14) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    owner VARCHAR(50) NOT NULL,
    for_users VARCHAR(255),
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_hit_at TIMESTAMPTZ,
    
    CONSTRAINT valid_app_name CHECK (app_name ~ '^[a-z][a-z0-9_-]*$'),
    CONSTRAINT valid_owner CHECK (owner ~ '^[a-z][a-z0-9_-]*$')
);

CREATE INDEX IF NOT EXISTS idx_broadcast_webhooks_app_token 
    ON public.broadcast_webhooks (app_name, token);

CREATE TABLE IF NOT EXISTS public.broadcast_events (
    id BIGSERIAL PRIMARY KEY,
    webhook_id BIGINT NOT NULL REFERENCES public.broadcast_webhooks(id) ON DELETE CASCADE,
    app_name VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    for_users VARCHAR(255),
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    content_type VARCHAR(100),
    body_text TEXT,
    body_json JSONB
);

CREATE INDEX IF NOT EXISTS idx_broadcast_events_webhook 
    ON public.broadcast_events (webhook_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_broadcast_events_app 
    ON public.broadcast_events (app_name, received_at DESC);

COMMENT ON TABLE public.broadcast_webhooks IS 'Webhook configurations for broadcast channel';
COMMENT ON TABLE public.broadcast_events IS 'Received webhook events for broadcast channel';
