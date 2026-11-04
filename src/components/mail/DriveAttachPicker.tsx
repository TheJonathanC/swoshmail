"use client";

import { useState } from "react";
import type { FileItem } from "@/types/api";
import { CloudIcon, FileIcon, FolderIcon, RefreshCwIcon } from "@/components/Icons";
import Breadcrumbs from "@/components/drive/Breadcrumbs";
import Modal from "@/components/ui/Modal";
import { useDriveListing } from "@/hooks/useDriveListing";
import { formatBytes, pluralize } from "@/lib/client/files";

interface DriveAttachPickerProps {
  initialSelected: FileItem[];
  onApply: (files: FileItem[]) => void;
  onClose: () => void;
}

/** Mount only while open. Browses Drive with its own folder state, independent of the Drive tab. */
export default function DriveAttachPicker({ initialSelected, onApply, onClose }: DriveAttachPickerProps) {
  const [folderId, setFolderId] = useState("root");
  const [selected, setSelected] = useState(() => new Map(initialSelected.map((f) => [f.id, f])));
  const listing = useDriveListing(folderId);

  const toggle = (file: FileItem) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(file.id)) next.delete(file.id);
      else next.set(file.id, file);
      return next;
    });

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Attach files from Drive"
      icon={<CloudIcon size={18} />}
      footer={
        <>
          <span className="modal-footer-meta">{pluralize(selected.size, "file")} selected</span>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onApply([...selected.values()]);
              onClose();
            }}
          >
            {selected.size === initialSelected.length && initialSelected.every((f) => selected.has(f.id))
              ? "Done"
              : `Attach ${pluralize(selected.size, "file")}`}
          </button>
        </>
      }
    >
      <Breadcrumbs
        trail={listing.data?.breadcrumbs ?? []}
        currentFolderId={folderId}
        onNavigate={setFolderId}
        linkable={false}
        label="Drive location"
      />
      <div className="picker-list">
        {listing.isLoading && (
          <p className="muted-text" role="status">
            Loading…
          </p>
        )}
        {listing.error && !listing.data && (
          <div className="callout callout-danger" role="alert">
            <span>{listing.error}</span>
            <button type="button" className="btn btn-secondary btn-sm callout-action" onClick={listing.reload}>
              <RefreshCwIcon size={14} /> Retry
            </button>
          </div>
        )}
        {listing.data && listing.data.folders.length === 0 && listing.data.files.length === 0 && (
          <p className="muted-text">This folder is empty.</p>
        )}
        {listing.data?.folders.map((folder) => (
          <button key={folder.id} type="button" className="picker-row" onClick={() => setFolderId(folder.id)}>
            <FolderIcon size={16} className="folder-glyph" />
            <span className="truncate">{folder.name}</span>
            <span className="sr-only">, open folder</span>
          </button>
        ))}
        {listing.data && listing.data.files.length > 0 && (
          <fieldset className="picker-fieldset">
            <legend className="sr-only">Files in this folder</legend>
            {listing.data.files.map((file) => {
              const checked = selected.has(file.id);
              return (
                <label key={file.id} className={`picker-row picker-row-check${checked ? " is-selected" : ""}`}>
                  <input type="checkbox" className="checkbox" checked={checked} onChange={() => toggle(file)} />
                  <FileIcon size={16} />
                  <span className="picker-row-text">
                    <span className="truncate">{file.name}</span>
                    <span className="picker-row-meta">{formatBytes(Number(file.size) || 0)}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
      </div>
    </Modal>
  );
}
