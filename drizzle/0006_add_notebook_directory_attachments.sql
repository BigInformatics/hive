CREATE TABLE IF NOT EXISTS "notebook_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(255) NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"created_by" varchar(50) NOT NULL,
	"tagged_users" jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"expires_at" timestamp with time zone,
	"review_at" timestamp with time zone,
	"locked" boolean DEFAULT false NOT NULL,
	"locked_by" varchar(50),
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "directory_entries" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"title" varchar(255) NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"created_by" varchar(50) NOT NULL,
	"tagged_users" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "content_project_tags" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"content_type" varchar(20) NOT NULL,
	"content_id" text NOT NULL,
	"tagged_by" varchar(50) NOT NULL,
	"tagged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" varchar(20) NOT NULL,
	"entity_id" text NOT NULL,
	"filename" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	"created_by" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_project_tags" DROP CONSTRAINT IF EXISTS "content_project_tags_project_id_swarm_projects_id_fk";
--> statement-breakpoint
ALTER TABLE "content_project_tags" ADD CONSTRAINT "content_project_tags_project_id_swarm_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."swarm_projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_notebook_created_at" ON "notebook_pages" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_directory_created_at" ON "directory_entries" USING btree ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_content_project_tags_project" ON "content_project_tags" USING btree ("project_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_content_project_tags_content" ON "content_project_tags" USING btree ("content_type","content_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_attachments_entity" ON "attachments" USING btree ("entity_type","entity_id");
