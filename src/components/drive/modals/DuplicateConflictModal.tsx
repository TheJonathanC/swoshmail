import { ArrowRightIcon, RefreshCwIcon } from "@/components/Icons";
import Modal from "@/components/ui/Modal";
import type { ConflictChoice, ConflictPrompt } from "@/hooks/useDriveUploads";
import { formatBytes, formatDate, pluralize } from "@/lib/client/files";

export default function DuplicateConflictModal({ conflict, onChoose }: { conflict: ConflictPrompt; onChoose: (c: ConflictChoice) => void }) {
  const more = conflict.remaining > 0;
  return (
    <Modal
      open
      onClose={() => onChoose("cancel-all")}
      dismissOnOverlay={false}
      size="md"
      tone="warning"
      title="A file with this name already exists"
      icon={<RefreshCwIcon size={18} />}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => onChoose("cancel-all")}>
            {more ? "Cancel all uploads" : "Cancel upload"}
          </button>
          {more && (
            <button type="button" className="btn btn-secondary" onClick={() => onChoose("skip")}>
              Skip this file
            </button>
          )}
        </>
      }
    >
      <p className="modal-message">
        <strong className="break-anywhere">{conflict.fileName}</strong> is already in this folder.
        {more ? ` ${pluralize(conflict.remaining, "more file")} waiting after this one.` : ""}
      </p>
      <div className="compare-row" aria-label="Size comparison">
        <div>
          <span className="compare-label">Existing</span>
          <span className="compare-value">{formatBytes(conflict.existing.size)}</span>
          <span className="compare-sub">{formatDate(conflict.existing.uploaded_at)}</span>
        </div>
        <ArrowRightIcon size={16} className="compare-arrow" />
        <div className="compare-new">
          <span className="compare-label">New</span>
          <span className="compare-value">{formatBytes(conflict.newSize)}</span>
        </div>
      </div>
      <div className="choice-list">
        <button type="button" className="choice-card choice-card-danger" onClick={() => onChoose("replace")}>
          <span className="choice-card-text">
            <span className="choice-card-title">Replace existing</span>
            <span className="choice-card-desc">The current file is overwritten. Its share links keep working.</span>
          </span>
        </button>
        <button type="button" className="choice-card choice-card-primary" onClick={() => onChoose("keep-both")}>
          <span className="choice-card-text">
            <span className="choice-card-title break-anywhere">Keep both — save as {conflict.keepBothName}</span>
            <span className="choice-card-desc">The existing file stays as it is.</span>
          </span>
        </button>
      </div>
    </Modal>
  );
}
