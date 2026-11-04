"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FileItem } from "@/types/api";
import { readJson, writeStorage } from "@/lib/client/storage";

export interface DirectAttachment {
  id: string;
  file: File;
}

interface PersistedDraft {
  to: string;
  subject: string;
  body: string;
  saveToDrive: boolean;
  driveFiles: FileItem[];
}

export interface MailDraft extends PersistedDraft {
  directFiles: DirectAttachment[];
}

const EMPTY: MailDraft = { to: "", subject: "", body: "", saveToDrive: false, driveFiles: [], directFiles: [] };

const draftKey = (userId: string) => `swosh:mail-draft:${userId}`;

let attachmentCounter = 0;
const attachmentId = () => `att-${Date.now().toString(36)}-${(attachmentCounter++).toString(36)}`;

export function clearStoredDraft(userId: string) {
  writeStorage("session", draftKey(userId), null);
}

/**
 * Compose state for the signed-in user. Text fields and Drive attachments persist in
 * sessionStorage per user (device files can't be serialised); leaving with a dirty draft
 * triggers the browser's unsaved-changes prompt.
 */
export function useMailDraft(userId: string) {
  const [draft, setDraft] = useState<MailDraft>(() => {
    const stored = readJson<Partial<PersistedDraft>>("session", draftKey(userId));
    return stored
      ? {
          ...EMPTY,
          to: stored.to ?? "",
          subject: stored.subject ?? "",
          body: stored.body ?? "",
          saveToDrive: Boolean(stored.saveToDrive),
          driveFiles: Array.isArray(stored.driveFiles) ? stored.driveFiles : [],
        }
      : EMPTY;
  });

  const isDirty =
    draft.to.trim() !== "" ||
    draft.subject.trim() !== "" ||
    draft.body.trim() !== "" ||
    draft.directFiles.length > 0 ||
    draft.driveFiles.length > 0;

  useEffect(() => {
    const persisted: PersistedDraft = {
      to: draft.to,
      subject: draft.subject,
      body: draft.body,
      saveToDrive: draft.saveToDrive,
      driveFiles: draft.driveFiles,
    };
    const empty = !persisted.to && !persisted.subject && !persisted.body && persisted.driveFiles.length === 0;
    writeStorage("session", draftKey(userId), empty ? null : JSON.stringify(persisted));
  }, [draft.to, draft.subject, draft.body, draft.saveToDrive, draft.driveFiles, userId]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  const actions = useMemo(
    () => ({
      setField: <K extends "to" | "subject" | "body">(field: K, value: string) => setDraft((d) => ({ ...d, [field]: value })),
      setSaveToDrive: (value: boolean) => setDraft((d) => ({ ...d, saveToDrive: value })),
      addDirectFiles: (files: File[]) =>
        setDraft((d) => ({ ...d, directFiles: [...d.directFiles, ...files.map((file) => ({ id: attachmentId(), file }))] })),
      removeDirectFile: (id: string) => setDraft((d) => ({ ...d, directFiles: d.directFiles.filter((f) => f.id !== id) })),
      removeDirectFiles: (ids: string[]) =>
        setDraft((d) => ({ ...d, directFiles: d.directFiles.filter((f) => !ids.includes(f.id)) })),
      setDriveFiles: (files: FileItem[]) => setDraft((d) => ({ ...d, driveFiles: files })),
      addDriveFiles: (files: FileItem[]) =>
        setDraft((d) => {
          const ids = new Set(d.driveFiles.map((f) => f.id));
          return { ...d, driveFiles: [...d.driveFiles, ...files.filter((f) => !ids.has(f.id))] };
        }),
      removeDriveFiles: (ids: string[]) =>
        setDraft((d) => ({ ...d, driveFiles: d.driveFiles.filter((f) => !ids.includes(f.id)) })),
      reset: () => setDraft(EMPTY),
    }),
    []
  );

  const hasDriveFile = useCallback((id: string) => draft.driveFiles.some((f) => f.id === id), [draft.driveFiles]);

  return { draft, isDirty, hasDriveFile, ...actions };
}

export type MailDraftApi = ReturnType<typeof useMailDraft>;
