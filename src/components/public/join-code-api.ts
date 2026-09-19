export type JoinCodeResolution =
  | { status: "resolved"; location: string }
  | { status: "error"; error: "invalid" | "rate-limited" | "unavailable" };

export async function resolveJoinCodeClient(code: string, signal?: AbortSignal): Promise<JoinCodeResolution> {
  const response = await fetch(`/join/${encodeURIComponent(code)}`, {
    headers: { Accept: "application/json" },
    signal,
  });
  const payload = (await response.json()) as JoinCodeResolution;
  if (payload.status === "resolved" || payload.status === "error") return payload;
  return { status: "error", error: "unavailable" };
}
