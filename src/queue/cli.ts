import { pathToFileURL } from "node:url";
import { addRequest, approveRequest, completeCurrentRequest, createEvent, getOperatorQueue, getPublicQueue, moveRequest, QueueOperationError, rejectRequest, skipRequest, startRequest } from "./queueService.ts";
import { loadQueueState, MissingQueueStateError, saveQueueState, updateQueueState } from "./localQueueStore.ts";
import { MissingLocalSongIndexError, readLocalSongIndex } from "../search/localSongIndex.ts";
import { searchSongs, type SearchResult } from "../search/songSearch.ts";
import type { QueueState, SongRequest } from "./types.ts";
import type { LocalSong } from "../songs/types.ts";

type CliIO = {
  stdout?: (message: string) => void;
  stderr?: (message: string) => void;
  eventsDir?: string;
  songIndexPath?: string;
};

type ParsedArgs = {
  command: string;
  flags: Map<string, string | boolean>;
};

const DEFAULT_EVENTS_DIR = "data/events";
const DEFAULT_SONG_INDEX_PATH = "data/imports/songs.json";

export async function runQueueCli(args: string[], io: CliIO = {}): Promise<number> {
  const stdout = io.stdout ?? console.log;
  const stderr = io.stderr ?? console.error;
  const eventsDir = io.eventsDir ?? DEFAULT_EVENTS_DIR;
  const songIndexPath = io.songIndexPath ?? DEFAULT_SONG_INDEX_PATH;
  const parsed = parseArgs(args);

  try {
    if (!parsed.command || parsed.command === "help" || parsed.flags.has("help")) {
      stdout(helpText());
      return 0;
    }

    switch (parsed.command) {
      case "create":
        return await createCommand(parsed, stdout, eventsDir);
      case "add":
        return await updateCommand(parsed, stdout, eventsDir, (state) =>
          addRequest(state, {
            singerName: requiredFlag(parsed, "singer"),
            displayName: optionalFlag(parsed, "display-name"),
            songTitle: requiredFlag(parsed, "title"),
            songArtist: requiredFlag(parsed, "artist"),
            songSource: parseSongSource(requiredFlag(parsed, "source")),
            songSourceId: optionalFlag(parsed, "source-id"),
            songUrl: optionalFlag(parsed, "url"),
            note: optionalFlag(parsed, "note")
          })
        );
      case "add-from-search":
        return await addFromSearchCommand(parsed, stdout, stderr, eventsDir, songIndexPath);
      case "approve":
        return await updateCommand(parsed, stdout, eventsDir, (state) => approveRequest(state, requiredFlag(parsed, "request")));
      case "reject":
        return await updateCommand(parsed, stdout, eventsDir, (state) => rejectRequest(state, requiredFlag(parsed, "request")));
      case "start":
        return await updateCommand(parsed, stdout, eventsDir, (state) => startRequest(state, requiredFlag(parsed, "request")));
      case "done":
        return await updateCommand(parsed, stdout, eventsDir, completeCurrentRequest);
      case "skip":
        return await updateCommand(parsed, stdout, eventsDir, (state) => skipRequest(state, requiredFlag(parsed, "request")));
      case "move":
        return await updateCommand(parsed, stdout, eventsDir, (state) => moveRequest(state, requiredFlag(parsed, "request"), Number(requiredFlag(parsed, "position"))));
      case "show":
        return await showCommand(parsed, stdout, eventsDir);
      case "public":
        return await publicCommand(parsed, stdout, eventsDir);
      default:
        stderr(`Unknown queue command: ${parsed.command}`);
        stderr("Run: pnpm queue --help");
        return 1;
    }
  } catch (error) {
    if (error instanceof MissingQueueStateError) {
      stderr(`Missing queue state: ${error.path}`);
      stderr("Run: pnpm queue create --id <event-id> --name \"Event name\"");
      return 1;
    }

    if (error instanceof QueueOperationError || error instanceof Error) {
      stderr(error.message);
      return 1;
    }

    stderr("Queue command failed: Unknown error");
    return 1;
  }
}

async function createCommand(parsed: ParsedArgs, stdout: (message: string) => void, eventsDir: string): Promise<number> {
  const eventId = parseEventId(requiredFlag(parsed, "id"));
  const state = createEvent({
    id: eventId,
    name: requiredFlag(parsed, "name"),
    venue: optionalFlag(parsed, "venue"),
    date: optionalFlag(parsed, "date"),
    status: "active"
  });

  await saveQueueState(eventPath(eventId, eventsDir), state);
  stdout(`Queue event created: ${eventId}`);
  stdout(`File: ${eventPath(eventId, eventsDir)}`);
  return 0;
}

async function updateCommand(parsed: ParsedArgs, stdout: (message: string) => void, eventsDir: string, operation: (state: QueueState) => QueueState): Promise<number> {
  const eventId = parseEventId(requiredFlag(parsed, "event"));
  let before: QueueState | undefined;
  const after = await updateQueueState(eventPath(eventId, eventsDir), (state) => {
    before = state;
    return operation(state);
  });
  stdout(`Queue event updated: ${eventId}`);

  const newestRequest = findNewestRequest(before ?? after, after);
  if (newestRequest) {
    stdout(`Request: ${newestRequest.id}`);
  }

  return 0;
}

async function addFromSearchCommand(parsed: ParsedArgs, stdout: (message: string) => void, stderr: (message: string) => void, eventsDir: string, songIndexPath: string): Promise<number> {
  const eventId = parseEventId(requiredFlag(parsed, "event"));
  const singerName = requiredFlag(parsed, "singer");
  const query = requiredFlag(parsed, "query");
  const minScore = parseMinScore(optionalFlag(parsed, "min-score"));
  const pick = parsePick(optionalFlag(parsed, "pick"));
  const dryRun = parsed.flags.has("dry-run");
  let state: QueueState;
  let songs: LocalSong[];

  try {
    state = await loadQueueState(eventPath(eventId, eventsDir));
  } catch (error) {
    if (error instanceof MissingQueueStateError) {
      stderr(`Missing queue event: ${eventId}`);
      stderr(`Run: pnpm queue create --id ${eventId} --name "..."`);
      return 1;
    }
    throw error;
  }

  try {
    songs = await readLocalSongIndex(songIndexPath);
  } catch (error) {
    if (error instanceof MissingLocalSongIndexError) {
      stderr(`Missing local song index: ${error.path}`);
      stderr("Run: pnpm import:ising and/or pnpm import:karafun");
      return 1;
    }
    throw error;
  }

  const results = searchSongs(query, songs, { limit: 5, source: "all" });
  const selected = selectSearchResult(results, pick, minScore);

  if (!selected.ok) {
    stderr(selected.message);
    if (selected.bestScore !== undefined) {
      stderr(`Best score: ${selected.bestScore}`);
    }
    stderr("Try a different query, use --pick, lower --min-score, or add manually.");
    printSearchResults(stderr, results);
    return 1;
  }

  const song = selected.result.song;
  if (dryRun) {
    stdout("Dry run:");
    stdout("Would add pending request:");
    stdout(`Singer: ${singerName}`);
    stdout(`Song: ${song.artist} - ${song.title}`);
    stdout(`Source: ${formatSource(song.source)}`);
    stdout("Status: pending");
    return 0;
  }

  let addedRequest: SongRequest | undefined;
  await updateQueueState(eventPath(eventId, eventsDir), (currentState) => {
    const nextState = addRequest(currentState, {
      singerName,
      displayName: singerName,
      songSource: songSourceFromLocalSong(song),
      songSourceId: song.sourceSongId,
      songTitle: song.title,
      songArtist: song.artist,
      songUrl: song.sourceUrl ?? undefined
    });
    addedRequest = findNewestRequest(currentState, nextState);
    return nextState;
  });
  stdout("Added pending request:");
  stdout(`ID: ${addedRequest?.id ?? "unknown"}`);
  stdout(`Singer: ${singerName}`);
  stdout(`Song: ${song.artist} - ${song.title}`);
  stdout(`Source: ${formatSource(song.source)}`);
  stdout("Status: pending");
  return 0;
}

async function showCommand(parsed: ParsedArgs, stdout: (message: string) => void, eventsDir: string): Promise<number> {
  const eventId = parseEventId(requiredFlag(parsed, "event"));
  const state = await loadQueueState(eventPath(eventId, eventsDir));
  const queue = getOperatorQueue(state);

  stdout(`${state.event.name} (${state.event.status})`);
  printGroup(stdout, "Now", queue.now);
  printGroup(stdout, "Pending", queue.pending);
  printGroup(stdout, "Approved", queue.approved);
  printGroup(stdout, "Done", queue.done);
  printGroup(stdout, "Skipped", queue.skipped);
  printGroup(stdout, "Rejected", queue.rejected);
  return 0;
}

async function publicCommand(parsed: ParsedArgs, stdout: (message: string) => void, eventsDir: string): Promise<number> {
  const eventId = parseEventId(requiredFlag(parsed, "event"));
  const state = await loadQueueState(eventPath(eventId, eventsDir));
  const queue = getPublicQueue(state, { hideSongTitles: parsed.flags.has("hide-song-titles") });

  stdout(`Public queue: ${state.event.name}`);
  stdout(`Now: ${formatPublicItem(queue.now)}`);
  stdout(`Next: ${formatPublicItem(queue.next)}`);
  stdout("Upcoming:");

  if (queue.upcoming.length === 0) {
    stdout("  none");
  } else {
    for (const item of queue.upcoming) {
      stdout(`  ${formatPublicItem(item)}`);
    }
  }

  return 0;
}

function printGroup(stdout: (message: string) => void, label: string, requests: SongRequest[]): void {
  stdout(`${label}:`);
  if (requests.length === 0) {
    stdout("  none");
    return;
  }

  for (const request of requests) {
    const position = request.position === null ? "-" : String(request.position);
    stdout(`  [${position}] ${request.id} ${request.displayName}: ${request.songArtist} - ${request.songTitle} (${request.status})`);
  }
}

function formatPublicItem(item: { displayName: string; position: number | null; songTitle?: string; songArtist?: string } | undefined): string {
  if (!item) {
    return "none";
  }

  const position = item.position === null ? "-" : `${item.position}.`;
  const song = item.songTitle && item.songArtist ? ` - ${item.songArtist} - ${item.songTitle}` : "";
  return `${position} ${item.displayName}${song}`;
}

function findNewestRequest(before: QueueState, after: QueueState): SongRequest | undefined {
  const beforeIds = new Set(before.requests.map((request) => request.id));
  return after.requests.find((request) => !beforeIds.has(request.id));
}

function selectSearchResult(results: SearchResult[], pick: number | undefined, minScore: number): { ok: true; result: SearchResult } | { ok: false; message: string; bestScore?: number } {
  if (pick !== undefined) {
    const result = results[pick - 1];
    if (!result) {
      return {
        ok: false,
        message: `Pick is outside the result range: ${pick}`,
        bestScore: results[0]?.score
      };
    }

    return { ok: true, result };
  }

  const best = results[0];
  if (!best || best.score < minScore) {
    return {
      ok: false,
      message: "No confident match found.",
      bestScore: best?.score ?? 0
    };
  }

  return { ok: true, result: best };
}

function printSearchResults(output: (message: string) => void, results: SearchResult[]): void {
  output("Top local matches:");

  if (results.length === 0) {
    output("  none");
    return;
  }

  for (const [index, result] of results.entries()) {
    output(`  ${index + 1}. ${result.song.artist} - ${result.song.title} (score: ${result.score})`);
  }
}

function parseArgs(args: string[]): ParsedArgs {
  const flags = new Map<string, string | boolean>();
  let command = "";

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];

    if (!command && !value.startsWith("--")) {
      command = value;
      continue;
    }

    if (!value.startsWith("--")) {
      continue;
    }

    const flagName = value.slice(2);
    const next = args[index + 1];
    if (!next || next.startsWith("--")) {
      flags.set(flagName, true);
    } else {
      flags.set(flagName, next);
      index += 1;
    }
  }

  return { command, flags };
}

function requiredFlag(parsed: ParsedArgs, name: string): string {
  const value = parsed.flags.get(name);
  if (typeof value !== "string" || !value.trim()) {
    throw new QueueOperationError(`Missing --${name}`);
  }

  return value;
}

function optionalFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === "string" && value.trim() ? value : undefined;
}

function parseMinScore(value: string | undefined): number {
  if (value === undefined) {
    return 60;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new QueueOperationError(`Invalid --min-score: ${value}`);
  }

  return parsed;
}

function parsePick(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new QueueOperationError(`Invalid --pick: ${value}`);
  }

  return parsed;
}

function parseEventId(value: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new QueueOperationError("Event id can only contain letters, numbers, underscores and hyphens");
  }

  return value;
}

function parseSongSource(value: string): SongRequest["songSource"] {
  if (value === "ising" || value === "karafun" || value === "manual") {
    return value;
  }

  throw new QueueOperationError("Song source must be one of: ising, karafun, manual");
}

function songSourceFromLocalSong(song: LocalSong): SongRequest["songSource"] {
  return song.source === "ising" || song.source === "karafun" ? song.source : "manual";
}

function formatSource(source: string): string {
  return source === "ising" ? "iSing" : source === "karafun" ? "KaraFun" : source;
}

function eventPath(eventId: string, eventsDir = DEFAULT_EVENTS_DIR): string {
  return `${eventsDir}/${eventId}.json`;
}

function helpText(): string {
  return [
    "Usage: pnpm queue <command> [options]",
    "",
    "Commands:",
    "  create --id <event-id> --name <name> [--venue <venue>] [--date <date>]",
    "  add --event <event-id> --singer <name> --title <title> --artist <artist> --source <ising|karafun|manual> [--source-id <id>] [--url <url>] [--note <note>]",
    "  add-from-search --event <event-id> --singer <name> --query <query> [--min-score <number>] [--pick <number>] [--dry-run]",
    "  approve --event <event-id> --request <request-id>",
    "  reject --event <event-id> --request <request-id>",
    "  start --event <event-id> --request <request-id>",
    "  done --event <event-id>",
    "  skip --event <event-id> --request <request-id>",
    "  move --event <event-id> --request <request-id> --position <number>",
    "  show --event <event-id>",
    "  public --event <event-id> [--hide-song-titles]"
  ].join("\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await runQueueCli(process.argv.slice(2));
  process.exitCode = exitCode;
}
