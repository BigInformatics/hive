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
