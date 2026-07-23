import { randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

export type LocalSupabaseFixture = {
  email: string;
  password: string;
  organizationPublicId: string;
  eventPublicId: string;
  eventName: string;
  sessionCode: string;
  publicToken: string;
  requestDisplayName: string;
  readEventState(): Promise<{
    status: string;
    isActivePublicEvent: boolean;
    autoCloseAt: Date | null;
    closedAt: Date | null;
    sessionCode: string;
    publicToken: string;
    requestStatus: string;
  }>;
  cleanup(): Promise<void>;
};

export async function createLocalSupabaseFixture(): Promise<LocalSupabaseFixture> {
  const databaseUrl = requireEnvironment("LOCAL_E2E_DATABASE_URL");
  const supabaseUrl = requireEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  const secretKey = requireEnvironment("LOCAL_E2E_SUPABASE_SECRET_KEY");
  const sql = postgres(databaseUrl, { max: 1 });
  const admin = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const fixtureSuffix = randomUUID().replaceAll("-", "");
  const email = `operator-${fixtureSuffix}@example.test`;
  const password = `${randomBytes(24).toString("base64url")}Aa1!`;
  const organizationPublicId = fixtureSuffix.slice(0, 20);
  const workspaceHandle = `e2e-${fixtureSuffix.slice(0, 12)}`;
  const eventPublicId = randomUUID();
  const eventName = "E2E Public Session Identity";
  const sessionCode = createSessionCode();
  const publicToken = randomBytes(16).toString("base64url");
  const requestDisplayName = "E2E Queue Evidence";
  let authUserId: string | null = null;
  let workspaceId: number | null = null;
  let operatorId: number | null = null;
  let songId: number | null = null;

  try {
    const authResult = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (authResult.error || !authResult.data.user) {
      throw new Error("Local Supabase Auth user could not be created.");
    }

    authUserId = authResult.data.user.id;
    const now = new Date();
    const startsAt = new Date(now.getTime() - 60 * 60 * 1_000);
    const autoCloseAt = new Date(now.getTime() + 2 * 60 * 60 * 1_000);

    await sql.begin(async (transaction) => {
      const [operator] = await transaction<{ id: number }[]>`
        INSERT INTO public.operator_users (
          name,
          display_name,
          profile_completed_at,
          auth_user_id,
          password_hash,
          active
        )
        VALUES (
          ${`E2E Operator ${fixtureSuffix.slice(0, 8)}`},
          ${"E2E Operator"},
          now(),
          ${authUserId}::uuid,
          ${"supabase-auth-managed"},
          true
        )
        RETURNING id
      `;
      const [workspace] = await transaction<{ id: number }[]>`
        INSERT INTO public.workspaces (public_id, name, handle, active)
        VALUES (
          ${organizationPublicId},
          ${"E2E Organization"},
          ${workspaceHandle},
          true
        )
        RETURNING id
      `;

      if (!operator || !workspace) {
        throw new Error("Local operator or organization fixture was not created.");
      }

      operatorId = operator.id;
      workspaceId = workspace.id;

      await transaction`
        INSERT INTO public.workspace_members (
          workspace_id,
          operator_user_id,
          role,
          active
        )
        VALUES (${workspace.id}, ${operator.id}, 'owner', true)
      `;

      const [event] = await transaction<{ id: number }[]>`
        INSERT INTO public.events (
          public_id,
          workspace_id,
          name,
          slug,
          venue,
          city,
          session_code,
          starts_at,
          status,
          visibility,
          published_at,
          is_active_public_event,
          public_queue_enabled,
          song_requests_enabled,
          public_show_song_titles,
          auto_close_at,
          ends_at
        )
        VALUES (
          ${eventPublicId}::uuid,
          ${workspace.id},
          ${eventName},
          ${`e2e-public-session-${fixtureSuffix.slice(0, 8)}`},
          ${"E2E Venue"},
          ${"Warszawa"},
          ${sessionCode},
          ${startsAt},
          'active',
          'public',
          now(),
          true,
          true,
          true,
          true,
          ${autoCloseAt},
          ${autoCloseAt}
        )
        RETURNING id
      `;

      if (!event) {
        throw new Error("Local event fixture was not created.");
      }

      const [session] = await transaction<{ id: number }[]>`
        INSERT INTO public.event_sessions (event_id, public_token)
        VALUES (${event.id}, ${publicToken})
        RETURNING id
      `;

      if (!session) {
        throw new Error("Local event session fixture was not created.");
      }

      await transaction`
        INSERT INTO public.event_session_codes (
          session_id,
          code,
          created_by_operator_id,
          rotation_reason
        )
        VALUES (${session.id}, ${sessionCode}, ${operator.id}, 'initial')
      `;

      const [song] = await transaction<{ id: number }[]>`
        INSERT INTO public.songs (
          source,
          source_song_id,
          title,
          artist,
          normalized_title,
          normalized_artist,
          search_text
        )
        VALUES (
          'manual',
          ${`e2e-${fixtureSuffix}`},
          ${"E2E Song"},
          ${"E2E Artist"},
          ${"e2e song"},
          ${"e2e artist"},
          ${"e2e song e2e artist"}
        )
        RETURNING id
      `;

      if (!song) {
        throw new Error("Local song fixture was not created.");
      }

      songId = song.id;

      await transaction`
        INSERT INTO public.song_requests (
          event_id,
          song_id,
          singer_name,
          display_name,
          status,
          position,
          requested_by
        )
        VALUES (
          ${event.id},
          ${song.id},
          ${requestDisplayName},
          ${requestDisplayName},
          'pending',
          1,
          'public'
        )
      `;
    });

    async function readEventState() {
      const [state] = await sql<
        {
          status: string;
          is_active_public_event: boolean;
          auto_close_at: Date | null;
          closed_at: Date | null;
          session_code: string;
          public_token: string;
          request_status: string;
        }[]
      >`
        SELECT
          e.status,
          e.is_active_public_event,
          e.auto_close_at,
          e.closed_at,
          c.code AS session_code,
          s.public_token,
          r.status AS request_status
        FROM public.events e
        JOIN public.event_sessions s ON s.event_id = e.id
        JOIN public.event_session_codes c
          ON c.session_id = s.id
         AND c.revoked_at IS NULL
         AND c.valid_until IS NULL
        JOIN public.song_requests r ON r.event_id = e.id
        WHERE e.public_id = ${eventPublicId}::uuid
      `;

      if (!state) {
        throw new Error("Local fixture state could not be read.");
      }

      return {
        status: state.status,
        isActivePublicEvent: state.is_active_public_event,
        autoCloseAt: state.auto_close_at,
        closedAt: state.closed_at,
        sessionCode: state.session_code,
        publicToken: state.public_token,
        requestStatus: state.request_status,
      };
    }

    async function cleanup() {
      try {
        if (operatorId !== null) {
          await sql`
            DELETE FROM public.operator_audit_log
            WHERE operator_id = ${operatorId}
          `;
        }

        await sql`
          DELETE FROM public.events
          WHERE public_id = ${eventPublicId}::uuid
        `;

        if (workspaceId !== null) {
          await sql`
            DELETE FROM public.workspaces
            WHERE id = ${workspaceId}
          `;
        }

        if (operatorId !== null) {
          await sql`
            DELETE FROM public.operator_users
            WHERE id = ${operatorId}
          `;
        }

        if (songId !== null) {
          await sql`
            DELETE FROM public.songs
            WHERE id = ${songId}
          `;
        }

        if (authUserId !== null) {
          const deleteResult = await admin.auth.admin.deleteUser(authUserId);

          if (deleteResult.error) {
            throw new Error("Local Supabase Auth user cleanup failed.");
          }
        }
      } finally {
        await sql.end({ timeout: 5 });
      }
    }

    return {
      email,
      password,
      organizationPublicId,
      eventPublicId,
      eventName,
      sessionCode,
      publicToken,
      requestDisplayName,
      readEventState,
      cleanup,
    };
  } catch (error) {
    if (authUserId !== null) {
      await admin.auth.admin.deleteUser(authUserId).catch(() => undefined);
    }
    await sql.end({ timeout: 5 });
    throw error;
  }
}

function requireEnvironment(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required for the local E2E fixture.`);
  }

  return value;
}

function createSessionCode() {
  const value = randomBytes(4).readUInt32BE(0) % 100_000_000;
  return value.toString().padStart(8, "0");
}
