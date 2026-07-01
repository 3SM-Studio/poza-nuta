export type QueueEvent = {
  id: string;
  name: string;
  venue?: string;
  date?: string;
  status: "draft" | "active" | "closed";
  createdAt: string;
  updatedAt: string;
};

export type SongRequest = {
  id: string;
  eventId: string;
  singerName: string;
  displayName: string;
  songSource: "ising" | "karafun" | "manual";
  songSourceId?: string;
  songTitle: string;
  songArtist: string;
  songUrl?: string;
  note?: string;
  status: "pending" | "approved" | "now" | "done" | "skipped" | "rejected";
  position: number | null;
  createdAt: string;
  updatedAt: string;
};

export type QueueState = {
  event: QueueEvent;
  requests: SongRequest[];
};

export type PublicQueueItem = {
  singerName: string;
  displayName: string;
  position: number | null;
  songTitle?: string;
  songArtist?: string;
};

export type PublicQueue = {
  now?: PublicQueueItem;
  next?: PublicQueueItem;
  upcoming: PublicQueueItem[];
};

export type OperatorQueue = {
  pending: SongRequest[];
  now: SongRequest[];
  approved: SongRequest[];
  done: SongRequest[];
  skipped: SongRequest[];
  rejected: SongRequest[];
};
