/**
 * Incremental NDJSON decoder: ACP agents write one JSON object per line, but
 * pipes split wherever they please, so lines arrive in arbitrary chunks.
 */
export class NdjsonDecoder {
  private pending = '';

  /** Feeds a chunk and returns every complete line it produced. */
  push(chunk: string): string[] {
    this.pending += chunk;
    const lines: string[] = [];
    let newlineIndex = this.pending.indexOf('\n');
    while (newlineIndex !== -1) {
      const raw = this.pending.slice(0, newlineIndex);
      this.pending = this.pending.slice(newlineIndex + 1);
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (line.trim().length > 0) lines.push(line);
      newlineIndex = this.pending.indexOf('\n');
    }
    return lines;
  }

  /** Returns the trailing line when the stream ended without a newline. */
  flush(): string[] {
    const raw = this.pending.endsWith('\r') ? this.pending.slice(0, -1) : this.pending;
    this.pending = '';
    return raw.trim().length > 0 ? [raw] : [];
  }
}
