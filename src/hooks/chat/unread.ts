/** Pure helpers for unread badges in polling mode (no React). */

export interface IncomingSource {
  id: string;
  recent_incoming_ids: readonly string[];
}

/** Marks every id as already seen (first list load: existing messages are not unread). */
export function seedSeenIds(list: readonly IncomingSource[], seen: Set<string>): void {
  for (const c of list) for (const id of c.recent_incoming_ids) seen.add(id);
}

/**
 * Adds ids not in `seen` to it and returns how many are new per conversation, skipping
 * the conversation currently on screen (`viewedId`, null when the tab is hidden).
 * `seen` is shared with the realtime path, so a message is never counted twice.
 */
export function collectNewIncoming(
  list: readonly IncomingSource[],
  seen: Set<string>,
  viewedId: string | null
): Record<string, number> {
  const added: Record<string, number> = {};
  for (const c of list) {
    for (const id of c.recent_incoming_ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (c.id !== viewedId) added[c.id] = (added[c.id] ?? 0) + 1;
    }
  }
  return added;
}
