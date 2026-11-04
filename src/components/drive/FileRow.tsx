"use client";

import type { ReactNode } from "react";
import type { FileItem } from "@/types/api";
import { DownloadIcon, EditIcon, EyeIcon, FileIcon, FileTextIcon, MailIcon, ShareIcon, TrashIcon } from "@/components/Icons";
import Menu from "@/components/ui/Menu";
import { fileDownloadUrl } from "@/lib/client/download";
import { formatBytes, formatDate, getPreviewKind, isEditable } from "@/lib/client/files";

export interface FileRowActions {
  onPreview: (file: FileItem) => void;
  onEdit: (file: FileItem) => void;
  onShare: (file: FileItem) => void;
  onAttach: (file: FileItem) => void;
  onDelete: (file: FileItem) => void;
}

interface FileRowProps extends FileRowActions {
  file: FileItem;
  selected: boolean;
  onToggle: (id: string) => void;
}

interface RowAction {
  id: string;
  label: string;
  icon: ReactNode;
  run: () => void;
  danger?: boolean;
}

export default function FileRow({ file, selected, onToggle, onPreview, onEdit, onShare, onAttach, onDelete }: FileRowProps) {
  const kind = getPreviewKind(file.name);
  const date = formatDate(file.uploaded_at);
  const size = formatBytes(file.size);

  const actions: RowAction[] = [
    ...(kind !== "none" ? [{ id: "preview", label: `Preview ${file.name}`, icon: <EyeIcon size={16} />, run: () => onPreview(file) }] : []),
    ...(isEditable(file.name) ? [{ id: "edit", label: `Edit ${file.name}`, icon: <EditIcon size={16} />, run: () => onEdit(file) }] : []),
    { id: "share", label: `Share ${file.name}`, icon: <ShareIcon size={16} />, run: () => onShare(file) },
    { id: "attach", label: `Attach ${file.name} to an email`, icon: <MailIcon size={16} />, run: () => onAttach(file) },
    { id: "delete", label: `Delete ${file.name}`, icon: <TrashIcon size={16} />, run: () => onDelete(file), danger: true },
  ];

  const menuLabels: Record<string, string> = {
    preview: "Preview",
    edit: "Edit note",
    share: "Share",
    attach: "Attach to email",
    delete: "Delete",
  };

  const renderInline = (action: RowAction) => (
    <button
      key={action.id}
      type="button"
      className={`icon-btn icon-btn-sm row-action-secondary${action.danger ? " icon-btn-danger" : ""}`}
      aria-label={action.label}
      title={menuLabels[action.id]}
      onClick={action.run}
    >
      {action.icon}
    </button>
  );

  return (
    <tr className={`file-row${selected ? " is-selected" : ""}`}>
      <td className="col-select">
        <input
          type="checkbox"
          className="checkbox"
          checked={selected}
          onChange={() => onToggle(file.id)}
          aria-label={`Select ${file.name}`}
        />
      </td>
      <td className="col-name">
        <div className="file-cell">
          <span className="file-glyph" aria-hidden="true">
            {kind === "text" ? <FileTextIcon size={18} /> : <FileIcon size={18} />}
          </span>
          <div className="file-cell-text">
            {kind !== "none" ? (
              <button type="button" className="file-name-btn truncate" onClick={() => onPreview(file)} title={file.name}>
                {file.name}
              </button>
            ) : (
              <span className="file-name truncate" title={file.name}>
                {file.name}
              </span>
            )}
            <span className="file-meta-mobile">
              {size} · {date}
            </span>
          </div>
        </div>
      </td>
      <td className="col-size">{size}</td>
      <td className="col-date">{date}</td>
      <td className="col-actions">
        <div className="row-actions">
          {actions.filter((a) => !a.danger).map(renderInline)}
          <a
            className="icon-btn icon-btn-sm"
            href={fileDownloadUrl(file.id)}
            download={file.name}
            aria-label={`Download ${file.name}`}
            title="Download"
          >
            <DownloadIcon size={16} />
          </a>
          {actions.filter((a) => a.danger).map(renderInline)}
          <span className="row-more">
            <Menu
              label={`More actions for ${file.name}`}
              triggerClassName="icon-btn icon-btn-sm"
              items={actions.map((action) => ({
                id: action.id,
                label: menuLabels[action.id],
                icon: action.icon,
                onSelect: action.run,
                tone: action.danger ? "danger" : "default",
              }))}
            />
          </span>
        </div>
      </td>
    </tr>
  );
}
