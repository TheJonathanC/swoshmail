"use client";

import { useState } from "react";
import type { DriveListResponse } from "@/types/api";
import { FolderIcon, RefreshCwIcon } from "@/components/Icons";
import { useDriveListing } from "@/hooks/useDriveListing";
import Breadcrumbs from "./Breadcrumbs";

interface FolderPickerProps {
  initialFolderId: string;
  onChange: (folderId: string, path: string) => void;
  label: string;
}

export function folderPath(data: DriveListResponse | null, folderId: string): string {
  if (folderId === "root" || !data) return "Drive";
  return ["Drive", ...data.breadcrumbs.map((b) => b.name)].join(" / ");
}

/** Lets the user browse their own folders to choose a destination. */
export default function FolderPicker({ initialFolderId, onChange, label }: FolderPickerProps) {
  const [folderId, setFolderId] = useState(initialFolderId);
  const listing = useDriveListing(folderId, {
    onLoaded: (data) => onChange(folderId, folderPath(data, folderId)),
  });
  const go = (id: string) => setFolderId(id);

  return (
    <div className="folder-picker" role="group" aria-label={label}>
      <Breadcrumbs
        trail={listing.data?.breadcrumbs ?? []}
        currentFolderId={folderId}
        onNavigate={go}
        linkable={false}
        label={`${label} path`}
      />
      <div className="folder-picker-list">
        {listing.isLoading && <p className="muted-text">Loading folders…</p>}
        {listing.error && (
          <div className="callout callout-danger">
            <span>{listing.error}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={listing.reload}>
              <RefreshCwIcon size={14} /> Retry
            </button>
          </div>
        )}
        {listing.data && listing.data.folders.length === 0 && <p className="muted-text">No subfolders here.</p>}
        {listing.data?.folders.map((folder) => (
          <button key={folder.id} type="button" className="picker-row" onClick={() => go(folder.id)}>
            <FolderIcon size={16} className="folder-glyph" />
            <span className="truncate">{folder.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
