"use client";

import { useState } from "react";
import type { FileItem } from "@/types/api";
import { AlertCircleIcon, CloudIcon, DownloadIcon, FileIcon, FolderIcon, LinkIcon } from "@/components/Icons";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useSharedLink } from "@/hooks/useSharedLink";
import { errorMessage } from "@/lib/client/api";
import { sharedDownloadUrl, sharedPreviewUrl } from "@/lib/client/download";
import { formatBytes, formatDate } from "@/lib/client/files";
import FolderPicker from "../FolderPicker";

interface SharedFileModalProps {
  token: string;
  initialFolderId: string;
  initialFolderPath: string;
  onClose: () => void;
  onSaved: (file: FileItem, totalUsed: number) => void;
}

export default function SharedFileModal({ token, initialFolderId, initialFolderPath, onClose, onSaved }: SharedFileModalProps) {
  const toast = useToast();
  const { loading, info, text, error, save } = useSharedLink(token);
  const [destination, setDestination] = useState({ id: initialFolderId, path: initialFolderPath });
  const [choosing, setChoosing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const onSave = async () => {
    setSaving(true);
    try {
      const res = await save(destination.id);
      toast("success", "Saved to your Drive", `${res.file.name} was saved to ${destination.path}.`);
      onSaved({ ...res.file, size: Number(res.file.size) || 0 }, res.totalUsed);
      onClose();
    } catch (err) {
      toast("danger", "Couldn't save", errorMessage(err, "Couldn't save this file to your Drive."));
      setSaving(false);
    }
  };

  let body;
  if (loading) {
    body = (
      <div className="preview-loading" role="status">
        <span className="spinner" aria-hidden="true" /> Opening shared file…
      </div>
    );
  } else if (error || !info) {
    body = (
      <div className="preview-error" role="alert">
        <AlertCircleIcon size={28} />
        <p className="preview-error-title">This link can&apos;t be opened</p>
        <p className="muted-text">{error ?? "The link may have expired or been revoked. Ask the sender for a new one."}</p>
      </div>
    );
  } else {
    body = (
      <>
        <div className="file-summary">
          <FileIcon size={22} />
          <div className="file-summary-text">
            <span className="file-summary-name truncate" title={info.name}>
              {info.name}
            </span>
            <span className="file-summary-meta">
              {formatBytes(info.size)} · Shared by @{info.owner_username}
              {info.expires_at ? ` · Link expires ${formatDate(info.expires_at)}` : ""}
            </span>
          </div>
        </div>

        {info.previewKind === "image" && !imageFailed && (
          <div className="preview-frame preview-frame-sm">
            {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API stream; next/image can't forward the session cookie */}
            <img
              src={sharedPreviewUrl(token)}
              alt={`Preview of ${info.name}`}
              className="preview-image"
              loading="lazy"
              decoding="async"
              onError={() => setImageFailed(true)}
            />
          </div>
        )}
        {info.previewKind === "text" && text && (
          <pre className="preview-text preview-text-sm" tabIndex={0} aria-label={`Contents of ${info.name}`}>
            {text.content}
          </pre>
        )}
        {info.previewKind === "pdf" && (
          <a className="btn btn-secondary btn-sm" href={sharedPreviewUrl(token)} target="_blank" rel="noopener noreferrer">
            <LinkIcon size={14} /> Open PDF in a new tab
          </a>
        )}

        <div className="destination">
          <div className="destination-row">
            <FolderIcon size={16} className="folder-glyph" />
            <span className="destination-text">
              <span className="section-label">Save to</span>
              <span className="truncate">{destination.path}</span>
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setChoosing((c) => !c)} aria-expanded={choosing}>
              {choosing ? "Done" : "Change"}
            </button>
          </div>
          {choosing && (
            <FolderPicker
              label="Destination folder"
              initialFolderId={destination.id}
              onChange={(id, path) => setDestination({ id, path })}
            />
          )}
        </div>
      </>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      busy={saving}
      size="md"
      title="Shared with you"
      icon={<LinkIcon size={18} />}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>
            Close
          </button>
          {info && !error && (
            <>
              <a className="btn btn-secondary" href={sharedDownloadUrl(token)} download={info.name}>
                <DownloadIcon size={15} /> Download
              </a>
              <button type="button" className="btn btn-primary" onClick={() => void onSave()} disabled={saving}>
                {saving ? <span className="spinner spinner-sm" aria-hidden="true" /> : <CloudIcon size={15} />}
                {saving ? "Saving…" : "Save to my Drive"}
              </button>
            </>
          )}
        </>
      }
    >
      {body}
    </Modal>
  );
}
