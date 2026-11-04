"use client";

import { useCallback, useMemo, useState } from "react";

/**
 * Multi-select state scoped to a context key (e.g. the current folder):
 * changing the scope clears the selection without an effect.
 */
export function useSelection(scope: string, visibleIds: readonly string[]) {
  const [state, setState] = useState<{ scope: string; ids: ReadonlySet<string> }>({ scope, ids: new Set() });
  const raw = state.scope === scope ? state.ids : null;

  // Drop ids that are no longer visible (deleted, filtered out)
  const selected = useMemo(() => {
    if (!raw || raw.size === 0) return new Set<string>();
    const visible = new Set(visibleIds);
    return new Set([...raw].filter((id) => visible.has(id)));
  }, [raw, visibleIds]);

  const update = useCallback(
    (fn: (prev: Set<string>) => Set<string>) => {
      setState((prev) => ({ scope, ids: fn(new Set(prev.scope === scope ? prev.ids : [])) }));
    },
    [scope]
  );

  const toggle = useCallback(
    (id: string) =>
      update((next) => {
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [update]
  );

  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0 && !allSelected;

  const toggleAll = useCallback(() => {
    update((next) => {
      const every = visibleIds.length > 0 && visibleIds.every((id) => next.has(id));
      if (every) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }, [update, visibleIds]);

  const clear = useCallback(() => update(() => new Set()), [update]);

  return { selected, count: selected.size, allSelected, someSelected, toggle, toggleAll, clear };
}
