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
