CREATE TABLE "users" (
	"id" varchar(50) PRIMARY KEY NOT NULL,
	"display_name" varchar(100) NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"is_agent" boolean DEFAULT false NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone,
	"archived_at" timestamp with time zone
);
