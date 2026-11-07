import { Buffer } from 'buffer';
import { diffChars } from 'diff';
import * as Y from 'yjs';

import { parseFrontmatter } from '../../utils/frontmatterParser';

const BODY_KEY = 'body';
const DIFF_TIMEOUT_MS = 500;

export interface NoteSide {
  /** Markdown file content on this side, or null when only the sidecar is known. */
  text: string | null;
  /** Base64 Yjs state stored in the `.gitnotes/crdt` sidecar, or null when absent. */
  sidecar: string | null;
}

export interface MergedNote {
  text: string;
  sidecar: string;
}

export function splitNote(text: string): { head: string; body: string } {
  const { frontmatterEnd } = parseFrontmatter(text);
  const end = Math.max(frontmatterEnd, 0);
  return { head: text.slice(0, end), body: text.slice(end) };
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0 || 1;
}

/**
 * Deterministic initial state for a body that existed before CRDT tracking.
 * The client id derives from the text so every device that seeds from the same
 * text produces byte-identical structs and the seeds merge as one history.
 */
function seedUpdate(body: string): Uint8Array {
  const doc = new Y.Doc();
  doc.clientID = fnv1a(body);
  if (body.length > 0) doc.getText(BODY_KEY).insert(0, body);
  return Y.encodeStateAsUpdate(doc);
}

function decodeSidecar(sidecar: string | null): Uint8Array | null {
  const encoded = sidecar?.trim();
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  return new Uint8Array(Buffer.from(encoded, 'base64'));
}

export function encodeSidecar(doc: Y.Doc): string {
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
}

/** Rebuild a doc from a sidecar; a missing or corrupt sidecar falls back to the seed. */
export function docFromSidecar(sidecar: string | null, seedBody: string): Y.Doc {
  const doc = new Y.Doc();
  const update = decodeSidecar(sidecar);
  if (update) {
    try {
      Y.applyUpdate(doc, update);
      return doc;
    } catch {
      return docFromSidecar(null, seedBody);
    }
  }
  Y.applyUpdate(doc, seedUpdate(seedBody));
  return doc;
}

export function getBody(doc: Y.Doc): string {
  return doc.getText(BODY_KEY).toString();
}

/** Apply `nextBody` to the doc as a minimal character diff so concurrent edits keep their intent. */
export function applyBody(doc: Y.Doc, nextBody: string): void {
  const text = doc.getText(BODY_KEY);
  const current = text.toString();
  if (current === nextBody) return;
  const changes = diffChars(current, nextBody, { timeout: DIFF_TIMEOUT_MS });
  doc.transact(() => {
    if (!changes) {
      text.delete(0, current.length);
      text.insert(0, nextBody);
      return;
    }
    let offset = 0;
    for (const change of changes) {
      if (change.added) {
        text.insert(offset, change.value);
        offset += change.value.length;
      } else if (change.removed) {
        text.delete(offset, change.value.length);
      } else {
        offset += change.value.length;
      }
    }
  });
}

/** Sidecar to write after saving `content` over a file whose previous text was `previousText`. */
export function sidecarForSave(args: {
  sidecar: string | null;
  previousText: string | null;
  content: string;
}): string {
  const doc = docFromSidecar(args.sidecar, splitNote(args.previousText ?? '').body);
  applyBody(doc, splitNote(args.content).body);
  return encodeSidecar(doc);
}

/** True when the sidecar's recorded body is exactly the body of `text`. */
export function sidecarMatchesText(sidecar: string | null, text: string): boolean {
  return sidecar !== null && getBody(docFromSidecar(sidecar, '')) === splitNote(text).body;
}

function reconcileSide(side: NoteSide, baseBody: string): Y.Doc {
  const doc = docFromSidecar(side.sidecar, baseBody);
  if (side.text !== null) applyBody(doc, splitNote(side.text).body);
  return doc;
}

function unionDoc(base: string, ours: NoteSide, theirs: NoteSide): Y.Doc {
  const baseBody = splitNote(base).body;
  const merged = new Y.Doc();
  Y.applyUpdate(merged, Y.encodeStateAsUpdate(reconcileSide(ours, baseBody)));
  Y.applyUpdate(merged, Y.encodeStateAsUpdate(reconcileSide(theirs, baseBody)));
  return merged;
}

function updatedAtOf(head: string): string {
  const value = parseFrontmatter(head).frontmatter.updatedAt;
  return typeof value === 'string' ? value : '';
}

/** Frontmatter is last-writer-wins by `updatedAt`; ties and missing values keep ours. */
function pickHead(ours: string | null, theirs: string | null): string {
  const oursHead = splitNote(ours ?? '').head;
  const theirsHead = splitNote(theirs ?? '').head;
  if (ours === null) return theirsHead;
  if (theirs === null) return oursHead;
  return updatedAtOf(theirsHead) > updatedAtOf(oursHead) ? theirsHead : oursHead;
}

/** Union both histories; body text comes from the CRDT, frontmatter from the newer side. */
export function mergeNoteSides(args: { base: string; ours: NoteSide; theirs: NoteSide }): MergedNote {
  const doc = unionDoc(args.base, args.ours, args.theirs);
  return {
    text: pickHead(args.ours.text, args.theirs.text) + getBody(doc),
    sidecar: encodeSidecar(doc),
  };
}

/** Union both histories, then record the user's chosen final text on top. */
export function sidecarForResolvedText(args: {
  base: string;
  ours: NoteSide;
  theirs: NoteSide;
  finalText: string;
}): string {
  const doc = unionDoc(args.base, args.ours, args.theirs);
  applyBody(doc, splitNote(args.finalText).body);
  return encodeSidecar(doc);
}
