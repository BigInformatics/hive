CREATE TABLE "broadcast_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"webhook_id" bigint NOT NULL,
	"app_name" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"for_users" varchar(255),
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_type" varchar(100),
	"body_text" text,
	"body_json" jsonb,
	"wake_delivered_at" timestamp with time zone,
	"notify_delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "broadcast_webhooks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"app_name" varchar(50) NOT NULL,
	"token" varchar(14) NOT NULL,
	"title" varchar(255) NOT NULL,
	"owner" varchar(50) NOT NULL,
	"for_users" varchar(255),
	"wake_agent" varchar(50),
	"notify_agent" varchar(50),
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_hit_at" timestamp with time zone,
	CONSTRAINT "broadcast_webhooks_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "chat_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"type" varchar(10) DEFAULT 'dm' NOT NULL,
	"name" varchar(100),
	"created_by" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_members" (
	"channel_id" text NOT NULL,
	"identity" varchar(50) NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"channel_id" text NOT NULL,
	"sender" varchar(50) NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "hive_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"created_by" varchar(50) NOT NULL,
	"identity_hint" varchar(50),
	"is_admin" boolean DEFAULT false NOT NULL,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"webhook_token" varchar(200),
	CONSTRAINT "invites_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "mailbox_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"recipient" varchar(50) NOT NULL,
	"sender" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"body" text,
	"status" varchar(10) DEFAULT 'unread' NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"viewed_at" timestamp with time zone,
	"thread_id" varchar(100),
	"reply_to_message_id" bigint,
	"dedupe_key" varchar(255),
	"metadata" jsonb,
	"response_waiting" boolean DEFAULT false NOT NULL,
	"waiting_responder" varchar(50),
	"waiting_since" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mailbox_tokens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"token" varchar(64) NOT NULL,
	"identity" varchar(50) NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"label" varchar(100),
	"created_by" varchar(50),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"webhook_url" varchar(500),
	"webhook_token" varchar(200),
	"backup_agent" varchar(50),
	"stale_trigger_hours" integer DEFAULT 4,
	CONSTRAINT "mailbox_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "recurring_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"title" text NOT NULL,
	"detail" text,
	"assignee_user_id" varchar(50),
	"creator_user_id" varchar(50) NOT NULL,
	"cron_expr" varchar(100) NOT NULL,
	"timezone" varchar(50) DEFAULT 'America/Chicago' NOT NULL,
	"initial_status" varchar(20) DEFAULT 'ready' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swarm_projects" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"website_url" text,
	"onedev_url" text,
	"github_url" text,
	"dokploy_deploy_url" text,
	"color" varchar(7) NOT NULL,
	"project_lead_user_id" varchar(50) NOT NULL,
	"developer_lead_user_id" varchar(50) NOT NULL,
	"work_hours_start" integer,
	"work_hours_end" integer,
	"work_hours_timezone" text DEFAULT 'America/Chicago',
	"blocking_mode" boolean DEFAULT false,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swarm_task_events" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"actor_user_id" varchar(50) NOT NULL,
	"kind" text NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "swarm_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text,
	"title" text NOT NULL,
	"detail" text,
	"creator_user_id" varchar(50) NOT NULL,
	"assignee_user_id" varchar(50),
	"status" varchar(20) DEFAULT 'queued' NOT NULL,
	"issue_url" text,
	"on_or_after_at" timestamp with time zone,
	"must_be_done_after_task_id" text,
	"sort_key" bigint,
	"next_task_id" text,
	"next_task_assignee_user_id" varchar(50),
	"recurring_template_id" text,
	"recurring_instance_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chat_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_channel_id_chat_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."chat_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_broadcast_events_app" ON "broadcast_events" USING btree ("app_name","received_at");--> statement-breakpoint
CREATE INDEX "idx_broadcast_webhooks_app_token" ON "broadcast_webhooks" USING btree ("app_name","token");--> statement-breakpoint
CREATE INDEX "idx_hive_events_created" ON "hive_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_mailbox_recipient_created" ON "mailbox_messages" USING btree ("recipient","created_at");--> statement-breakpoint
CREATE INDEX "idx_mailbox_waiting" ON "mailbox_messages" USING btree ("waiting_responder","created_at");--> statement-breakpoint
CREATE INDEX "idx_swarm_task_events_task" ON "swarm_task_events" USING btree ("task_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_swarm_tasks_status" ON "swarm_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_swarm_tasks_assignee" ON "swarm_tasks" USING btree ("assignee_user_id");--> statement-breakpoint
CREATE INDEX "idx_swarm_tasks_project" ON "swarm_tasks" USING btree ("project_id");