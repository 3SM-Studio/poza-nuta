import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { assertLocalApiTarget, assertLocalDatabaseTarget } from '../src/lib/local-target.ts';
import { workspaces, operatorUsers, workspaceMembers, events, eventSessions, eventSessionCodes, songs } from '../src/db/schema.ts';

const text = await readFile('.env.admin.local', 'utf8');
if (!text.startsWith('# Owned local Supabase only.')) throw new Error('Managed local environment required.');
const env = parse(text);
const url = assertLocalDatabaseTarget(env.DIRECT_URL);
if (new URL(url).port !== '55522') throw new Error('Synthetic development seed requires the persistent local stack.');
assertLocalApiTarget(env.SUPABASE_URL, url);
const client = postgres(url, { max: 1, onnotice: () => undefined });
const db = drizzle({ client });
try {
  const existing = await db.select().from(workspaces).where(eq(workspaces.handle, 'synthetic-development'));
  if (existing.length) {
    console.log('Synthetic development fixture already exists; unchanged.');
  } else {
    const auth = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const email = `local-${randomBytes(6).toString('hex')}@example.test`;
    const password = randomBytes(24).toString('base64url') + 'Aa1!';
    const { data, error } = await auth.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) throw new Error('Synthetic local Auth user could not be created.');
    // A failed database transaction leaves at most an isolated synthetic Auth user,
    // never deletes data; rerun is safe and does not rewrite existing fixtures.
    const fixture = await db.transaction(async tx => {
      const [operator] = await tx.insert(operatorUsers).values({ name: email,
        displayName: 'Synthetic operator', profileCompletedAt: new Date(), authUserId: data.user.id,
        passwordHash: 'supabase-auth-managed', active: true }).returning();
      const [workspace] = await tx.insert(workspaces).values({ publicId: randomBytes(10).toString('hex'),
        name: 'Synthetic Development', handle: 'synthetic-development' }).returning();
      await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, operatorUserId: operator.id, role: 'owner' });
      const sessionCode = String(100000 + Math.floor(Math.random() * 900000));
      const now = new Date();
      const [event] = await tx.insert(events).values({ workspaceId: workspace.id,
        name: 'Synthetic karaoke', slug: 'synthetic-karaoke', sessionCode, startsAt: now,
        endsAt: new Date(now.getTime() + 8 * 3600_000), autoCloseAt: new Date(now.getTime() + 8 * 3600_000),
        status: 'active', visibility: 'public', publishedAt: now, isActivePublicEvent: true,
        publicQueueEnabled: true, songRequestsEnabled: true, publicShowSongTitles: true }).returning();
      const [session] = await tx.insert(eventSessions).values({ eventId: event.id, publicToken: randomBytes(16).toString('base64url') }).returning();
      await tx.insert(eventSessionCodes).values({ sessionId: session.id, code: sessionCode, createdByOperatorId: operator.id, rotationReason: 'initial' });
      await tx.insert(songs).values(Array.from({ length: 20 }, (_, index) => ({
        source: 'manual' as const, sourceSongId: `synthetic-${index}`, title: `Synthetic Song ${index + 1}`,
        artist: 'Synthetic Artist', normalizedTitle: `synthetic song ${index + 1}`, normalizedArtist: 'synthetic artist',
        searchText: `synthetic song ${index + 1} synthetic artist`, genres: ['Pop'], languages: ['pl'],
      })));
      return { organizationPublicId: workspace.publicId, eventPublicId: event.publicId, sessionCode };
    });
    await writeFile('.artifacts/local-development/operator.json', JSON.stringify({ email, password, ...fixture }), { mode: 0o600 });
    console.log('Created synthetic operator, organization, event, session and 20 songs. Credentials are private.');
  }
} finally { await client.end(); }
