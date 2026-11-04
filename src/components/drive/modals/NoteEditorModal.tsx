"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { AlertCircleIcon, CheckIcon, FileTextIcon, SaveIcon } from "@/components/Icons";
import Modal, { ConfirmModal } from "@/components/ui/Modal";
import type { useNoteEditor } from "@/hooks/useNoteEditor";
import { MAX_NOTE_BYTES } from "@/hooks/useNoteEditor";
import { formatBytes, getExtension } from "@/lib/client/files";

type NoteEditor = ReturnType<typeof useNoteEditor>;

const INDENT = "  ";

export default function NoteEditorModal({ editor, locationName }: { editor: NoteEditor; locationName: string }) {
  const ids = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // While true, Tab inserts spaces. Esc / Ctrl+M release it so keyboard users can leave (WCAG 2.1.2).
  const [tabInserts, setTabInserts] = useState(true);
  const [announcement, setAnnouncement] = useState("");

  const lines = editor.content ? editor.content.split("\n").length : 0;
  const words = editor.content.trim() ? editor.content.trim().split(/\s+/).length : 0;
  const tooLarge = editor.byteSize > MAX_NOTE_BYTES;
  const ext = getExtension(editor.name) || "txt";

  const setTabMode = (inserts: boolean) => {
    setTabInserts(inserts);
    setAnnouncement(inserts ? "Tab inserts spaces." : "Tab now moves focus out of the editor.");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void editor.save();
      return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "m") {
      e.preventDefault();
      setTabMode(!tabInserts);
      return;
    }
    if (e.key === "Escape" && tabInserts) {
      // First Esc releases the Tab trap; the next one closes the dialog
      // React's listener and the dialog's Esc listener can share the same node, so stop both paths
      e.preventDefault();
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      setTabMode(false);
      return;
    }
    if (e.key === "Tab" && !e.shiftKey && tabInserts && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const el = e.currentTarget;
      const { selectionStart: start, selectionEnd: end, value } = el;
      editor.setContent(value.slice(0, start) + INDENT + value.slice(end));
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + INDENT.length;
      });
    }
  };

  return (
    <>
      <Modal
        open={editor.open}
        onClose={editor.requestClose}
        busy={editor.saving}
        dismissOnOverlay={false}
        size="xl"
        className="note-editor"
        bodyClassName="note-editor-body"
        initialFocusRef={textareaRef}
        title={editor.file ? "Edit note" : "New note"}
        icon={<FileTextIcon size={18} />}
        footer={
          <>
            <span className="modal-footer-meta">Saved in {locationName}</span>
            <button type="button" className="btn btn-secondary" onClick={editor.requestClose} disabled={editor.saving}>
              Close
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void editor.save()}
              disabled={editor.saving || editor.loading || Boolean(editor.loadError) || tooLarge}
            >
              {editor.saving ? <span className="spinner spinner-sm" aria-hidden="true" /> : <SaveIcon size={15} />}
              {editor.saving ? "Saving…" : editor.file ? "Save changes" : "Save note"}
            </button>
          </>
        }
      >
        <div className="note-meta-row">
          <div className="note-name-field">
            <label className="form-label" htmlFor={`${ids}-name`}>
              File name
            </label>
            <div className="note-name-input-row">
              <input
                id={`${ids}-name`}
                className="form-input form-input-mono"
                value={editor.name}
                onChange={(e) => editor.setName(e.target.value)}
                placeholder="notes.txt"
                disabled={editor.saving}
                autoComplete="off"
                spellCheck={false}
              />
              <span className="tag tag-mono" aria-hidden="true">
                {ext}
              </span>
            </div>
          </div>
          <span className={`status-pill ${editor.isDirty ? "status-warning" : "status-success"}`} aria-live="polite">
            {editor.isDirty ? (
              "Unsaved changes"
            ) : (
              <>
                <CheckIcon size={13} /> Saved
              </>
            )}
          </span>
        </div>

        <div className="note-stats" aria-label="Note statistics">
          <span>
            {lines} lines · {words} words · {editor.content.length} characters · {formatBytes(editor.byteSize)}
          </span>
        </div>

        <label className="sr-only" htmlFor={`${ids}-content`}>
          Note contents
        </label>
        <div className="note-textarea-wrap">
          {editor.loading ? (
            <div className="preview-loading" role="status">
              <span className="spinner" aria-hidden="true" /> Loading note…
            </div>
          ) : editor.loadError ? (
            <div className="preview-error" role="alert">
              <AlertCircleIcon size={24} />
              <p>{editor.loadError}</p>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              id={`${ids}-content`}
              className="note-textarea"
              value={editor.content}
              onChange={(e) => editor.setContent(e.target.value)}
              onKeyDown={onKeyDown}
              onFocus={() => setTabInserts(true)}
              placeholder="Type notes, code snippets or anything else…"
              disabled={editor.saving}
              spellCheck={false}
              aria-describedby={`${ids}-hint`}
            />
          )}
        </div>
        <p id={`${ids}-hint`} className="input-hint note-hint">
          <kbd>Ctrl</kbd>+<kbd>S</kbd> saves. <kbd>Tab</kbd> inserts spaces; press <kbd>Esc</kbd> or <kbd>Ctrl</kbd>+<kbd>M</kbd> first to
          move focus with <kbd>Tab</kbd>. <kbd>Shift</kbd>+<kbd>Tab</kbd> always moves focus back.
        </p>
        {tooLarge && (
          <div className="callout callout-danger" role="alert">
            Notes can be up to {formatBytes(MAX_NOTE_BYTES)}. This one is {formatBytes(editor.byteSize)}.
          </div>
        )}
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
      </Modal>

      <ConfirmModal
        open={editor.confirmDiscard}
        title="Discard unsaved changes?"
        message={
          <>
            Your changes to <strong className="break-anywhere">{editor.name}</strong> haven&apos;t been saved.
          </>
        }
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={editor.discard}
        onCancel={editor.keepEditing}
      />
    </>
  );
}
