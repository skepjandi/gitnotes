/** Last non-empty segment of a host path; works for POSIX and Windows separators. */
export function folderName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

/** `host[:port]` of a `ws(s)://` bridge URL, for display only. */
export function bridgeHost(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url);
  return match?.[1] ?? url;
}

export type SessionAge = { unit: 'now' } | { unit: 'minutes' | 'hours' | 'days'; count: number };

/** Coarse age of `startedAt` relative to `now`, for "started 5 min ago" labels. */
export function sessionAge(startedAt: number, now: number): SessionAge {
  const minutes = Math.max(0, Math.floor((now - startedAt) / 60_000));
  if (minutes < 1) return { unit: 'now' };
  if (minutes < 60) return { unit: 'minutes', count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: 'hours', count: hours };
  return { unit: 'days', count: Math.floor(hours / 24) };
}
