/**
 * Tiny bus that lets `chatStore` (list/delete/rename) tell live `ChatSession`s about
 * thread-level changes without importing the session registry (which imports `chatStore`).
 */

type ThreadListener = (threadId: string) => void;
/** Returns true when a live session took over the rename (and will persist it). */
type RenameListener = (threadId: string, title: string) => boolean;

const removedListeners = new Set<ThreadListener>();
const renamedListeners = new Set<RenameListener>();

export function onThreadRemoved(listener: ThreadListener): () => void {
  removedListeners.add(listener);
  return () => removedListeners.delete(listener);
}

export function onThreadRenamed(listener: RenameListener): () => void {
  renamedListeners.add(listener);
  return () => renamedListeners.delete(listener);
}

export function emitThreadRemoved(threadId: string): void {
  for (const listener of removedListeners) listener(threadId);
}

export function emitThreadRenamed(threadId: string, title: string): boolean {
  let handled = false;
  for (const listener of renamedListeners) handled = listener(threadId, title) || handled;
  return handled;
}
