import { ArchiveIcon, CloseIcon, MailIcon, TrashIcon } from "@/components/Icons";
import { pluralize } from "@/lib/client/files";

interface SelectionToolbarProps {
  count: number;
  allSelected: boolean;
  onToggleAll: () => void;
  onZip: () => void;
  zipBusy?: boolean;
  onAttach: () => void;
  onDelete: () => void;
  onClear: () => void;
}

export default function SelectionToolbar({ count, allSelected, onToggleAll, onZip, zipBusy = false, onAttach, onDelete, onClear }: SelectionToolbarProps) {
  return (
    <div className="selection-toolbar" role="region" aria-label="Selected files">
      <div className="selection-info">
        <span className="count-badge" aria-hidden="true">
          {count}
        </span>
        <span className="selection-text" aria-live="polite">
          {pluralize(count, "file")} selected
        </span>
        <button type="button" className="btn-link" onClick={onToggleAll}>
          {allSelected ? "Deselect all" : "Select all"}
        </button>
      </div>
      <div className="selection-actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onZip} disabled={zipBusy} aria-busy={zipBusy || undefined}>
          <ArchiveIcon size={15} />
          <span>Download ZIP</span>
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onAttach}>
          <MailIcon size={15} />
          <span>Attach to email</span>
        </button>
        <button type="button" className="btn btn-danger-outline btn-sm" onClick={onDelete}>
          <TrashIcon size={15} />
          <span>Delete {count}</span>
        </button>
        <button type="button" className="icon-btn icon-btn-sm" aria-label="Clear selection" title="Clear selection" onClick={onClear}>
          <CloseIcon size={16} />
        </button>
      </div>
    </div>
  );
}
