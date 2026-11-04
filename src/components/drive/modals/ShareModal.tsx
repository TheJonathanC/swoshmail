"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import type { CreateShareResponse, FileItem, ListSharesResponse, ShareItem } from "@/types/api";
import { CheckIcon, CopyIcon, FileIcon, LinkIcon, LockIcon, ShareIcon, TrashIcon } from "@/components/Icons";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { errorMessage, getJson, isAbortError, postJson, sendJson, withQuery } from "@/lib/client/api";
import { formatBytes, formatDate } from "@/lib/client/files";

const EXPIRY_OPTIONS: { value: string; label: string; days: number | null }[] = [
  { value: "1", label: "1 day", days: 1 },
  { value: "7", label: "7 days", days: 7 },
  { value: "30", label: "30 days", days: 30 },
  { value: "never", label: "Never", days: null },
];

function audienceText(share: Pick<ShareItem, "recipient_username">) {
  return share.recipient_username
    ? `Only @${share.recipient_username} can open this link after signing in to Swosh.`
    : "Anyone signed in to Swosh with this link can view, download and save a copy of this file.";
}

function expiryText(expiresAt: string | null) {
  return expiresAt ? `Expires ${formatDate(expiresAt)}` : "Never expires";
}

export default function ShareModal({ file, onClose }: { file: FileItem; onClose: () => void }) {
  const toast = useToast();
  const ids = useId();
  const [recipient, setRecipient] = useState("");
  const [expiry, setExpiry] = useState("7");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<ShareItem | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [list, setList] = useState<{ shares: ShareItem[]; error: string | null } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getJson<ListSharesResponse>(withQuery("/api/drive/share", { fileId: file.id }), controller.signal)
      .then((data) => setList({ shares: data.shares ?? [], error: null }))
      .catch((err: unknown) => {
        if (!isAbortError(err)) setList({ shares: [], error: errorMessage(err, "Couldn't load existing links.") });
      });
    return () => controller.abort();
  }, [file.id]);

  const copy = async (share: ShareItem) => {
    try {
      await navigator.clipboard.writeText(share.url);
      setCopiedId(share.id);
      toast("success", "Link copied", "The share link is on your clipboard.");
      window.setTimeout(() => setCopiedId((id) => (id === share.id ? null : id)), 2500);
    } catch {
      toast("danger", "Couldn't copy", "Select the link and copy it manually.");
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const days = EXPIRY_OPTIONS.find((o) => o.value === expiry)?.days ?? null;
      const { share } = await postJson<CreateShareResponse>("/api/drive/share", {
        fileId: file.id,
        recipient: recipient.trim().replace(/^@/, "") || undefined,
        expiresInDays: days,
      });
      setCreated(share);
      setList((l) => ({ shares: [share, ...(l?.shares ?? []).filter((s) => s.id !== share.id)], error: l?.error ?? null }));
      setRecipient("");
    } catch (err) {
      toast("danger", "Couldn't create link", errorMessage(err, "Couldn't create a share link."));
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (share: ShareItem) => {
    setRevoking(share.id);
    try {
      await sendJson<{ success: true }>("/api/drive/share", "DELETE", { shareId: share.id });
      setList((l) => (l ? { ...l, shares: l.shares.filter((s) => s.id !== share.id) } : l));
      if (created?.id === share.id) setCreated(null);
      toast("success", "Link revoked", "That link no longer opens the file.");
    } catch (err) {
      toast("danger", "Couldn't revoke link", errorMessage(err, "Couldn't revoke the link."));
    } finally {
      setRevoking(null);
    }
  };

  const recipientTrimmed = recipient.trim().replace(/^@/, "");

  return (
    <Modal open onClose={onClose} size="md" title="Share file" icon={<ShareIcon size={18} />} busy={creating}
      footer={
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={creating}>
          Done
        </button>
      }
    >
      <div className="file-summary">
        <FileIcon size={20} />
        <div className="file-summary-text">
          <span className="file-summary-name truncate" title={file.name}>
            {file.name}
          </span>
          <span className="file-summary-meta">{formatBytes(file.size)}</span>
        </div>
      </div>

      <form className="share-form" onSubmit={create}>
        <div className="form-group">
          <label className="form-label" htmlFor={`${ids}-recipient`}>
            Share with (optional)
          </label>
          <input
            id={`${ids}-recipient`}
            className="form-input"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Swosh username, e.g. alex"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby={`${ids}-audience`}
            disabled={creating}
          />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor={`${ids}-expiry`}>
            Link expires after
          </label>
          <select id={`${ids}-expiry`} className="form-input form-select" value={expiry} onChange={(e) => setExpiry(e.target.value)} disabled={creating}>
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <p id={`${ids}-audience`} className="callout callout-info">
          <LockIcon size={15} />
          <span>{audienceText({ recipient_username: recipientTrimmed || null })}</span>
        </p>
        <button type="submit" className="btn btn-primary" disabled={creating}>
          {creating ? <span className="spinner spinner-sm" aria-hidden="true" /> : <LinkIcon size={15} />}
          {creating ? "Creating link…" : "Create link"}
        </button>
      </form>

      {created && (
        <div className="share-created" role="status">
          <label className="form-label" htmlFor={`${ids}-url`}>
            New link
          </label>
          <div className="share-url-row">
            <input id={`${ids}-url`} className="form-input form-input-mono" readOnly value={created.url} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn btn-primary" onClick={() => void copy(created)}>
              {copiedId === created.id ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
              {copiedId === created.id ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="input-hint">
            {audienceText(created)} {expiryText(created.expires_at)}.
          </p>
        </div>
      )}

      <section className="share-list" aria-labelledby={`${ids}-active`}>
        <h4 id={`${ids}-active`} className="section-label">
          Active links
        </h4>
        {!list && <p className="muted-text">Loading links…</p>}
        {list?.error && <p className="field-error">{list.error}</p>}
        {list && !list.error && list.shares.length === 0 && <p className="muted-text">No active links. Nobody else can open this file.</p>}
        {list && list.shares.length > 0 && (
          <ul className="share-items">
            {list.shares.map((share) => (
              <li key={share.id} className="share-item">
                <div className="share-item-text">
                  <span className="share-item-title">{share.recipient_username ? `Only @${share.recipient_username}` : "Anyone with the link"}</span>
                  <span className="share-item-meta">
                    Created {formatDate(share.created_at)} · {expiryText(share.expires_at)}
                  </span>
                </div>
                <button
                  type="button"
                  className="icon-btn icon-btn-sm"
                  onClick={() => void copy(share)}
                  aria-label={`Copy link${share.recipient_username ? ` for @${share.recipient_username}` : ""}`}
                  title="Copy link"
                >
                  {copiedId === share.id ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                </button>
                <button
                  type="button"
                  className="btn btn-danger-outline btn-sm"
                  onClick={() => void revoke(share)}
                  disabled={revoking === share.id}
                  aria-label={`Revoke link${share.recipient_username ? ` for @${share.recipient_username}` : ""} created ${formatDate(share.created_at)}`}
                >
                  <TrashIcon size={14} />
                  {revoking === share.id ? "Revoking…" : "Revoke"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Modal>
  );
}
