import type { FileItem } from "@/types/api";
import { CloudIcon, PaperclipIcon, TrashIcon } from "@/components/Icons";
import type { DirectAttachment } from "@/hooks/useMailDraft";
import { formatBytes, sumSizes } from "@/lib/client/files";

interface AttachmentListProps {
  directFiles: DirectAttachment[];
  driveFiles: FileItem[];
  onRemoveDirect: (id: string) => void;
  onRemoveDrive: (id: string) => void;
  disabled: boolean;
}

export default function AttachmentList({ directFiles, driveFiles, onRemoveDirect, onRemoveDrive, disabled }: AttachmentListProps) {
  if (directFiles.length === 0 && driveFiles.length === 0) return null;
  return (
    <div className="attachment-groups">
      {directFiles.length > 0 && (
        <section aria-label="Files from this device">
          <h4 className="section-label">
            From this device · {formatBytes(sumSizes(directFiles.map((d) => d.file)))}
          </h4>
          <ul className="attachment-list">
            {directFiles.map(({ id, file }) => (
              <li key={id} className="attachment-item">
                <PaperclipIcon size={16} className="attachment-glyph" />
                <span className="attachment-text">
                  <span className="attachment-name truncate" title={file.name}>
                    {file.name}
                  </span>
                  <span className="attachment-size">{formatBytes(file.size)}</span>
                </span>
                <button
                  type="button"
                  className="icon-btn icon-btn-sm icon-btn-danger"
                  onClick={() => onRemoveDirect(id)}
                  aria-label={`Remove ${file.name}`}
                  title="Remove"
                  disabled={disabled}
                >
                  <TrashIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {driveFiles.length > 0 && (
        <section aria-label="Files from Drive">
          <h4 className="section-label">From Drive · {formatBytes(sumSizes(driveFiles))}</h4>
          <ul className="attachment-list">
            {driveFiles.map((file) => (
              <li key={file.id} className="attachment-item">
                <CloudIcon size={16} className="attachment-glyph" />
                <span className="attachment-text">
                  <span className="attachment-name truncate" title={file.name}>
                    {file.name}
                  </span>
                  <span className="attachment-size">{formatBytes(file.size)}</span>
                </span>
                <button
                  type="button"
                  className="icon-btn icon-btn-sm icon-btn-danger"
                  onClick={() => onRemoveDrive(file.id)}
                  aria-label={`Remove ${file.name}`}
                  title="Remove"
                  disabled={disabled}
                >
                  <TrashIcon size={14} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
