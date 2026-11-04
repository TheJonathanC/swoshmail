import type { MouseEvent } from "react";
import type { FolderItem } from "@/types/api";
import { DownloadIcon, FolderIcon, TrashIcon } from "@/components/Icons";
import { buildWorkspaceUrl } from "@/hooks/useUrlState";

interface FolderGridProps {
  folders: FolderItem[];
  onOpen: (folderId: string) => void;
  onZip: (folder: FolderItem) => void;
  onDelete: (folder: FolderItem) => void;
}

export default function FolderGrid({ folders, onOpen, onZip, onDelete }: FolderGridProps) {
  if (folders.length === 0) return null;
  const open = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    onOpen(id);
  };
  return (
    <ul className="folder-grid" aria-label="Folders">
      {folders.map((folder) => (
        <li key={folder.id} className="folder-card">
          <a
            className="folder-open"
            href={buildWorkspaceUrl({ tab: "drive", folderId: folder.id, shareToken: null })}
            onClick={(e) => open(e, folder.id)}
            title={folder.name}
          >
            <FolderIcon size={20} className="folder-glyph" />
            <span className="folder-name truncate">{folder.name}</span>
          </a>
          <div className="folder-card-actions">
            <button
              type="button"
              className="icon-btn icon-btn-sm"
              aria-label={`Download folder ${folder.name} as ZIP`}
              title="Download as ZIP"
              onClick={() => onZip(folder)}
            >
              <DownloadIcon size={14} />
            </button>
            <button
              type="button"
              className="icon-btn icon-btn-sm icon-btn-danger"
              aria-label={`Delete folder ${folder.name}`}
              title="Delete folder"
              onClick={() => onDelete(folder)}
            >
              <TrashIcon size={14} />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
