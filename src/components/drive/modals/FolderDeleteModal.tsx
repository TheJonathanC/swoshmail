"use client";

import { useEffect, useState } from "react";
import type { FolderDeletePreview, FolderDeleteResponse, FolderItem } from "@/types/api";
import { TrashIcon } from "@/components/Icons";
import { ConfirmModal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, getJson, isAbortError, postJson, withQuery } from "@/lib/client/api";
import { formatBytes, pluralize } from "@/lib/client/files";

interface FolderDeleteModalProps {
  folder: FolderItem;
  onClose: () => void;
  onDeleted: (folderId: string, totalUsed: number) => void;
}

export default function FolderDeleteModal({ folder, onClose, onDeleted }: FolderDeleteModalProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ data: FolderDeletePreview | null; failed: boolean } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getJson<FolderDeletePreview>(withQuery("/api/drive/folders/delete", { folderId: folder.id }), controller.signal)
      .then((data) => setPreview({ data, failed: false }))
      .catch((err: unknown) => {
        if (!isAbortError(err)) setPreview({ data: null, failed: true });
      });
    return () => controller.abort();
  }, [folder.id]);

  const confirm = async () => {
    setBusy(true);
    try {
      const res = await postJson<FolderDeleteResponse>("/api/drive/folders/delete", { folderId: folder.id });
      toast(
        "success",
        "Folder deleted",
        `"${folder.name}" was deleted with ${pluralize(res.deletedFiles ?? 0, "file")} and ${pluralize(res.deletedFolders ?? 0, "subfolder")}.`
      );
      onDeleted(folder.id, res.totalUsed);
      onClose();
    } catch (err) {
      toast("danger", "Delete failed", errorMessage(err, `Couldn't delete "${folder.name}".`));
      setBusy(false);
    }
  };

  let contents: string;
  if (!preview) contents = "Counting what's inside…";
  else if (!preview.data) contents = "Everything inside it (files and subfolders) will be deleted too.";
  else if (preview.data.files === 0 && preview.data.folders === 0) contents = "The folder is empty.";
  else
    contents = `It contains ${pluralize(preview.data.files, "file")} and ${pluralize(preview.data.folders, "subfolder")} (${formatBytes(
      preview.data.bytes
    )}). All of it will be deleted.`;

  return (
    <ConfirmModal
      open
      title="Delete folder?"
      icon={<TrashIcon size={18} />}
      message={
        <>
          <p>
            <strong className="break-anywhere">{folder.name}</strong> will be permanently deleted.
          </p>
          <p className="muted-text" aria-live="polite">
            {contents}
          </p>
        </>
      }
      warning="This can't be undone."
      confirmLabel="Delete folder"
      busy={busy}
      onConfirm={confirm}
      onCancel={onClose}
    />
  );
}
