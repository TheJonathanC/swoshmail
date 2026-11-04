"use client";

import { useState } from "react";
import type { FileDeleteResponse, FileItem } from "@/types/api";
import { FileIcon, TrashIcon } from "@/components/Icons";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, postJson } from "@/lib/client/api";
import { formatBytes, pluralize, sumSizes } from "@/lib/client/files";

interface BatchDeleteModalProps {
  files: FileItem[];
  onClose: () => void;
  onDeleted: (ids: string[], totalUsed: number) => void;
}

const PREVIEW_LIMIT = 6;

export default function BatchDeleteModal({ files, onClose, onDeleted }: BatchDeleteModalProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const label = pluralize(files.length, "file");

  const confirm = async () => {
    setBusy(true);
    try {
      const ids = files.map((f) => f.id);
      const res = await postJson<FileDeleteResponse>("/api/drive/delete", { fileIds: ids });
      toast("success", "Files deleted", `${pluralize(res.deleted ?? ids.length, "file")} permanently deleted.`);
      onDeleted(ids, res.totalUsed);
      onClose();
    } catch (err) {
      toast("danger", "Delete failed", errorMessage(err, "Couldn't delete the selected files."));
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      busy={busy}
      size="sm"
      tone="danger"
      title={`Delete ${label}?`}
      icon={<TrashIcon size={18} />}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-danger" onClick={confirm} disabled={busy}>
            {busy ? <span className="spinner spinner-sm" aria-hidden="true" /> : null}
            {busy ? "Deleting…" : `Delete ${label}`}
          </button>
        </>
      }
    >
      <p className="modal-message">
        These {label} ({formatBytes(sumSizes(files))}) will be permanently deleted from your Drive.
      </p>
      <ul className="item-preview-list">
        {files.slice(0, PREVIEW_LIMIT).map((f) => (
          <li key={f.id} className="item-preview-row">
            <FileIcon size={14} />
            <span className="truncate">{f.name}</span>
            <span className="item-preview-size">{formatBytes(f.size)}</span>
          </li>
        ))}
        {files.length > PREVIEW_LIMIT && <li className="item-preview-more">and {pluralize(files.length - PREVIEW_LIMIT, "more file")}</li>}
      </ul>
      <div className="callout callout-danger" role="note">
        This can&apos;t be undone.
      </div>
    </Modal>
  );
}
