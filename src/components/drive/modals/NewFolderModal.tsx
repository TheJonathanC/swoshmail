"use client";

import { useId, useState, type FormEvent } from "react";
import type { CreateFolderResponse, FolderItem } from "@/types/api";
import { FolderPlusIcon } from "@/components/Icons";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, postJson } from "@/lib/client/api";

interface NewFolderModalProps {
  parentId: string;
  locationName: string;
  onClose: () => void;
  onCreated: (folder: FolderItem) => void;
}

/** Mount only while open so the name field starts empty each time. */
export default function NewFolderModal({ parentId, locationName, onClose, onCreated }: NewFolderModalProps) {
  const toast = useToast();
  const inputId = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a folder name.");
      return;
    }
    if (/[\\/]/.test(trimmed)) {
      setError("Folder names can't contain / or \\.");
      return;
    }
    setBusy(true);
    try {
      const { folder } = await postJson<CreateFolderResponse>("/api/drive/folders", {
        name: trimmed,
        parentId: parentId === "root" ? null : parentId,
      });
      toast("success", "Folder created", `"${folder.name}" was added to ${locationName}.`);
      onCreated(folder);
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Couldn't create the folder."));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      size="sm"
      title="New folder"
      icon={<FolderPlusIcon size={18} />}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" form={`${inputId}-form`} className="btn btn-primary" disabled={busy || !name.trim()}>
            {busy ? <span className="spinner spinner-sm" aria-hidden="true" /> : null}
            {busy ? "Creating…" : "Create folder"}
          </button>
        </>
      }
    >
      <form id={`${inputId}-form`} onSubmit={submit} noValidate>
        <label className="form-label" htmlFor={inputId}>
          Folder name
        </label>
        <input
          id={inputId}
          className="form-input"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError("");
          }}
          placeholder="e.g. Invoices"
          maxLength={60}
          autoComplete="off"
          disabled={busy}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${inputId}-error` : `${inputId}-hint`}
        />
        {error ? (
          <p id={`${inputId}-error`} className="field-error" role="alert">
            {error}
          </p>
        ) : (
          <p id={`${inputId}-hint`} className="input-hint">
            Created in {locationName}.
          </p>
        )}
      </form>
    </Modal>
  );
}
