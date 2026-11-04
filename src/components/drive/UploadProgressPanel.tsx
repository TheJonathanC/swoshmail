import type { UploadProgress } from "@/hooks/useDriveUploads";
import { CloseIcon } from "@/components/Icons";

export default function UploadProgressPanel({ progress, onCancel }: { progress: UploadProgress; onCancel: () => void }) {
  const current = Math.min(progress.done + 1, progress.total);
  const overall = progress.total > 0 ? (progress.done + progress.fraction) / progress.total : 0;
  const percent = Math.round(overall * 100);
  const label = progress.total > 1 ? `Uploading ${current} of ${progress.total}` : "Uploading";

  return (
    <div className="upload-panel" role="region" aria-label="Upload progress">
      <div className="upload-panel-row">
        <div className="upload-panel-text">
          <span className="upload-panel-title">{label}</span>
          <span className="upload-panel-file truncate">{progress.currentName}</span>
        </div>
        <span className="upload-panel-percent" aria-hidden="true">
          {percent}%
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          <CloseIcon size={14} /> Cancel
        </button>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={`${label}: ${progress.currentName}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
