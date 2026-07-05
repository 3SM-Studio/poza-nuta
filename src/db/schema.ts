import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

export const eventStatusValues = ["draft", "active", "closed"] as const;
export const songSourceValues = ["ising", "karafun", "manual"] as const;
export const requestStatusValues = [
  "pending",
  "approved",
  "now",
  "done",
  "skipped",
  "rejected",
] as const;
export const requestSourceValues = ["public", "operator"] as const;
export const importSourceValues = ["ising", "karafun"] as const;
export const importJobStatusValues = [
  "pending",
  "running",
  "done",
  "failed",
] as const;
export const workspaceMemberRoleValues = [
  "owner",
  "manager",
  "operator",
  "viewer",
] as const;
export const platformMemberRoleValues = [
  "platform_owner",
  "platform_admin",
  "support",
] as const;

export const eventStatusEnum = pgEnum("event_status", eventStatusValues);
export const songSourceEnum = pgEnum("song_source", songSourceValues);
export const requestStatusEnum = pgEnum(
  "song_request_status",
  requestStatusValues,
);
export const requestSourceEnum = pgEnum(
  "song_request_source",
  requestSourceValues,
);
export const importSourceEnum = pgEnum("import_source", importSourceValues);
export const importJobStatusEnum = pgEnum(
  "import_job_status",
  importJobStatusValues,
);
export const workspaceMemberRoleEnum = pgEnum(
  "workspace_member_role",
  workspaceMemberRoleValues,
);
export const platformMemberRoleEnum = pgEnum(
  "platform_member_role",
  platformMemberRoleValues,
);

const idColumn = () =>
  bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity();

const timestampColumn = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const workspaces = pgTable(
  "workspaces",
  {
    id: idColumn(),
    publicId: text("public_id").notNull(),
    name: text("name").notNull(),
    handle: text("handle").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
    updatedAt: timestampColumn("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workspaces_public_id_idx").on(table.publicId),
    uniqueIndex("workspaces_handle_idx").on(table.handle),
    index("workspaces_active_idx")
      .on(table.active)
      .where(sql`${table.active} = true`),
    check(
      "workspaces_handle_format_check",
      sql`${table.handle} ~ '^[a-z0-9][a-z0-9-]*[a-z0-9]$'`,
    ),
    check(
      "workspaces_public_id_format_check",
      sql`${table.publicId} ~ '^[a-z0-9]{20}$'`,
    ),
  ],
).enableRLS();

export const events = pgTable(
  "events",
  {
    id: idColumn(),
    workspaceId: bigint("workspace_id", { mode: "number" })
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    venue: text("venue"),
    startsAt: timestampColumn("starts_at").notNull(),
    status: eventStatusEnum("status").notNull().default("draft"),
    isActivePublicEvent: boolean("is_active_public_event")
      .notNull()
      .default(false),
    publicQueueEnabled: boolean("public_queue_enabled")
      .notNull()
      .default(false),
    publicShowSongTitles: boolean("public_show_song_titles")
      .notNull()
      .default(false),
    autoCloseAt: timestampColumn("auto_close_at"),
    closedAt: timestampColumn("closed_at"),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
    updatedAt: timestampColumn("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("events_one_active_public_per_workspace_idx")
      .on(table.workspaceId)
      .where(sql`${table.isActivePublicEvent} = true`),
    index("events_workspace_status_starts_at_idx").on(
      table.workspaceId,
      table.status,
      table.startsAt.desc(),
    ),
    index("events_status_starts_at_idx").on(
      table.status,
      table.startsAt.desc(),
    ),
    check(
      "events_active_public_status_check",
      sql`not ${table.isActivePublicEvent} or ${table.status} = 'active'`,
    ),
  ],
).enableRLS();

export const songs = pgTable(
  "songs",
  {
    id: idColumn(),
    source: songSourceEnum("source").notNull(),
    sourceSongId: text("source_song_id"),
    title: text("title").notNull(),
    artist: text("artist").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    normalizedArtist: text("normalized_artist").notNull(),
    searchText: text("search_text").notNull(),
    durationSeconds: integer("duration_seconds"),
    genres: text("genres")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    languages: text("languages")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    isDuet: boolean("is_duet").notNull().default(false),
    isExplicit: boolean("is_explicit").notNull().default(false),
    isPlus: boolean("is_plus").notNull().default(false),
    isHit: boolean("is_hit").notNull().default(false),
    sourceUrl: text("source_url"),
    lastSeenAt: timestampColumn("last_seen_at"),
    lastCheckedAt: timestampColumn("last_checked_at"),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
    updatedAt: timestampColumn("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("songs_source_song_id_idx")
      .on(table.source, table.sourceSongId)
      .where(sql`${table.sourceSongId} is not null`),
    index("songs_search_text_trgm_idx").using(
      "gin",
      table.searchText.op("gin_trgm_ops"),
    ),
    index("songs_normalized_title_artist_idx").on(
      table.normalizedTitle,
      table.normalizedArtist,
    ),
    index("songs_normalized_artist_idx").on(table.normalizedArtist),
    check(
      "songs_duration_seconds_check",
      sql`${table.durationSeconds} is null or ${table.durationSeconds} >= 0`,
    ),
  ],
).enableRLS();

export const operatorUsers = pgTable(
  "operator_users",
  {
    id: idColumn(),
    name: text("name").notNull(),
    authUserId: uuid("auth_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    passwordHash: text("password_hash").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
    updatedAt: timestampColumn("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("operator_users_name_idx").on(sql`lower(${table.name})`),
    uniqueIndex("operator_users_auth_user_id_idx")
      .on(table.authUserId)
      .where(sql`${table.authUserId} is not null`),
    index("operator_users_active_idx")
      .on(table.active)
      .where(sql`${table.active} = true`),
  ],
).enableRLS();

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: idColumn(),
    workspaceId: bigint("workspace_id", { mode: "number" })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    operatorUserId: bigint("operator_user_id", { mode: "number" })
      .notNull()
      .references(() => operatorUsers.id, { onDelete: "cascade" }),
    role: workspaceMemberRoleEnum("role").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
    updatedAt: timestampColumn("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("workspace_members_workspace_operator_idx").on(
      table.workspaceId,
      table.operatorUserId,
    ),
    index("workspace_members_operator_idx").on(table.operatorUserId),
    index("workspace_members_workspace_role_idx").on(
      table.workspaceId,
      table.role,
    ),
    index("workspace_members_active_idx")
      .on(table.active)
      .where(sql`${table.active} = true`),
  ],
).enableRLS();

export const platformMembers = pgTable(
  "platform_members",
  {
    id: idColumn(),
    operatorUserId: bigint("operator_user_id", { mode: "number" })
      .notNull()
      .references(() => operatorUsers.id, { onDelete: "cascade" }),
    role: platformMemberRoleEnum("role").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
    updatedAt: timestampColumn("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_members_operator_idx").on(table.operatorUserId),
    index("platform_members_role_idx").on(table.role),
    index("platform_members_active_idx")
      .on(table.active)
      .where(sql`${table.active} = true`),
  ],
).enableRLS();

export const eventAccessLinks = pgTable(
  "event_access_links",
  {
    id: idColumn(),
    eventId: bigint("event_id", { mode: "number" })
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    label: text("label"),
    active: boolean("active").notNull().default(true),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
    revokedAt: timestampColumn("revoked_at"),
    lastUsedAt: timestampColumn("last_used_at"),
    useCount: integer("use_count").notNull().default(0),
    createdByOperatorId: bigint("created_by_operator_id", { mode: "number" })
      .references(() => operatorUsers.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("event_access_links_code_hash_idx").on(table.codeHash),
    index("event_access_links_event_created_at_idx").on(
      table.eventId,
      table.createdAt.desc(),
    ),
    index("event_access_links_created_by_operator_idx").on(
      table.createdByOperatorId,
    ),
    check(
      "event_access_links_use_count_check",
      sql`${table.useCount} >= 0`,
    ),
    check(
      "event_access_links_revoked_inactive_check",
      sql`${table.revokedAt} is null or not ${table.active}`,
    ),
  ],
).enableRLS();

export const songRequests = pgTable(
  "song_requests",
  {
    id: idColumn(),
    eventId: bigint("event_id", { mode: "number" })
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    songId: bigint("song_id", { mode: "number" })
      .notNull()
      .references(() => songs.id, { onDelete: "restrict" }),
    singerName: text("singer_name").notNull(),
    displayName: text("display_name").notNull(),
    note: text("note"),
    status: requestStatusEnum("status").notNull().default("pending"),
    position: integer("position").notNull(),
    requestedBy: requestSourceEnum("requested_by").notNull(),
    createdByOperatorId: bigint("created_by_operator_id", { mode: "number" })
      .references(() => operatorUsers.id, { onDelete: "set null" }),
    version: integer("version").notNull().default(1),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
    updatedAt: timestampColumn("updated_at").notNull().defaultNow(),
    startedAt: timestampColumn("started_at"),
    completedAt: timestampColumn("completed_at"),
  },
  (table) => [
    index("song_requests_event_queue_idx").on(
      table.eventId,
      table.status,
      table.position,
      table.id,
    ),
    index("song_requests_event_created_at_idx").on(
      table.eventId,
      table.createdAt.desc(),
    ),
    index("song_requests_song_id_idx").on(table.songId),
    index("song_requests_created_by_operator_idx").on(
      table.createdByOperatorId,
    ),
    check("song_requests_position_check", sql`${table.position} >= 0`),
    check("song_requests_version_check", sql`${table.version} > 0`),
  ],
).enableRLS();

export const operatorSessions = pgTable(
  "operator_sessions",
  {
    id: idColumn(),
    operatorId: bigint("operator_id", { mode: "number" })
      .notNull()
      .references(() => operatorUsers.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestampColumn("expires_at").notNull(),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("operator_sessions_token_hash_idx").on(table.tokenHash),
    index("operator_sessions_operator_expires_at_idx").on(
      table.operatorId,
      table.expiresAt,
    ),
    index("operator_sessions_expires_at_idx").on(table.expiresAt),
  ],
).enableRLS();

export type AuditPayload = Record<string, unknown>;

export const operatorAuditLog = pgTable(
  "operator_audit_log",
  {
    id: idColumn(),
    operatorId: bigint("operator_id", { mode: "number" }).references(
      () => operatorUsers.id,
      { onDelete: "set null" },
    ),
    eventId: bigint("event_id", { mode: "number" }).references(
      () => events.id,
      { onDelete: "set null" },
    ),
    action: text("action").notNull(),
    entityId: text("entity_id"),
    payload: jsonb("payload")
      .$type<AuditPayload>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("operator_audit_log_event_created_at_idx").on(
      table.eventId,
      table.createdAt.desc(),
    ),
    index("operator_audit_log_operator_created_at_idx").on(
      table.operatorId,
      table.createdAt.desc(),
    ),
    index("operator_audit_log_action_created_at_idx").on(
      table.action,
      table.createdAt.desc(),
    ),
  ],
).enableRLS();

export const importJobs = pgTable(
  "import_jobs",
  {
    id: idColumn(),
    source: importSourceEnum("source").notNull(),
    status: importJobStatusEnum("status").notNull().default("pending"),
    startedByOperatorId: bigint("started_by_operator_id", { mode: "number" })
      .references(() => operatorUsers.id, { onDelete: "set null" }),
    totalRows: integer("total_rows").notNull().default(0),
    importedCount: integer("imported_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    error: text("error"),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
    finishedAt: timestampColumn("finished_at"),
  },
  (table) => [
    index("import_jobs_source_status_created_at_idx").on(
      table.source,
      table.status,
      table.createdAt.desc(),
    ),
    index("import_jobs_started_by_operator_idx").on(
      table.startedByOperatorId,
    ),
    check(
      "import_jobs_counts_check",
      sql`${table.totalRows} >= 0 and ${table.importedCount} >= 0 and ${table.skippedCount} >= 0`,
    ),
  ],
).enableRLS();
