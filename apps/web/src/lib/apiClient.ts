export type SearchResultDto = {
  source: "ising" | "karafun";
  sourceSongId: string;
  title: string;
  artist: string;
  url: string | null;
  score: number;
};

export type SongRequestDto = {
  id: string;
  status: "pending" | "approved" | "now" | "done" | "skipped" | "rejected";
  singerName: string;
  displayName?: string;
  songTitle: string;
  songArtist: string;
  songSource: "ising" | "karafun" | "manual";
  songSourceId?: string;
  songUrl?: string;
  note?: string;
  position?: number | null;
};

export type PublicQueueItemDto = {
  singerName: string;
  displayName: string;
  position: number | null;
  songTitle?: string;
  songArtist?: string;
};

export type PublicQueueDto = {
  now?: PublicQueueItemDto;
  next?: PublicQueueItemDto;
  upcoming: PublicQueueItemDto[];
};

export type OperatorQueueDto = {
  pending: SongRequestDto[];
  now: SongRequestDto[];
  approved: SongRequestDto[];
  done: SongRequestDto[];
  skipped: SongRequestDto[];
  rejected: SongRequestDto[];
};

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(baseUrl: string) {
  const normalizedBaseUrl = normalizeApiBaseUrl(baseUrl);

  return {
    searchSongs(query: string, limit = 10, signal?: AbortSignal): Promise<{ query: string; results: SearchResultDto[] }> {
      const url = buildApiUrl(normalizedBaseUrl, "/api/search", { q: query, limit: String(limit) });
      return requestJson(url, { signal });
    },

    submitRequest(eventId: string, input: { singerName: string; song: SearchResultDto }): Promise<{ request: SongRequestDto }> {
      const validationError = validateSubmitRequest(input);
      if (validationError) {
        return Promise.reject(new Error(validationError));
      }

      const url = buildApiUrl(normalizedBaseUrl, `/api/events/${encodeURIComponent(eventId)}/requests`);
      return requestJson(url, {
        method: "POST",
        body: JSON.stringify({
          singerName: input.singerName.trim(),
          songSource: input.song.source,
          songSourceId: input.song.sourceSongId
        })
      });
    },

    getPublicQueue(eventId: string): Promise<PublicQueueDto> {
      return requestJson(buildApiUrl(normalizedBaseUrl, `/api/events/${encodeURIComponent(eventId)}/public-queue`));
    },

    getOperatorQueue(eventId: string): Promise<OperatorQueueDto> {
      return requestJson(buildApiUrl(normalizedBaseUrl, `/api/events/${encodeURIComponent(eventId)}/operator-queue`));
    },

    approve(eventId: string, requestId: string): Promise<{ operatorQueue: OperatorQueueDto }> {
      return postAction(normalizedBaseUrl, eventId, requestId, "approve");
    },

    reject(eventId: string, requestId: string): Promise<{ operatorQueue: OperatorQueueDto }> {
      return postAction(normalizedBaseUrl, eventId, requestId, "reject");
    },

    start(eventId: string, requestId: string): Promise<{ operatorQueue: OperatorQueueDto }> {
      return postAction(normalizedBaseUrl, eventId, requestId, "start");
    },

    skip(eventId: string, requestId: string): Promise<{ operatorQueue: OperatorQueueDto }> {
      return postAction(normalizedBaseUrl, eventId, requestId, "skip");
    },

    done(eventId: string): Promise<{ operatorQueue: OperatorQueueDto }> {
      return requestJson(buildApiUrl(normalizedBaseUrl, `/api/events/${encodeURIComponent(eventId)}/done`), { method: "POST" });
    }
  };
}

export function buildApiUrl(baseUrl: string, path: string, params: Record<string, string> = {}): string {
  const url = new URL(path, normalizeApiBaseUrl(baseUrl));

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

export function validateSubmitRequest(input: { singerName?: string; song?: SearchResultDto | null }): string | null {
  if (!input.singerName?.trim()) {
    return "Podaj imię.";
  }

  if (!input.song) {
    return "Wybierz piosenkę.";
  }

  return null;
}

export function isSameSearchResult(left: SearchResultDto | null | undefined, right: SearchResultDto | null | undefined): boolean {
  return Boolean(left && right && left.source === right.source && left.sourceSongId === right.sourceSongId);
}

export function normalizeApiBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl || "http://127.0.0.1:4321");

  if (url.hostname.includes("ising.pl")) {
    throw new Error("Frontend API client cannot use iSing URL.");
  }

  return url.toString();
}

async function postAction(baseUrl: string, eventId: string, requestId: string, action: string): Promise<{ operatorQueue: OperatorQueueDto }> {
  return requestJson(buildApiUrl(baseUrl, `/api/events/${encodeURIComponent(eventId)}/requests/${encodeURIComponent(requestId)}/${action}`), { method: "POST" });
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...init.headers
    }
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message = body && typeof body.message === "string" ? body.message : "Nie udało się wykonać operacji.";
    throw new Error(message);
  }

  return body as T;
}
