import { useId } from "react";
import { AlertTriangleIcon } from "@/components/Icons";
import { formatBytes } from "@/lib/client/files";

export const QUOTA_WARNING_RATIO = 0.85;

interface QuotaBarProps {
  used: number;
  quota: number;
  /** "full" shows label + bar + warning, "compact" a single line (mobile header / Drive title). */
  variant?: "full" | "compact";
  loaded?: boolean;
}

export default function QuotaBar({ used, quota, variant = "full", loaded = true }: QuotaBarProps) {
  const labelId = useId();
  const ratio = quota > 0 ? Math.min(used / quota, 1) : 0;
  const percent = Math.round(ratio * 100);
  const level = ratio >= 1 ? "full" : ratio >= QUOTA_WARNING_RATIO ? "warning" : ratio >= 0.6 ? "notice" : "ok";
  const text = loaded ? `${formatBytes(used)} of ${formatBytes(quota)} used` : "Checking storage…";

  if (variant === "compact") {
    return (
      <span className={`quota-pill quota-${level}`} title={`Drive storage: ${text}`}>
        {level === "warning" || level === "full" ? <AlertTriangleIcon size={12} /> : null}
        <span className="sr-only">Drive storage: </span>
        {loaded ? `${formatBytes(used)} / ${formatBytes(quota)}` : "…"}
      </span>
    );
  }

  return (
    <div className={`quota-tracker quota-${level}`}>
      <div className="quota-label-row">
        <span id={labelId} className="quota-label">
          Drive storage
        </span>
        <span>{loaded ? `${percent}%` : ""}</span>
      </div>
      <div
        className="quota-bar"
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={quota || 1}
        aria-valuenow={loaded ? used : undefined}
        aria-valuetext={text}
      >
        <div className="quota-bar-fill" style={{ width: `${percent}%` }} />
      </div>
      <p className="quota-text">{text}</p>
      {loaded && (level === "warning" || level === "full") && (
        <p className="quota-warning">
          <AlertTriangleIcon size={14} />
          {level === "full" ? "Storage is full. Delete files to upload more." : "Storage is almost full."}
        </p>
      )}
    </div>
  );
}
