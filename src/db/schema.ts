import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
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

export const eventStatusValues = [
  "draft",
  "active",
  "closed",
  "cancelled",
] as const;
export const eventVisibilityValues = ["private", "public"] as const;
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
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export const importJobModeValues = ["validate", "dry_run", "write"] as const;
export const importJobInitiatorKindValues = [
  "operator",
  "system",
  "legacy",
] as const;
export const auditActorKindValues = ["operator", "system", "legacy"] as const;
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

export const operatorSuspensionReasonMaxLength = 500;

export const eventStatusEnum = pgEnum("event_status", eventStatusValues);
export const eventVisibilityEnum = pgEnum(
  "event_visibility",
  eventVisibilityValues,
);
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
export const importJobModeEnum = pgEnum("import_job_mode", importJobModeValues);
export const importJobInitiatorKindEnum = pgEnum(
  "import_job_initiator_kind",
  importJobInitiatorKindValues,
);
export const auditActorKindEnum = pgEnum(
  "audit_actor_kind",
  auditActorKindValues,
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
    publicId: uuid("public_id").notNull().defaultRandom(),
    workspaceId: bigint("workspace_id", { mode: "number" })
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    slug: text("slug"),
    venue: text("venue"),
    city: text("city"),
    sessionCode: text("session_code")
      .notNull()
      .default(
        sql`lpad((mod((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint), 100000000))::text, 8, '0')`,
      ),
    startsAt: timestampColumn("starts_at").notNull(),
    facebookUrl: text("facebook_url"),
    status: eventStatusEnum("status").notNull().default("draft"),
    visibility: eventVisibilityEnum("visibility").notNull().default("private"),
    publishedAt: timestampColumn("published_at"),
    isActivePublicEvent: boolean("is_active_public_event")
      .notNull()
      .default(false),
    publicQueueEnabled: boolean("public_queue_enabled")
      .notNull()
      .default(false),
    songRequestsEnabled: boolean("song_requests_enabled")
      .notNull()
      .default(false),
    publicShowSongTitles: boolean("public_show_song_titles")
      .notNull()
      .default(false),
    autoCloseAt: timestampColumn("auto_close_at"),
    endsAt: timestampColumn("ends_at").notNull(),
    closedAt: timestampColumn("closed_at"),
    closeReason: text("close_reason"),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
    updatedAt: timestampColumn("updated_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("events_one_active_public_per_workspace_idx")
      .on(table.workspaceId)
      .where(sql`${table.isActivePublicEvent} = true`),
    uniqueIndex("events_slug_idx")
      .on(table.slug)
      .where(sql`${table.slug} is not null`),
    uniqueIndex("events_session_code_idx").on(table.sessionCode),
    uniqueIndex("events_public_id_idx").on(table.publicId),
    index("events_public_catalog_idx")
      .on(table.visibility, table.publishedAt, table.status, table.startsAt)
      .where(
        sql`${table.visibility} = 'public' and ${table.publishedAt} is not null and ${table.slug} is not null`,
      ),
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
    check(
      "events_slug_format_check",
      sql`${table.slug} is null or (char_length(${table.slug}) between 3 and 80 and ${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`,
    ),
    check(
      "events_public_requires_slug_and_published_at_check",
      sql`${table.visibility} <> 'public' or (${table.slug} is not null and ${table.publishedAt} is not null)`,
    ),
    check(
      "events_ends_after_starts_check",
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
    check(
      "events_session_code_format_check",
      sql`${table.sessionCode} ~ '^[0-9]{8}$'`,
    ),
    check(
      "events_close_reason_check",
      sql`(${table.closedAt} is null and ${table.closeReason} is null)
        or (${table.closedAt} is not null and ${table.closeReason} in ('manual', 'scheduled', 'automatic'))`,
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
    displayName: text("display_name"),
    profileCompletedAt: timestampColumn("profile_completed_at"),
    authUserId: uuid("auth_user_id").references(() => authUsers.id, {
      onDelete: "set null",
    }),
    passwordHash: text("password_hash").notNull(),
    active: boolean("active").notNull().default(true),
    suspendedAt: timestampColumn("suspended_at"),
    suspensionReason: text("suspension_reason"),
    suspendedByOperatorId: bigint("suspended_by_operator_id", {
      mode: "number",
    }),
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
    foreignKey({
      name: "operator_users_suspended_by_operator_id_operator_users_id_fk",
      columns: [table.suspendedByOperatorId],
      foreignColumns: [table.id],
    }).onDelete("restrict"),
    check(
      "operator_users_suspension_state_check",
      sql`(
        (${table.suspendedAt} is null and ${table.suspensionReason} is null and ${table.suspendedByOperatorId} is null)
        or
        (
          ${table.suspendedAt} is not null
          and ${table.suspensionReason} is not null
          and char_length(${table.suspensionReason}) between 1 and ${sql.raw(String(operatorSuspensionReasonMaxLength))}
          and ${table.suspensionReason} = btrim(${table.suspensionReason})
          and ${table.suspendedByOperatorId} is not null
        )
      )`,
    ),
  ],
).enableRLS();

export const eventSessions = pgTable(
  "event_sessions",
  {
    id: idColumn(),
    eventId: bigint("event_id", { mode: "number" })
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    publicToken: text("public_token").notNull(),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("event_sessions_event_id_idx").on(table.eventId),
    uniqueIndex("event_sessions_public_token_idx").on(table.publicToken),
    check(
      "event_sessions_public_token_format_check",
      sql`${table.publicToken} ~ '^[A-Za-z0-9_-]{22}$'`,
    ),
  ],
).enableRLS();

export const eventSessionCodes = pgTable(
  "event_session_codes",
  {
    id: idColumn(),
    sessionId: bigint("session_id", { mode: "number" })
      .notNull()
      .references(() => eventSessions.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    validFrom: timestampColumn("valid_from").notNull().defaultNow(),
    validUntil: timestampColumn("valid_until"),
    revokedAt: timestampColumn("revoked_at"),
    releaseAfter: timestampColumn("release_after"),
    createdByOperatorId: bigint("created_by_operator_id", { mode: "number" })
      .references(() => operatorUsers.id, { onDelete: "set null" }),
    revokedByOperatorId: bigint("revoked_by_operator_id", { mode: "number" })
      .references(() => operatorUsers.id, { onDelete: "set null" }),
    rotationReason: text("rotation_reason").notNull(),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("event_session_codes_code_idx").on(table.code),
    uniqueIndex("event_session_codes_current_session_idx")
      .on(table.sessionId)
      .where(sql`${table.validUntil} is null and ${table.revokedAt} is null`),
    index("event_session_codes_session_created_at_idx").on(
      table.sessionId,
      table.createdAt.desc(),
    ),
    index("event_session_codes_release_after_idx")
      .on(table.releaseAfter)
      .where(sql`${table.releaseAfter} is not null`),
    check(
      "event_session_codes_code_format_check",
      sql`${table.code} ~ '^[0-9]{8}$'`,
    ),
    check(
      "event_session_codes_chronology_check",
      sql`(${table.revokedAt} is null and ${table.validUntil} is null)
        or (${table.revokedAt} is not null and ${table.validUntil} = ${table.revokedAt} and ${table.revokedAt} >= ${table.validFrom})`,
    ),
    check(
      "event_session_codes_revocation_check",
      sql`(${table.revokedAt} is null and ${table.validUntil} is null and ${table.releaseAfter} is null and ${table.revokedByOperatorId} is null)
        or (${table.revokedAt} is not null and ${table.validUntil} is not null and ${table.releaseAfter} is not null and ${table.releaseAfter} >= ${table.revokedAt} + interval '365 days')`,
    ),
    check(
      "event_session_codes_rotation_reason_check",
      sql`${table.rotationReason} in ('migration', 'initial', 'operator_rotation')`,
    ),
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
    actorKind: auditActorKindEnum("actor_kind").notNull(),
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
    check(
      "operator_audit_log_actor_check",
      sql`(${table.actorKind} = 'operator')
        or (${table.actorKind} in ('system', 'legacy') and ${table.operatorId} is null)`,
    ),
  ],
).enableRLS();

export const importJobs = pgTable(
  "import_jobs",
  {
    id: idColumn(),
    source: importSourceEnum("source").notNull(),
    status: importJobStatusEnum("status").notNull(),
    mode: importJobModeEnum("mode").notNull(),
    initiatorKind: importJobInitiatorKindEnum("initiator_kind").notNull(),
    startedByOperatorId: bigint("started_by_operator_id", { mode: "number" }),
    totalCount: integer("total_rows").notNull().default(0),
    processedCount: integer("processed_count").notNull(),
    importedCount: integer("imported_count").notNull().default(0),
    skippedCount: integer("skipped_count").notNull().default(0),
    errorCount: integer("error_count"),
    safeErrorCode: text("safe_error_code"),
    safeErrorSummary: text("safe_error_summary"),
    createdAt: timestampColumn("created_at").notNull().defaultNow(),
    startedAt: timestampColumn("started_at"),
    terminalAt: timestampColumn("finished_at"),
    updatedAt: timestampColumn("updated_at").notNull(),
    cancellationRequestedAt: timestampColumn("cancellation_requested_at"),
    cancellationRequestedByOperatorId: bigint(
      "cancellation_requested_by_operator_id",
      { mode: "number" },
    ),
    sourceArtifactId: uuid("source_artifact_id"),
    artifactUploadedAt: timestampColumn("artifact_uploaded_at"),
    artifactDeletedAt: timestampColumn("artifact_deleted_at"),
    attemptCount: integer("attempt_count").notNull().default(0),
    claimToken: uuid("claim_token"),
    leaseExpiresAt: timestampColumn("lease_expires_at"),
    heartbeatAt: timestampColumn("heartbeat_at"),
  },
  (table) => [
    foreignKey({
      name: "import_jobs_started_by_operator_fk",
      columns: [table.startedByOperatorId],
      foreignColumns: [operatorUsers.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "import_jobs_cancel_requested_by_operator_fk",
      columns: [table.cancellationRequestedByOperatorId],
      foreignColumns: [operatorUsers.id],
    }).onDelete("set null"),
    index("import_jobs_source_status_created_at_idx").on(
      table.source,
      table.status,
      table.createdAt.desc(),
    ),
    index("import_jobs_started_by_operator_idx").on(
      table.startedByOperatorId,
    ),
    index("import_jobs_cancellation_requested_by_operator_idx").on(
      table.cancellationRequestedByOperatorId,
    ),
    index("import_jobs_terminal_at_idx")
      .on(table.terminalAt)
      .where(
        sql`${table.status} in ('succeeded', 'failed', 'cancelled') and ${table.terminalAt} is not null`,
      ),
    index("import_jobs_artifact_uploaded_at_idx")
      .on(table.artifactUploadedAt)
      .where(
        sql`${table.sourceArtifactId} is not null and ${table.artifactDeletedAt} is null`,
      ),
    uniqueIndex("import_jobs_one_active_per_source_idx")
      .on(table.source)
      .where(sql`${table.status} in ('queued', 'running')`),
    index("import_jobs_queued_claim_idx")
      .on(table.createdAt, table.id)
      .where(sql`${table.status} = 'queued'`),
    index("import_jobs_recovery_idx")
      .on(table.leaseExpiresAt, table.id)
      .where(sql`${table.status} = 'running'`),
    uniqueIndex("import_jobs_claim_token_idx")
      .on(table.claimToken)
      .where(sql`${table.claimToken} is not null`),
    check(
      "import_jobs_counts_check",
      sql`${table.totalCount} >= 0 and ${table.importedCount} >= 0 and ${table.skippedCount} >= 0`,
    ),
    check(
      "import_jobs_progress_check",
      sql`${table.processedCount} >= 0
        and (${table.errorCount} is null or ${table.errorCount} >= 0)
        and (
          ${table.errorCount} is not null
          or (${table.initiatorKind} = 'legacy' and ${table.status} = 'failed')
        )
        and ${table.processedCount} = ${table.importedCount} + ${table.skippedCount} + coalesce(${table.errorCount}, 0)
        and (${table.totalCount} = 0 or ${table.processedCount} <= ${table.totalCount})
        and (${table.status} <> 'succeeded' or ${table.totalCount} = ${table.processedCount})`,
    ),
    check(
      "import_jobs_safe_error_check",
      sql`(
          ${table.status} = 'failed'
          and ${table.safeErrorCode} is not null
          and char_length(${table.safeErrorCode}) between 1 and 100
          and ${table.safeErrorCode} = btrim(${table.safeErrorCode})
          and ${table.safeErrorCode} ~ '^[A-Z0-9][A-Z0-9_.-]*$'
          and ${table.safeErrorSummary} is not null
          and char_length(${table.safeErrorSummary}) between 1 and 500
          and ${table.safeErrorSummary} = btrim(${table.safeErrorSummary})
        ) or (
          ${table.status} <> 'failed'
          and ${table.safeErrorCode} is null
          and ${table.safeErrorSummary} is null
        )`,
    ),
    check(
      "import_jobs_lifecycle_check",
      sql`(
          ${table.status} = 'queued'
          and ${table.startedAt} is null
          and ${table.terminalAt} is null
        ) or (
          ${table.status} = 'running'
          and ${table.startedAt} is not null
          and ${table.terminalAt} is null
        ) or (
          ${table.status} in ('succeeded', 'failed')
          and ${table.startedAt} is not null
          and ${table.terminalAt} is not null
        ) or (
          ${table.status} = 'cancelled'
          and ${table.terminalAt} is not null
        )`,
    ),
    check(
      "import_jobs_initiator_check",
      sql`(
          ${table.initiatorKind} = 'operator'
          and ${table.startedByOperatorId} is not null
        ) or (
          ${table.initiatorKind} in ('system', 'legacy')
          and ${table.startedByOperatorId} is null
        )`,
    ),
    check(
      "import_jobs_timestamp_order_check",
      sql`(${table.startedAt} is null or ${table.startedAt} >= ${table.createdAt})
        and (
          ${table.terminalAt} is null
          or (
            ${table.terminalAt} >= ${table.createdAt}
            and (${table.startedAt} is null or ${table.terminalAt} >= ${table.startedAt})
          )
        )
        and ${table.updatedAt} >= ${table.createdAt}
        and (${table.startedAt} is null or ${table.updatedAt} >= ${table.startedAt})
        and (${table.terminalAt} is null or ${table.updatedAt} >= ${table.terminalAt})
        and (
          ${table.cancellationRequestedAt} is null
          or ${table.cancellationRequestedAt} >= ${table.createdAt}
        )`,
    ),
    check(
      "import_jobs_artifact_state_check",
      sql`(
          ${table.sourceArtifactId} is null
          and ${table.artifactUploadedAt} is null
          and ${table.artifactDeletedAt} is null
        ) or (
          ${table.sourceArtifactId} is not null
          and ${table.artifactUploadedAt} is not null
          and (
            ${table.artifactDeletedAt} is null
            or ${table.artifactDeletedAt} >= ${table.artifactUploadedAt}
          )
        )`,
    ),
    check(
      "import_jobs_cancellation_request_check",
      sql`${table.cancellationRequestedByOperatorId} is null or ${table.cancellationRequestedAt} is not null`,
    ),
    check(
      "import_jobs_worker_attempt_check",
      sql`${table.attemptCount} between 0 and 3`,
    ),
    check(
      "import_jobs_worker_claim_check",
      sql`(
          ${table.status} = 'queued'
          and ${table.attemptCount} = 0
          and ${table.claimToken} is null
          and ${table.leaseExpiresAt} is null
          and ${table.heartbeatAt} is null
        ) or (
          ${table.status} = 'running'
          and ${table.attemptCount} between 1 and 3
          and ${table.claimToken} is not null
          and ${table.leaseExpiresAt} is not null
          and ${table.heartbeatAt} is not null
        ) or (
          ${table.status} in ('succeeded', 'failed', 'cancelled')
          and ${table.claimToken} is null
          and ${table.leaseExpiresAt} is null
          and ${table.heartbeatAt} is null
        )`,
    ),
    check(
      "import_jobs_worker_lease_check",
      sql`(${table.heartbeatAt} is null or ${table.heartbeatAt} >= ${table.startedAt})
        and (${table.leaseExpiresAt} is null or ${table.leaseExpiresAt} >= ${table.heartbeatAt})`,
    ),
  ],
).enableRLS();

export const importJobDiagnostics = pgTable(
  "import_job_diagnostics",
  {
    id: idColumn(),
    importJobId: bigint("import_job_id", { mode: "number" })
      .notNull()
      .references(() => importJobs.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    safeSummary: text("safe_summary").notNull(),
    recordedAt: timestampColumn("recorded_at").notNull().defaultNow(),
  },
  (table) => [
    index("import_job_diagnostics_job_recorded_at_idx").on(
      table.importJobId,
      table.recordedAt.desc(),
    ),
    index("import_job_diagnostics_recorded_at_idx").on(table.recordedAt),
    check(
      "import_job_diagnostics_code_check",
      sql`char_length(${table.code}) between 1 and 100
        and ${table.code} = btrim(${table.code})
        and ${table.code} ~ '^[A-Z0-9][A-Z0-9_.-]*$'`,
    ),
    check(
      "import_job_diagnostics_summary_check",
      sql`char_length(${table.safeSummary}) between 1 and 500
        and ${table.safeSummary} = btrim(${table.safeSummary})`,
    ),
  ],
).enableRLS();
