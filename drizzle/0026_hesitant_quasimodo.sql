CREATE TYPE "public"."catalog_collection_mode" AS ENUM('manual', 'rule', 'ranking');--> statement-breakpoint
CREATE TYPE "public"."catalog_collection_section" AS ENUM('top', 'playlist', 'style');--> statement-breakpoint
CREATE TYPE "public"."catalog_collection_type" AS ENUM('playlist', 'style');--> statement-breakpoint
CREATE TABLE "catalog_collection_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "catalog_collection_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"collection_id" bigint NOT NULL,
	"song_id" bigint NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_collection_items_position_check" CHECK ("catalog_collection_items"."position" >= 0)
);
--> statement-breakpoint
ALTER TABLE "catalog_collection_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "catalog_collections" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "catalog_collections_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"public_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"filter_key" text NOT NULL,
	"type" "catalog_collection_type" NOT NULL,
	"section" "catalog_collection_section" NOT NULL,
	"mode" "catalog_collection_mode" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"cover_image" text,
	"active" boolean DEFAULT true NOT NULL,
	"position" integer NOT NULL,
	"rule_config" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_collections_filter_key_format_check" CHECK (("catalog_collections"."type" = 'playlist' and "catalog_collections"."filter_key" ~ '^pl_[a-z0-9]+(-[a-z0-9]+)*$')
        or ("catalog_collections"."type" = 'style' and "catalog_collections"."filter_key" ~ '^st_[a-z0-9]+(-[a-z0-9]+)*$')),
	CONSTRAINT "catalog_collections_section_type_mode_check" CHECK (("catalog_collections"."section" = 'top' and "catalog_collections"."type" = 'playlist' and "catalog_collections"."mode" in ('manual', 'ranking'))
        or ("catalog_collections"."section" = 'playlist' and "catalog_collections"."type" = 'playlist' and "catalog_collections"."mode" = 'manual')
        or ("catalog_collections"."section" = 'style' and "catalog_collections"."type" = 'style' and "catalog_collections"."mode" = 'rule')),
	CONSTRAINT "catalog_collections_position_check" CHECK ("catalog_collections"."position" >= 0),
	CONSTRAINT "catalog_collections_rule_config_check" CHECK (("catalog_collections"."mode" = 'manual' and "catalog_collections"."rule_config" is null)
        or ("catalog_collections"."mode" = 'rule'
          and "catalog_collections"."rule_config" is not null
          and jsonb_typeof("catalog_collections"."rule_config") = 'object'
          and jsonb_typeof("catalog_collections"."rule_config"->'genre') = 'string'
          and "catalog_collections"."rule_config" = jsonb_build_object('genre', "catalog_collections"."rule_config"->>'genre')
          and char_length(btrim("catalog_collections"."rule_config"->>'genre')) between 1 and 100
          and "catalog_collections"."rule_config"->>'genre' !~ '[[:cntrl:]]')
        or ("catalog_collections"."mode" = 'ranking' and "catalog_collections"."rule_config" is null))
);
--> statement-breakpoint
ALTER TABLE "catalog_collections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "catalog_collection_items" ADD CONSTRAINT "catalog_collection_items_collection_id_catalog_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."catalog_collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_collection_items" ADD CONSTRAINT "catalog_collection_items_song_id_songs_id_fk" FOREIGN KEY ("song_id") REFERENCES "public"."songs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_collection_items_collection_song_idx" ON "catalog_collection_items" USING btree ("collection_id","song_id");--> statement-breakpoint
CREATE INDEX "catalog_collection_items_collection_position_id_idx" ON "catalog_collection_items" USING btree ("collection_id","position","id");--> statement-breakpoint
CREATE INDEX "catalog_collection_items_song_id_idx" ON "catalog_collection_items" USING btree ("song_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_collections_public_id_idx" ON "catalog_collections" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_collections_filter_key_idx" ON "catalog_collections" USING btree ("filter_key");--> statement-breakpoint
CREATE INDEX "catalog_collections_active_section_position_idx" ON "catalog_collections" USING btree ("section","position","id") WHERE "catalog_collections"."active" = true;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "public"."catalog_collections", "public"."catalog_collection_items" FROM PUBLIC, "anon", "authenticated";--> statement-breakpoint
REVOKE ALL PRIVILEGES ON SEQUENCE "public"."catalog_collections_id_seq", "public"."catalog_collection_items_id_seq" FROM PUBLIC, "anon", "authenticated";--> statement-breakpoint
GRANT SELECT ON TABLE "public"."catalog_collections", "public"."catalog_collection_items" TO "postgres";
