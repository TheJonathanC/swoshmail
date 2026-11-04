"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import type { FileItem, MailConfigResponse, SendMailResponse } from "@/types/api";
import { AlertCircleIcon, AlertTriangleIcon, CloudIcon, InfoIcon, PaperclipIcon, SendIcon, UploadIcon } from "@/components/Icons";
import { useToast } from "@/components/ui/Toast";
import type { MailDraftApi } from "@/hooks/useMailDraft";
import { errorMessage, expectOk, xhrRequest } from "@/lib/client/api";
import { formatBytes, pluralize, sumSizes } from "@/lib/client/files";
import { uploadFileToDrive } from "@/lib/client/upload";
import AttachmentList from "./AttachmentList";
import DriveAttachPicker from "./DriveAttachPicker";

const MAX_RECIPIENTS = 5;
const MAX_SUBJECT = 255;
const MAX_BODY = 100_000;
const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

interface MailComposerProps {
  mail: MailDraftApi;
  config: MailConfigResponse;
  configLoaded: boolean;
  /** Mail archived or uploaded files into Drive: refresh Drive views and quota. */
  onDriveChanged: (totalUsed?: number) => void;
}

export function parseRecipients(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function validateRecipients(value: string, hasDefault: boolean): string | null {
  const list = parseRecipients(value);
  if (list.length === 0) return hasDefault ? null : "Enter at least one recipient.";
  if (list.length > MAX_RECIPIENTS) return `You can send to up to ${MAX_RECIPIENTS} recipients at once.`;
  const invalid = list.find((addr) => !EMAIL_PATTERN.test(addr));
  return invalid ? `"${invalid}" isn't a valid email address.` : null;
}

export default function MailComposer({ mail, config, configLoaded, onDriveChanged }: MailComposerProps) {
  const toast = useToast();
  const ids = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { draft } = mail;

  const [pickerOpen, setPickerOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);
  const [moving, setMoving] = useState<{ done: number; total: number } | null>(null);
  const [toError, setToError] = useState<string | null>(null);

  const directBytes = sumSizes(draft.directFiles.map((d) => d.file));
  const driveBytes = sumSizes(draft.driveFiles);
  const directTooLarge = directBytes > config.maxDirectBytes;
  const totalTooLarge = directBytes + driveBytes > config.maxTotalBytes;
  const maintenance = config.maintenance;
  const busy = sending || moving !== null;
  const locked = maintenance || busy;
  const recipientHint = config.defaultRecipient
    ? `Leave empty to send to ${config.defaultRecipient}. Separate up to ${MAX_RECIPIENTS} addresses with commas.`
    : `Separate up to ${MAX_RECIPIENTS} addresses with commas.`;

  const moveDirectFilesToDrive = async () => {
    const pending = [...draft.directFiles];
    setMoving({ done: 0, total: pending.length });
    const moved: FileItem[] = [];
    let lastUsed: number | undefined;
    try {
      for (const attachment of pending) {
        const res = await uploadFileToDrive(attachment.file, { folderId: null });
        moved.push({ ...res.file, size: Number(res.file.size) || attachment.file.size });
        lastUsed = res.totalUsed;
        mail.removeDirectFile(attachment.id);
        setMoving((m) => (m ? { ...m, done: m.done + 1 } : m));
      }
      toast("success", "Moved to Drive", `${pluralize(moved.length, "file")} uploaded to your Drive and attached from there.`);
    } catch (err) {
      toast("danger", "Upload to Drive failed", errorMessage(err, "Couldn't upload the attachments to Drive."));
    } finally {
      if (moved.length > 0) {
        mail.addDriveFiles(moved);
        onDriveChanged(lastUsed);
      }
      setMoving(null);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (locked) return;
    const recipientError = validateRecipients(draft.to, Boolean(config.defaultRecipient) || !configLoaded);
    setToError(recipientError);
    if (recipientError) {
      document.getElementById(`${ids}-to`)?.focus();
      return;
    }
    if (directTooLarge || totalTooLarge) return;

    const form = new FormData();
    const recipients = parseRecipients(draft.to);
    if (recipients.length) form.append("to", recipients.join(","));
    if (draft.subject.trim()) form.append("subject", draft.subject.trim());
    if (draft.body.trim()) form.append("body", draft.body);
    form.append("saveToDrive", draft.saveToDrive && draft.directFiles.length > 0 ? "true" : "false");
    draft.directFiles.forEach(({ file }) => form.append("files", file));
    form.append("driveFileIds", JSON.stringify(draft.driveFiles.map((f) => f.id)));

    setSending(true);
    setSendProgress(0);
    try {
      const result = await xhrRequest({
        method: "POST",
        url: "/api/send",
        body: form,
        onProgress: (loaded, total) => setSendProgress(total ? Math.round((loaded / total) * 100) : 0),
      });
      const data = expectOk<SendMailResponse>(result, "Couldn't send the email.");
      const to = recipients.length ? recipients.join(", ") : config.defaultRecipient ?? "your default recipient";
      toast(
        "success",
        "Email sent",
        data.archived > 0 ? `Sent to ${to}. ${pluralize(data.archived, "attachment")} saved to Drive.` : `Sent to ${to}.`
      );
      if (data.archived > 0) onDriveChanged();
      mail.reset();
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      toast("danger", "Email not sent", errorMessage(err, "Couldn't send the email."));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mail-view">
      <div className="module-heading">
        <h2 className="module-title">Compose email</h2>
      </div>

      {maintenance && (
        <div className="callout callout-warning mail-banner" role="status">
          <AlertTriangleIcon size={18} />
          <div>
            <strong className="callout-title">Email sending is paused</strong>
            Outgoing email is offline for maintenance, so sending is turned off for now. Drive and Chat work as usual, and your
            draft is kept for this session.
          </div>
        </div>
      )}

      <form className="mail-form" onSubmit={submit} noValidate>
        <fieldset className="mail-fieldset" disabled={locked}>
          <legend className="sr-only">Message</legend>
          <div className="form-group">
            <label className="form-label" htmlFor={`${ids}-to`}>
              To {config.defaultRecipient ? <span className="label-optional">(optional)</span> : null}
            </label>
            <input
              id={`${ids}-to`}
              name="to"
              type="text"
              inputMode="email"
              autoComplete="email"
              className="form-input"
              placeholder={config.defaultRecipient ?? "name@example.com"}
              value={draft.to}
              onChange={(e) => {
                mail.setField("to", e.target.value);
                if (toError) setToError(null);
              }}
              onBlur={() => draft.to.trim() && setToError(validateRecipients(draft.to, true))}
              aria-invalid={toError ? true : undefined}
              aria-describedby={`${ids}-to-hint${toError ? ` ${ids}-to-error` : ""}`}
            />
            <p id={`${ids}-to-hint`} className="input-hint">
              {recipientHint}
            </p>
            {toError && (
              <p id={`${ids}-to-error`} className="field-error">
                <AlertCircleIcon size={14} /> {toError}
              </p>
            )}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor={`${ids}-subject`}>
              Subject <span className="label-optional">(optional)</span>
            </label>
            <input
              id={`${ids}-subject`}
              name="subject"
              className="form-input"
              placeholder="What's this about?"
              maxLength={MAX_SUBJECT}
              value={draft.subject}
              onChange={(e) => mail.setField("subject", e.target.value)}
              aria-describedby={`${ids}-subject-hint`}
            />
            <p id={`${ids}-subject-hint`} className="input-hint">
              Leave empty to use the attachment names as the subject.
            </p>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor={`${ids}-body`}>
              Message <span className="label-optional">(optional)</span>
            </label>
            <textarea
              id={`${ids}-body`}
              name="body"
              className="form-input form-textarea"
              rows={6}
              maxLength={MAX_BODY}
              placeholder="Write your message…"
              value={draft.body}
              onChange={(e) => mail.setField("body", e.target.value)}
            />
          </div>

          <div className="form-group">
            <span className="form-label" id={`${ids}-attach-label`}>
              Attachments
            </span>
            <div className="button-row" role="group" aria-labelledby={`${ids}-attach-label`}>
              <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
                <PaperclipIcon size={16} /> Attach from device
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setPickerOpen(true)}>
                <CloudIcon size={16} /> Attach from Drive
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              tabIndex={-1}
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (list.length) mail.addDirectFiles(list);
              }}
            />
            <p className="input-hint">
              Device files can total up to {formatBytes(config.maxDirectBytes)}. Larger files can be sent from Drive (up to{" "}
              {formatBytes(config.maxTotalBytes)} per email).
            </p>
          </div>

          <AttachmentList
            directFiles={draft.directFiles}
            driveFiles={draft.driveFiles}
            onRemoveDirect={mail.removeDirectFile}
            onRemoveDrive={(id) => mail.removeDriveFiles([id])}
            disabled={locked}
          />

          {directTooLarge && (
            <div className="callout callout-danger" role="alert">
              <AlertCircleIcon size={16} />
              <div className="callout-body">
                <p>
                  Files from this device add up to <strong>{formatBytes(directBytes)}</strong>, over the{" "}
                  <strong>{formatBytes(config.maxDirectBytes)}</strong> limit for direct attachments.
                </p>
                <p>Upload them to your Drive and attach them from there instead. You can keep them in Drive or delete them later.</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void moveDirectFilesToDrive()}>
                  <UploadIcon size={15} />
                  {moving ? `Uploading ${moving.done + 1} of ${moving.total}…` : "Upload to Drive & attach instead"}
                </button>
              </div>
            </div>
          )}
          {!directTooLarge && totalTooLarge && (
            <div className="callout callout-danger" role="alert">
              <AlertCircleIcon size={16} />
              <span>
                Attachments add up to <strong>{formatBytes(directBytes + driveBytes)}</strong>. One email can carry up to{" "}
                <strong>{formatBytes(config.maxTotalBytes)}</strong>. Remove some files to send.
              </span>
            </div>
          )}

          {draft.directFiles.length > 0 && (
            <label className="check-row">
              <input
                type="checkbox"
                className="checkbox"
                checked={draft.saveToDrive}
                onChange={(e) => mail.setSaveToDrive(e.target.checked)}
              />
              <span>
                Also save a copy of the device files to <strong>Drive</strong>
              </span>
            </label>
          )}
        </fieldset>

        {sending && (
          <div className="send-progress">
            <div className="progress-label">
              <span>Sending…</span>
              <span>{sendProgress}%</span>
            </div>
            <div className="progress-track" role="progressbar" aria-label="Sending email" aria-valuemin={0} aria-valuemax={100} aria-valuenow={sendProgress}>
              <div className="progress-fill" style={{ width: `${sendProgress}%` }} />
            </div>
          </div>
        )}

        <div className="mail-actions">
          {(maintenance || directTooLarge || totalTooLarge) && (
            <p className="input-hint mail-actions-hint" id={`${ids}-send-hint`}>
              <InfoIcon size={14} />
              {maintenance ? "Sending is paused for maintenance." : "Fix the attachment size above to send."}
            </p>
          )}
          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={locked || directTooLarge || totalTooLarge}
            aria-describedby={maintenance || directTooLarge || totalTooLarge ? `${ids}-send-hint` : undefined}
          >
            {sending ? <span className="spinner spinner-sm" aria-hidden="true" /> : <SendIcon size={17} />}
            {sending ? "Sending…" : "Send email"}
          </button>
        </div>
      </form>

      {pickerOpen && (
        <DriveAttachPicker initialSelected={draft.driveFiles} onApply={mail.setDriveFiles} onClose={() => setPickerOpen(false)} />
      )}
    </div>
  );
}
