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

-- ============================================================
-- SWARM: Task Management System
-- ============================================================

-- Status enum for tasks
DO $$ BEGIN
    CREATE TYPE swarm_task_status AS ENUM (
        'queued',
        'ready', 
        'in_progress',
        'holding',
        'review',
        'complete'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Projects table
CREATE TABLE IF NOT EXISTS public.swarm_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    onedev_url TEXT,
    dokploy_deploy_url TEXT,
    color CHAR(7) NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
    project_lead_user_id VARCHAR(50) NOT NULL,
    developer_lead_user_id VARCHAR(50) NOT NULL,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT valid_project_lead CHECK (project_lead_user_id ~ '^[a-z][a-z0-9_-]*$'),
    CONSTRAINT valid_developer_lead CHECK (developer_lead_user_id ~ '^[a-z][a-z0-9_-]*$')
);

CREATE INDEX IF NOT EXISTS idx_swarm_projects_archived 
    ON public.swarm_projects (archived_at);

-- Tasks table
CREATE TABLE IF NOT EXISTS public.swarm_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES public.swarm_projects(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    detail TEXT,
    creator_user_id VARCHAR(50) NOT NULL,
    assignee_user_id VARCHAR(50),
    status swarm_task_status NOT NULL DEFAULT 'queued',
    on_or_after_at TIMESTAMPTZ,
    must_be_done_after_task_id UUID REFERENCES public.swarm_tasks(id) ON DELETE SET NULL,
    sort_key BIGINT,
    next_task_id UUID REFERENCES public.swarm_tasks(id) ON DELETE SET NULL,
    next_task_assignee_user_id VARCHAR(50),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    
    -- Phase 2: Recurring task support (reserved fields)
    recurring_template_id UUID,
    recurring_instance_at TIMESTAMPTZ,
    
    CONSTRAINT valid_creator CHECK (creator_user_id ~ '^[a-z][a-z0-9_-]*$'),
    CONSTRAINT valid_assignee CHECK (assignee_user_id IS NULL OR assignee_user_id ~ '^[a-z][a-z0-9_-]*$'),
    CONSTRAINT valid_next_assignee CHECK (next_task_assignee_user_id IS NULL OR next_task_assignee_user_id ~ '^[a-z][a-z0-9_-]*$'),
    CONSTRAINT no_self_dependency CHECK (must_be_done_after_task_id != id)
);

CREATE INDEX IF NOT EXISTS idx_swarm_tasks_status 
    ON public.swarm_tasks (status);

CREATE INDEX IF NOT EXISTS idx_swarm_tasks_assignee 
    ON public.swarm_tasks (assignee_user_id);

CREATE INDEX IF NOT EXISTS idx_swarm_tasks_project 
    ON public.swarm_tasks (project_id);

CREATE INDEX IF NOT EXISTS idx_swarm_tasks_on_or_after 
    ON public.swarm_tasks (on_or_after_at);

CREATE INDEX IF NOT EXISTS idx_swarm_tasks_sort_key 
    ON public.swarm_tasks (sort_key);

-- Unique index for recurring instances (Phase 2)
CREATE UNIQUE INDEX IF NOT EXISTS uq_swarm_tasks_recurring_instance 
    ON public.swarm_tasks (recurring_template_id, recurring_instance_at)
    WHERE recurring_template_id IS NOT NULL;

-- Task events (audit trail)
CREATE TABLE IF NOT EXISTS public.swarm_task_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.swarm_tasks(id) ON DELETE CASCADE,
    actor_user_id VARCHAR(50) NOT NULL,
    kind TEXT NOT NULL,
    before_state JSONB,
    after_state JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    CONSTRAINT valid_actor CHECK (actor_user_id ~ '^[a-z][a-z0-9_-]*$')
);

CREATE INDEX IF NOT EXISTS idx_swarm_task_events_task 
    ON public.swarm_task_events (task_id, created_at DESC);

COMMENT ON TABLE public.swarm_projects IS 'Swarm projects for organizing tasks';
COMMENT ON TABLE public.swarm_tasks IS 'Swarm tasks with dependencies and scheduling';
COMMENT ON TABLE public.swarm_task_events IS 'Audit trail for task changes';

-- ============================================================
-- HIVE EVENT LOG (for SSE resume + wagl integration)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.hive_events (
    id BIGSERIAL PRIMARY KEY,
    type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hive_events_created
    ON public.hive_events (created_at DESC);
