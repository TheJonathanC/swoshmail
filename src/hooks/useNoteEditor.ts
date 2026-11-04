"use client";

import { useCallback, useRef, useState } from "react";
import type { FileItem, TextSaveResponse } from "@/types/api";
import { useToast } from "@/components/ui/Toast";
import { ApiRequestError, errorMessage, getJson, sendJson, withQuery } from "@/lib/client/api";

export const DEFAULT_NOTE_NAME = "notes.txt";
export const MAX_NOTE_BYTES = 1024 * 1024;

interface NoteState {
  open: boolean;
  file: FileItem | null;
  /** Folder new notes are created in ("root" or uuid). */
  folderId: string;
  name: string;
  savedName: string;
  content: string;
  savedContent: string;
  loading: boolean;
  loadError: string | null;
  saving: boolean;
  confirmDiscard: boolean;
}

const CLOSED: NoteState = {
  open: false,
  file: null,
  folderId: "root",
  name: DEFAULT_NOTE_NAME,
  savedName: DEFAULT_NOTE_NAME,
  content: "",
  savedContent: "",
  loading: false,
  loadError: null,
  saving: false,
  confirmDiscard: false,
};

function normaliseName(name: string, fallback: string) {
  let result = name.trim() || fallback;
  if (!result.includes(".")) result += ".txt";
  return result;
}

export function useNoteEditor({ onSaved }: { onSaved: (file: FileItem, totalUsed: number, created: boolean) => void }) {
  const toast = useToast();
  const [state, setState] = useState<NoteState>(CLOSED);
  const requestRef = useRef(0);

  const isDirty = state.open && (state.content !== state.savedContent || state.name !== state.savedName);
  const byteSize = new Blob([state.content]).size;

  const openNew = useCallback((folderId: string) => {
    requestRef.current += 1;
    setState({ ...CLOSED, open: true, folderId });
  }, []);

  const openEdit = useCallback((file: FileItem, knownContent?: string) => {
    const requestId = ++requestRef.current;
    const base = { ...CLOSED, open: true, file, folderId: file.folder_id ?? "root", name: file.name, savedName: file.name };
    if (typeof knownContent === "string") {
      setState({ ...base, content: knownContent, savedContent: knownContent });
      return;
    }
    setState({ ...base, loading: true });
    getJson<{ content: string; name?: string }>(withQuery("/api/drive/text", { fileId: file.id }))
      .then((data) => {
        if (requestRef.current !== requestId) return;
        const content = data.content ?? "";
        setState((s) => ({ ...s, loading: false, content, savedContent: content }));
      })
      .catch((err: unknown) => {
        if (requestRef.current !== requestId) return;
        setState((s) => ({ ...s, loading: false, loadError: errorMessage(err, "Couldn't load this note.") }));
      });
  }, []);

  const setName = useCallback((name: string) => setState((s) => ({ ...s, name })), []);
  const setContent = useCallback((content: string) => setState((s) => ({ ...s, content })), []);

  const save = useCallback(async () => {
    if (state.saving || state.loading || state.loadError) return;
    if (byteSize > MAX_NOTE_BYTES) {
      toast("danger", "Note too large", "Notes can be up to 1 MB. Split it into smaller files.");
      return;
    }
    const name = normaliseName(state.name, state.file?.name ?? DEFAULT_NOTE_NAME);
    const content = state.content;
    const editing = state.file;
    setState((s) => ({ ...s, saving: true }));
    try {
      const res = editing
        ? await sendJson<TextSaveResponse>("/api/drive/text", "PUT", { fileId: editing.id, name, content })
        : await sendJson<TextSaveResponse>("/api/drive/text", "POST", {
            name,
            content,
            folderId: state.folderId === "root" ? null : state.folderId,
          });
      const saved: FileItem = { ...res.file, size: Number(res.file.size) || 0 };
      setState((s) => ({ ...s, saving: false, file: saved, name: saved.name, savedName: saved.name, savedContent: content }));
      onSaved(saved, res.totalUsed, !editing);
      toast("success", editing ? "Note updated" : "Note saved", `${saved.name} was saved to your Drive.`);
    } catch (err) {
      setState((s) => ({ ...s, saving: false }));
      const message =
        err instanceof ApiRequestError && err.status === 409
          ? `A file named "${name}" already exists in this folder. Choose another name.`
          : errorMessage(err, "Couldn't save this note.");
      toast("danger", "Save failed", message);
    }
  }, [state, byteSize, toast, onSaved]);

  const requestClose = useCallback(() => {
    if (state.saving) return;
    if (isDirty) setState((s) => ({ ...s, confirmDiscard: true }));
    else {
      requestRef.current += 1;
      setState(CLOSED);
    }
  }, [state.saving, isDirty]);

  const discard = useCallback(() => {
    requestRef.current += 1;
    setState(CLOSED);
  }, []);

  const keepEditing = useCallback(() => setState((s) => ({ ...s, confirmDiscard: false })), []);

  return { ...state, isDirty, byteSize, openNew, openEdit, setName, setContent, save, requestClose, discard, keepEditing };
}
