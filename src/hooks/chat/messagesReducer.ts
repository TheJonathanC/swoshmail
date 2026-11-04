import type { ChatMessage } from "@/types/api";

/**
 * Message state for ONE open conversation. Pure reducer: timestamps are passed in actions.
 *
 * Merge rules
 * - Everything is keyed by server id; optimistic sends carry a temporary `clientId`.
 * - A fetch result never overwrites data we learned (from realtime or a mutation) after the
 *   fetch started (`syncedAt > requestStartedAt`), and never resurrects deleted ids.
 * - Messages absent from a fetch are dropped only if they were last confirmed before the
 *   fetch started, aren't pending/failed, and aren't ephemeral messages we already acked
 *   (the recipient keeps those on screen until they leave the conversation).
 */

export type SendStatus = "sent" | "sending" | "failed";

export interface UiMessage extends ChatMessage {
  /** Stable React key: clientId for optimistic sends (kept after sync to avoid remounts), else id. */
  key: string;
  clientId: string | null;
  status: SendStatus;
  /** reply target id kept for retries of unsent messages */
  replyToId: string | null;
  /** local ms when the server last confirmed this message */
  syncedAt: number;
  /** recipient has acked this ephemeral message (server deleted it; keep showing locally) */
  acked: boolean;
  /** previous content while an edit is in flight (for rollback) */
  editRollback: { content: string; edited_at: string | null | undefined } | null;
}

export interface StreamNotice {
  id: string;
  kind: "settings" | "consumed";
  at: string;
  text: string;
  count: number;
}

export interface MessagesState {
  load: "loading" | "error" | "ready";
  messages: UiMessage[];
  notices: StreamNotice[];
  /** ids deleted/consumed; never re-added by a late fetch */
  gone: Record<string, true>;
  /** messages optimistically deleted, kept for rollback */
  pendingDeletes: Record<string, UiMessage>;
}

export const initialMessagesState: MessagesState = {
  load: "loading",
  messages: [],
  notices: [],
  gone: {},
  pendingDeletes: {},
};

export type MessagesAction =
  | { type: "load_start" }
  | { type: "load_error" }
  | { type: "load_success"; messages: ChatMessage[]; requestStartedAt: number; now: number; myId: string }
  | { type: "upsert"; message: ChatMessage; now: number; myId: string }
  | { type: "remove"; ids: string[]; reason: "deleted" | "consumed"; myId: string; at: string; noticeId: string }
  | { type: "send_start"; message: UiMessage }
  | { type: "send_success"; clientId: string; message: ChatMessage; now: number }
  | { type: "send_fail"; clientId: string }
  | { type: "retry"; clientId: string }
  | { type: "discard"; clientId: string }
  | { type: "edit_start"; id: string; content: string }
  | { type: "edit_success"; message: ChatMessage; now: number }
  | { type: "edit_fail"; id: string }
  | { type: "delete_start"; id: string }
  | { type: "delete_success"; id: string }
  | { type: "delete_fail"; id: string }
  | { type: "acked"; ids: string[] }
  | { type: "notice"; notice: StreamNotice };

function byTime(a: UiMessage, b: UiMessage) {
  const d = Date.parse(a.created_at) - Date.parse(b.created_at);
  if (d !== 0) return d;
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

function fromServer(m: ChatMessage, now: number, prev?: UiMessage): UiMessage {
  return {
    ...m,
    key: prev?.key ?? m.id,
    clientId: prev?.clientId ?? null,
    status: "sent",
    replyToId: m.reply_to?.id ?? null,
    syncedAt: now,
    acked: prev?.acked ?? false,
    editRollback: null,
  };
}

/**
 * Realtime (or a fetch) may deliver our own message before the POST response does.
 * Match it to the oldest pending optimistic message with the same content and reply target.
 */
function findOptimisticIndex(list: UiMessage[], m: ChatMessage, myId: string): number {
  if (m.sender_id !== myId) return -1;
  // The server echoes our clientId on the realtime copy when it has one: exact match.
  const echoed: unknown = m.client_id;
  if (typeof echoed === "string") {
    const exact = list.findIndex((x) => x.clientId === echoed && x.id === echoed);
    if (exact >= 0) return exact;
  }
  return list.findIndex(
    (x) =>
      x.status === "sending" &&
      x.clientId !== null &&
      x.id === x.clientId &&
      x.content === m.content &&
      x.replyToId === (m.reply_to?.id ?? null)
  );
}

function consumedNotice(notices: StreamNotice[], messages: UiMessage[], count: number, at: string, id: string) {
  const last = notices[notices.length - 1];
  const lastMsg = messages[messages.length - 1];
  // Collapse with the previous "seen & deleted" notice if nothing was posted since.
  if (last && last.kind === "consumed" && (!lastMsg || Date.parse(lastMsg.created_at) <= Date.parse(last.at))) {
    const total = last.count + count;
    return [...notices.slice(0, -1), { ...last, count: total, at, text: seenText(total) }];
  }
  return [...notices, { id, kind: "consumed" as const, at, count, text: seenText(count) }];
}

const seenText = (n: number) => (n === 1 ? "1 message seen & deleted" : `${n} messages seen & deleted`);

export function messagesReducer(state: MessagesState, action: MessagesAction): MessagesState {
  switch (action.type) {
    case "load_start":
      return state.load === "error" ? { ...state, load: "loading" } : state;

    case "load_error":
      // Keep showing what we have if a background refresh fails.
      return state.load === "ready" ? state : { ...state, load: "error" };

    case "load_success": {
      const { requestStartedAt, now, myId } = action;
      let list = [...state.messages];
      const seen = new Set<string>();
      let consumedCount = 0;

      for (const m of action.messages) {
        if (state.gone[m.id] || state.pendingDeletes[m.id]) continue;
        seen.add(m.id);
        const i = list.findIndex((x) => x.id === m.id);
        if (i >= 0) {
          const prev = list[i];
          if (prev.syncedAt > requestStartedAt || prev.editRollback) continue;
          list[i] = fromServer(m, now, prev);
        } else {
          const oi = findOptimisticIndex(list, m, myId);
          if (oi >= 0) list[oi] = fromServer(m, now, list[oi]);
          else list.push(fromServer(m, now));
        }
      }

      list = list.filter((x) => {
        if (seen.has(x.id) || x.status !== "sent" || x.acked || x.syncedAt > requestStartedAt) return true;
        if (x.sender_id === myId && x.ephemeral) consumedCount += 1;
        return false;
      });
      list.sort(byTime);

      const notices =
        consumedCount > 0 && state.load === "ready"
          ? consumedNotice(state.notices, list, consumedCount, new Date(now).toISOString(), `consumed-${now}`)
          : state.notices;
      return { ...state, load: "ready", messages: list, notices };
    }

    case "upsert": {
      const m = action.message;
      if (state.gone[m.id] || state.pendingDeletes[m.id]) return state;
      const list = [...state.messages];
      const i = list.findIndex((x) => x.id === m.id);
      if (i >= 0) list[i] = fromServer(m, action.now, list[i]);
      else {
        const oi = findOptimisticIndex(list, m, action.myId);
        if (oi >= 0) list[oi] = fromServer(m, action.now, list[oi]);
        else list.push(fromServer(m, action.now));
      }
      list.sort(byTime);
      return { ...state, messages: list };
    }

    case "remove": {
      const ids = new Set(action.ids);
      const gone = { ...state.gone };
      const pendingDeletes = { ...state.pendingDeletes };
      let removedMine = 0;
      const list: UiMessage[] = [];
      for (const x of state.messages) {
        if (!ids.has(x.id)) {
          list.push(x);
          continue;
        }
        if (action.reason === "consumed" && x.sender_id !== action.myId) {
          // We are the reader: keep it on screen for this visit.
          list.push({ ...x, acked: true });
          continue;
        }
        gone[x.id] = true;
        if (x.sender_id === action.myId) removedMine += 1;
      }
      for (const id of ids) {
        if (action.reason === "deleted" || !list.some((x) => x.id === id)) gone[id] = true;
        delete pendingDeletes[id];
      }
      const notices =
        action.reason === "consumed" && removedMine > 0
          ? consumedNotice(state.notices, list, removedMine, action.at, action.noticeId)
          : state.notices;
      return { ...state, messages: list, gone, pendingDeletes, notices };
    }

    case "send_start":
      return { ...state, messages: [...state.messages, action.message].sort(byTime) };

    case "send_success": {
      const i = state.messages.findIndex((x) => x.clientId === action.clientId && x.id === action.clientId);
      if (i < 0) {
        // Already reconciled through realtime; make sure the server copy exists once.
        if (state.messages.some((x) => x.id === action.message.id) || state.gone[action.message.id]) return state;
        return { ...state, messages: [...state.messages, fromServer(action.message, action.now)].sort(byTime) };
      }
      const list = [...state.messages];
      const dup = list.findIndex((x) => x.id === action.message.id);
      if (dup >= 0) {
        // Realtime copy arrived first and was not matched; keep a single entry.
        list.splice(i, 1);
      } else {
        list[i] = fromServer(action.message, action.now, list[i]);
      }
      return { ...state, messages: list.sort(byTime) };
    }

    case "send_fail":
      return {
        ...state,
        messages: state.messages.map((x) =>
          x.clientId === action.clientId && x.status === "sending" ? { ...x, status: "failed" } : x
        ),
      };

    case "retry":
      return {
        ...state,
        messages: state.messages.map((x) =>
          x.clientId === action.clientId && x.status === "failed" ? { ...x, status: "sending" } : x
        ),
      };

    case "discard":
      return {
        ...state,
        messages: state.messages.filter((x) => !(x.clientId === action.clientId && x.status !== "sent")),
      };

    case "edit_start":
      return {
        ...state,
        messages: state.messages.map((x) =>
          x.id === action.id && x.status === "sent"
            ? {
                ...x,
                editRollback: x.editRollback ?? { content: x.content, edited_at: x.edited_at },
                content: action.content,
              }
            : x
        ),
      };

    case "edit_success": {
      const m = action.message;
      return {
        ...state,
        messages: state.messages.map((x) => (x.id === m.id ? fromServer(m, action.now, x) : x)),
      };
    }

    case "edit_fail":
      return {
        ...state,
        messages: state.messages.map((x) =>
          x.id === action.id && x.editRollback
            ? { ...x, content: x.editRollback.content, edited_at: x.editRollback.edited_at, editRollback: null }
            : x
        ),
      };

    case "delete_start": {
      const target = state.messages.find((x) => x.id === action.id);
      if (!target) return state;
      return {
        ...state,
        messages: state.messages.filter((x) => x.id !== action.id),
        pendingDeletes: { ...state.pendingDeletes, [action.id]: target },
      };
    }

    case "delete_success": {
      const pendingDeletes = { ...state.pendingDeletes };
      delete pendingDeletes[action.id];
      return { ...state, pendingDeletes, gone: { ...state.gone, [action.id]: true } };
    }

    case "delete_fail": {
      const target = state.pendingDeletes[action.id];
      if (!target) return state;
      const pendingDeletes = { ...state.pendingDeletes };
      delete pendingDeletes[action.id];
      if (state.gone[action.id]) return { ...state, pendingDeletes };
      return { ...state, pendingDeletes, messages: [...state.messages, target].sort(byTime) };
    }

    case "acked": {
      const ids = new Set(action.ids);
      return {
        ...state,
        messages: state.messages.map((x) => (ids.has(x.id) && !x.acked ? { ...x, acked: true } : x)),
      };
    }

    case "notice":
      return { ...state, notices: [...state.notices, action.notice] };

    default:
      return state;
  }
}
