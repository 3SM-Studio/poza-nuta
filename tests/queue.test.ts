import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runQueueCli } from "../src/queue/cli.ts";
import { loadQueueState, saveQueueState, updateQueueState } from "../src/queue/localQueueStore.ts";
import { addRequest, approveRequest, completeCurrentRequest, createEvent, getPublicQueue, moveRequest, rejectRequest, skipRequest, startRequest } from "../src/queue/queueService.ts";
import type { QueueState } from "../src/queue/types.ts";
import type { LocalSong } from "../src/songs/types.ts";

test("createEvent creates an empty queue", () => {
  const state = createEvent({ id: "test-event", name: "Poza Nutą Test" });

  assert.equal(state.event.id, "test-event");
  assert.equal(state.event.name, "Poza Nutą Test");
  assert.equal(state.event.status, "draft");
  assert.deepEqual(state.requests, []);
});

test("addRequest adds a pending request", () => {
  const state = addRequest(createTestEvent(), requestInput("Michał", "Królowa Łez", "Agnieszka Chylińska"));
  const request = state.requests[0];

  assert.equal(request.status, "pending");
  assert.equal(request.position, null);
  assert.equal(request.singerName, "Michał");
  assert.equal(request.displayName, "Michał");
});

test("approveRequest assigns position 1", () => {
  const pending = addRequest(createTestEvent(), requestInput("Michał", "Królowa Łez", "Agnieszka Chylińska"));
  const approved = approveRequest(pending, pending.requests[0].id);

  assert.equal(approved.requests[0].status, "approved");
  assert.equal(approved.requests[0].position, 1);
});

test("successive approveRequest calls assign positions 1, 2, 3", () => {
  const state = approveAll(addThreeRequests());

  assert.deepEqual(approvedPositions(state), [1, 2, 3]);
});

test("moveRequest renumbers the approved queue", () => {
  const state = approveAll(addThreeRequests());
  const moved = moveRequest(state, state.requests[2].id, 1);

  assert.deepEqual(approvedNames(moved), ["Ola", "Michał", "Kasia"]);
  assert.deepEqual(approvedPositions(moved), [1, 2, 3]);
});

test("startRequest sets only one request as now", () => {
  const state = approveAll(addThreeRequests());
  const started = startRequest(state, state.requests[0].id);

  assert.equal(started.requests.filter((request) => request.status === "now").length, 1);
  assert.equal(started.requests[0].status, "now");
  assert.equal(started.requests[0].position, null);
  assert.deepEqual(approvedPositions(started), [1, 2]);
});

test("startRequest throws when another request is already now", () => {
  const state = approveAll(addThreeRequests());
  const started = startRequest(state, state.requests[0].id);

  assert.throws(() => startRequest(started, started.requests[1].id), /already marked as now/);
});

test("completeCurrentRequest moves now to done", () => {
  const state = approveAll(addThreeRequests());
  const started = startRequest(state, state.requests[0].id);
  const completed = completeCurrentRequest(started);

  assert.equal(completed.requests[0].status, "done");
  assert.equal(completed.requests[0].position, null);
  assert.equal(completed.requests.filter((request) => request.status === "now").length, 0);
});

test("queue operations update event.updatedAt when requests change", () => {
  const state = approveAll(addThreeRequests());
  const pending = addThreeRequests();
  const approved = approveRequest(withEventUpdatedAt(pending, "2026-06-07T00:00:00.000Z"), pending.requests[0].id);
  const started = startRequest(state, state.requests[0].id);
  const completed = completeCurrentRequest(withEventUpdatedAt(started, "2026-06-07T00:00:00.000Z"));
  const skipped = skipRequest(withEventUpdatedAt(state, "2026-06-07T00:00:00.000Z"), state.requests[1].id);
  const rejected = rejectRequest(withEventUpdatedAt(state, "2026-06-07T00:00:00.000Z"), state.requests[2].id);

  assert.notEqual(approved.event.updatedAt, "2026-06-07T00:00:00.000Z");
  assert.equal(approved.event.updatedAt, approved.requests[0].updatedAt);
  assert.notEqual(completed.event.updatedAt, "2026-06-07T00:00:00.000Z");
  assert.equal(completed.event.updatedAt, completed.requests[0].updatedAt);
  assert.notEqual(skipped.event.updatedAt, "2026-06-07T00:00:00.000Z");
  assert.equal(skipped.event.updatedAt, skipped.requests[1].updatedAt);
  assert.notEqual(rejected.event.updatedAt, "2026-06-07T00:00:00.000Z");
  assert.equal(rejected.event.updatedAt, rejected.requests[2].updatedAt);
});

test("skipRequest removes request from active queue and renumbers approved", () => {
  const state = approveAll(addThreeRequests());
  const skipped = skipRequest(state, state.requests[1].id);

  assert.equal(skipped.requests[1].status, "skipped");
  assert.equal(skipped.requests[1].position, null);
  assert.deepEqual(approvedNames(skipped), ["Michał", "Ola"]);
  assert.deepEqual(approvedPositions(skipped), [1, 2]);
});

test("rejectRequest works for pending and approved requests", () => {
  const state = addThreeRequests();
  const approved = approveRequest(state, state.requests[0].id);
  const rejectedApproved = rejectRequest(approved, approved.requests[0].id);
  const rejectedPending = rejectRequest(rejectedApproved, rejectedApproved.requests[1].id);

  assert.equal(rejectedPending.requests[0].status, "rejected");
  assert.equal(rejectedPending.requests[0].position, null);
  assert.equal(rejectedPending.requests[1].status, "rejected");
});

test("getPublicQueue hides pending requests", () => {
  const pending = addThreeRequests();
  const approved = approveRequest(pending, pending.requests[0].id);
  const publicQueue = getPublicQueue(approved);

  assert.equal(publicQueue.next?.displayName, "Michał");
  assert.equal(publicQueue.upcoming.length, 0);
});

test("getPublicQueue uses next for the first approved request and leaves upcoming empty for one approved request", () => {
  const pending = addThreeRequests();
  const approved = approveRequest(pending, pending.requests[0].id);
  const publicQueue = getPublicQueue(approved);

  assert.equal(publicQueue.next?.position, 1);
  assert.equal(publicQueue.next?.displayName, "Michał");
  assert.deepEqual(publicQueue.upcoming, []);
});

test("getPublicQueue puts approved requests after next into upcoming", () => {
  const state = approveAll(addThreeRequests());
  const publicQueue = getPublicQueue(state);

  assert.equal(publicQueue.next?.position, 1);
  assert.equal(publicQueue.next?.displayName, "Michał");
  assert.deepEqual(
    publicQueue.upcoming.map((item) => item.position),
    [2, 3]
  );
  assert.deepEqual(
    publicQueue.upcoming.map((item) => item.displayName),
    ["Kasia", "Ola"]
  );
});

test("getPublicQueue can hide song titles for next and upcoming", () => {
  const state = approveAll(addThreeRequests());
  const publicQueue = getPublicQueue(state, { hideSongTitles: true });

  assert.equal(publicQueue.next?.songTitle, undefined);
  assert.equal(publicQueue.next?.songArtist, undefined);
  assert.equal(publicQueue.upcoming[0].songTitle, undefined);
  assert.equal(publicQueue.upcoming[0].songArtist, undefined);
});

test("save/load JSON preserves queue state", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "queue-store-"));
  try {
    const filePath = join(tempDir, "event.json");
    const state = approveAll(addThreeRequests());

    await saveQueueState(filePath, state);
    const loaded = await loadQueueState(filePath);

    assert.deepEqual(loaded, state);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("updateQueueState preserves concurrent request additions and writes atomically", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "queue-store-"));
  try {
    const filePath = join(tempDir, "event.json");
    await saveQueueState(filePath, createTestEvent());

    await Promise.all(
      Array.from({ length: 25 }, (_value, index) =>
        updateQueueState(filePath, (state) =>
          addRequest(state, requestInput(`Singer ${index}`, `Song ${index}`, `Artist ${index}`))
        )
      )
    );

    const loaded = await loadQueueState(filePath);
    const files = await readdir(tempDir);

    assert.equal(loaded.requests.length, 25);
    assert.equal(new Set(loaded.requests.map((request) => request.singerName)).size, 25);
    assert.deepEqual(files, ["event.json"]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("queue CLI does not perform HTTP requests", async () => {
  const originalFetch = globalThis.fetch;
  const stderr: string[] = [];
  globalThis.fetch = (() => {
    throw new Error("queue CLI must not call fetch");
  }) as typeof fetch;

  try {
    const exitCode = await runQueueCli(["show", "--event", "missing-event"], { stderr: (message) => stderr.push(message), stdout: () => {} });
    assert.equal(exitCode, 1);
    assert.match(stderr.join("\n"), /Missing queue state/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('add-from-search adds a pending request from the top result for "krolowa lez"', async () => {
  const context = await createQueueCliFixture();
  try {
    const stdout: string[] = [];
    const exitCode = await runQueueCli(["add-from-search", "--event", "test-event", "--singer", "Michał", "--query", "krolowa lez"], {
      ...context,
      stdout: (message) => stdout.push(message)
    });
    const state = await loadQueueState(context.eventPath);
    const request = state.requests[0];

    assert.equal(exitCode, 0);
    assert.match(stdout.join("\n"), /Added pending request/);
    assert.equal(request.status, "pending");
    assert.equal(request.position, null);
    assert.equal(request.singerName, "Michał");
    assert.equal(request.displayName, "Michał");
    assert.equal(request.songSource, "ising");
    assert.equal(request.songSourceId, "9053");
    assert.equal(request.songTitle, "Królowa Łez");
    assert.equal(request.songArtist, "Agnieszka Chylińska");
    assert.equal(request.songUrl, "https://ising.pl/agnieszka-chylinska-krolowa-lez-piosenka");
  } finally {
    await rm(context.tempDir, { recursive: true, force: true });
  }
});

test("add-from-search does not perform HTTP requests", async () => {
  const context = await createQueueCliFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("add-from-search must not call fetch");
  }) as typeof fetch;

  try {
    const exitCode = await runQueueCli(["add-from-search", "--event", "test-event", "--singer", "Michał", "--query", "krolowa lez"], {
      ...context,
      stdout: () => {}
    });
    assert.equal(exitCode, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(context.tempDir, { recursive: true, force: true });
  }
});

test("add-from-search reports missing local song index", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "queue-search-"));
  try {
    const eventsDir = join(tempDir, "events");
    const eventPath = join(eventsDir, "test-event.json");
    const stderr: string[] = [];
    await saveQueueState(eventPath, createEvent({ id: "test-event", name: "Poza Nutą Test" }));

    const exitCode = await runQueueCli(["add-from-search", "--event", "test-event", "--singer", "Michał", "--query", "krolowa lez"], {
      eventsDir,
      songIndexPath: join(tempDir, "missing-index.json"),
      stderr: (message) => stderr.push(message)
    });

    assert.equal(exitCode, 1);
    assert.match(stderr.join("\n"), /Missing local song index:/);
    assert.match(stderr.join("\n"), /Run: pnpm import:ising and\/or pnpm import:karafun/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("add-from-search reports missing queue event", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "queue-search-"));
  try {
    const stderr: string[] = [];
    const songIndexPath = join(tempDir, "ising-songs.json");
    await writeFile(songIndexPath, JSON.stringify(searchFixtureSongs(), null, 2), "utf8");

    const exitCode = await runQueueCli(["add-from-search", "--event", "missing-event", "--singer", "Michał", "--query", "krolowa lez"], {
      eventsDir: join(tempDir, "events"),
      songIndexPath,
      stderr: (message) => stderr.push(message)
    });

    assert.equal(exitCode, 1);
    assert.match(stderr.join("\n"), /Missing queue event: missing-event/);
    assert.match(stderr.join("\n"), /pnpm queue create --id missing-event/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("add-from-search does not add when best result is below minScore", async () => {
  const context = await createQueueCliFixture();
  try {
    const stderr: string[] = [];
    const exitCode = await runQueueCli(["add-from-search", "--event", "test-event", "--singer", "Michał", "--query", "lez", "--min-score", "90"], {
      ...context,
      stderr: (message) => stderr.push(message)
    });
    const state = await loadQueueState(context.eventPath);

    assert.equal(exitCode, 1);
    assert.equal(state.requests.length, 0);
    assert.match(stderr.join("\n"), /No confident match found/);
    assert.match(stderr.join("\n"), /Best score:/);
    assert.match(stderr.join("\n"), /Top local matches:/);
  } finally {
    await rm(context.tempDir, { recursive: true, force: true });
  }
});

test("--pick chooses a specific search result", async () => {
  const context = await createQueueCliFixture();
  try {
    const exitCode = await runQueueCli(["add-from-search", "--event", "test-event", "--singer", "Kasia", "--query", "queen", "--pick", "2"], {
      ...context,
      stdout: () => {}
    });
    const state = await loadQueueState(context.eventPath);

    assert.equal(exitCode, 0);
    assert.equal(state.requests[0].songTitle, "Queen of My Castle");
    assert.equal(state.requests[0].songArtist, "B Artist");
  } finally {
    await rm(context.tempDir, { recursive: true, force: true });
  }
});

test("--pick outside result range gives a readable error", async () => {
  const context = await createQueueCliFixture();
  try {
    const stderr: string[] = [];
    const exitCode = await runQueueCli(["add-from-search", "--event", "test-event", "--singer", "Kasia", "--query", "queen", "--pick", "9"], {
      ...context,
      stderr: (message) => stderr.push(message)
    });
    const state = await loadQueueState(context.eventPath);

    assert.equal(exitCode, 1);
    assert.equal(state.requests.length, 0);
    assert.match(stderr.join("\n"), /Pick is outside the result range: 9/);
  } finally {
    await rm(context.tempDir, { recursive: true, force: true });
  }
});

test("--dry-run does not save queue changes", async () => {
  const context = await createQueueCliFixture();
  try {
    const stdout: string[] = [];
    const before = await readFile(context.eventPath, "utf8");
    const exitCode = await runQueueCli(["add-from-search", "--event", "test-event", "--singer", "Michał", "--query", "krolowa lez", "--dry-run"], {
      ...context,
      stdout: (message) => stdout.push(message)
    });
    const after = await readFile(context.eventPath, "utf8");
    const state = await loadQueueState(context.eventPath);

    assert.equal(exitCode, 0);
    assert.match(stdout.join("\n"), /Dry run:/);
    assert.match(stdout.join("\n"), /Would add pending request:/);
    assert.equal(after, before);
    assert.equal(state.requests.length, 0);
  } finally {
    await rm(context.tempDir, { recursive: true, force: true });
  }
});

function createTestEvent(): QueueState {
  return createEvent({ id: "test-event", name: "Poza Nutą Test" });
}

function withEventUpdatedAt(state: QueueState, updatedAt: string): QueueState {
  return {
    ...state,
    event: {
      ...state.event,
      updatedAt
    }
  };
}

function addThreeRequests(): QueueState {
  let state = createTestEvent();
  state = addRequest(state, requestInput("Michał", "Królowa Łez", "Agnieszka Chylińska"));
  state = addRequest(state, requestInput("Kasia", "Dancing Queen", "ABBA"));
  state = addRequest(state, requestInput("Ola", "Chodź, pomaluj mój świat", "2+1"));
  return state;
}

function approveAll(state: QueueState): QueueState {
  return state.requests.reduce((current, request) => approveRequest(current, request.id), state);
}

function requestInput(singerName: string, songTitle: string, songArtist: string) {
  return {
    singerName,
    songTitle,
    songArtist,
    songSource: "ising" as const,
    songSourceId: `${songArtist}-${songTitle}`,
    songUrl: `https://ising.pl/${songArtist}-${songTitle}`
  };
}

function approvedPositions(state: QueueState): Array<number | null> {
  return state.requests
    .filter((request) => request.status === "approved")
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((request) => request.position);
}

function approvedNames(state: QueueState): string[] {
  return state.requests
    .filter((request) => request.status === "approved")
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((request) => request.singerName);
}

async function createQueueCliFixture(): Promise<{ tempDir: string; eventsDir: string; songIndexPath: string; eventPath: string }> {
  const tempDir = await mkdtemp(join(tmpdir(), "queue-search-"));
  const eventsDir = join(tempDir, "events");
  const songIndexPath = join(tempDir, "ising-songs.json");
  const eventPath = join(eventsDir, "test-event.json");

  await saveQueueState(eventPath, createEvent({ id: "test-event", name: "Poza Nutą Test" }));
  await writeFile(songIndexPath, JSON.stringify(searchFixtureSongs(), null, 2), "utf8");

  return {
    tempDir,
    eventsDir,
    songIndexPath,
    eventPath
  };
}

function searchFixtureSongs(): LocalSong[] {
  return [
    localSong({
      sourceSongId: "9053",
      artist: "Agnieszka Chylińska",
      title: "Królowa Łez",
      sourceUrl: "https://ising.pl/agnieszka-chylinska-krolowa-lez-piosenka"
    }),
    localSong({
      sourceSongId: "abba-queen",
      artist: "A Artist",
      title: "Dancing Queen",
      sourceUrl: "https://ising.pl/abba-dancing-queen-piosenka"
    }),
    localSong({
      sourceSongId: "castle-queen",
      artist: "B Artist",
      title: "Queen of My Castle",
      sourceUrl: "https://ising.pl/queen-of-my-castle-piosenka"
    })
  ];
}

function localSong(overrides: Partial<LocalSong>): LocalSong {
  const artist = overrides.artist ?? "Artist";
  const title = overrides.title ?? "Title";
  const genres = overrides.genres ?? ["Pop"];

  return {
    source: "ising",
    sourceSongId: overrides.sourceSongId ?? `${artist}-${title}`,
    title,
    subtitle: overrides.subtitle ?? null,
    artist,
    artistSourceId: overrides.artistSourceId ?? null,
    normalizedTitle: normalizeFixtureText(title),
    normalizedArtist: normalizeFixtureText(artist),
    searchText: overrides.searchText ?? normalizeFixtureText([artist, title, overrides.subtitle, ...genres].filter(Boolean).join(" ")),
    durationSeconds: overrides.durationSeconds ?? null,
    genres,
    isPlus: overrides.isPlus ?? false,
    isHit: overrides.isHit ?? false,
    isBuyAvailable: overrides.isBuyAvailable ?? false,
    sourceUrl: overrides.sourceUrl ?? null,
    sourceSelflink: overrides.sourceSelflink ?? null,
    sourceDateAdded: overrides.sourceDateAdded ?? null,
    availabilityStatus: "available",
    lastSeenAt: overrides.lastSeenAt ?? "2026-05-28T00:00:00.000Z",
    lastCheckedAt: overrides.lastCheckedAt ?? "2026-05-28T00:00:00.000Z"
  };
}

function normalizeFixtureText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/ł/g, "l")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
