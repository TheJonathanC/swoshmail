"use client";

import { useState } from "react";
import type { FileDeleteResponse, FileItem } from "@/types/api";
import { TrashIcon } from "@/components/Icons";
import { ConfirmModal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, postJson } from "@/lib/client/api";

interface FileDeleteModalProps {
  file: FileItem;
  onClose: () => void;
  onDeleted: (ids: string[], totalUsed: number) => void;
}

export default function FileDeleteModal({ file, onClose, onDeleted }: FileDeleteModalProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      const res = await postJson<FileDeleteResponse>("/api/drive/delete", { fileIds: [file.id] });
      toast("success", "File deleted", `${file.name} was permanently deleted.`);
      onDeleted([file.id], res.totalUsed);
      onClose();
    } catch (err) {
      toast("danger", "Delete failed", errorMessage(err, `Couldn't delete ${file.name}.`));
      setBusy(false);
    }
  };

  return (
    <ConfirmModal
      open
      title="Delete file?"
      icon={<TrashIcon size={18} />}
      message={
        <>
          <strong className="break-anywhere">{file.name}</strong> will be permanently deleted from your Drive.
        </>
      }
      warning="This can't be undone. Share links to this file will stop working."
      confirmLabel="Delete file"
      busy={busy}
      onConfirm={confirm}
      onCancel={onClose}
    />
  );
}
