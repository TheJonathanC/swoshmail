"use client";

import { useEffect, useState } from "react";
import type { FileItem, TextPreviewResponse } from "@/types/api";
import { AlertCircleIcon, DownloadIcon, EditIcon, FileIcon, LinkIcon, ShareIcon } from "@/components/Icons";
import Modal from "@/components/ui/Modal";
import { errorMessage, getJson, isAbortError, withQuery } from "@/lib/client/api";
import { fileDownloadUrl, fileInlineUrl } from "@/lib/client/download";
import { formatBytes, formatDate, getPreviewKind, isEditable } from "@/lib/client/files";

interface PreviewModalProps {
  file: FileItem;
  onClose: () => void;
  onEdit: (file: FileItem, content?: string) => void;
  onShare: (file: FileItem) => void;
}

export default function PreviewModal({ file, onClose, onEdit, onShare }: PreviewModalProps) {
  const kind = getPreviewKind(file.name);
  const [text, setText] = useState<{ data: TextPreviewResponse | null; error: string | null } | null>(null);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    if (kind !== "text") return;
    const controller = new AbortController();
    getJson<TextPreviewResponse>(withQuery("/api/drive/preview", { fileId: file.id }), controller.signal)
      .then((data) => setText({ data, error: null }))
      .catch((err: unknown) => {
        if (!isAbortError(err)) setText({ data: null, error: errorMessage(err, "Couldn't load a preview of this file.") });
      });
    return () => controller.abort();
  }, [file.id, kind]);

  const failed = (kind === "image" && imageFailed) || (kind === "text" && text?.error);

  let body;
  if (failed) {
    body = (
      <div className="preview-error" role="alert">
        <AlertCircleIcon size={28} />
        <p>{kind === "text" && text?.error ? text.error : "This image couldn't be displayed."}</p>
        <p className="muted-text">You can still download the file to open it on your device.</p>
      </div>
    );
  } else if (kind === "image") {
    body = (
      <div className="preview-frame">
        {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API stream; next/image can't forward the session cookie */}
        <img
          src={fileInlineUrl(file.id)}
          alt={`Preview of ${file.name}`}
          className="preview-image"
          loading="lazy"
          decoding="async"
          onError={() => setImageFailed(true)}
        />
      </div>
    );
  } else if (kind === "text") {
    body = !text ? (
      <div className="preview-loading" role="status">
        <span className="spinner" aria-hidden="true" /> Loading preview…
      </div>
    ) : (
      <>
        <pre className="preview-text" tabIndex={0} aria-label={`Contents of ${file.name}`}>
          {text.data?.content}
        </pre>
        {text.data?.truncated && <p className="input-hint">Showing the first part of this file. Download it to see everything.</p>}
      </>
    );
  } else if (kind === "pdf") {
    body = (
      <div className="preview-error">
        <FileIcon size={28} />
        <p>PDF files open in a new browser tab.</p>
        <a className="btn btn-secondary" href={fileInlineUrl(file.id)} target="_blank" rel="noopener noreferrer">
          <LinkIcon size={15} /> Open PDF
        </a>
      </div>
    );
  } else {
    body = (
      <div className="preview-error">
        <FileIcon size={28} />
        <p>There&apos;s no preview for this file type.</p>
      </div>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={file.name}
      icon={<FileIcon size={18} />}
      footer={
        <>
          <span className="modal-footer-meta">
            {formatBytes(file.size)} · {formatDate(file.uploaded_at)}
          </span>
          {isEditable(file.name) && !failed && (
            <button type="button" className="btn btn-secondary" onClick={() => onEdit(file, text?.data && !text.data.truncated ? text.data.content : undefined)}>
              <EditIcon size={15} /> Edit
            </button>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => onShare(file)}>
            <ShareIcon size={15} /> Share
          </button>
          <a className="btn btn-primary" href={fileDownloadUrl(file.id)} download={file.name}>
            <DownloadIcon size={15} /> Download
          </a>
        </>
      }
    >
      {body}
    </Modal>
  );
}
