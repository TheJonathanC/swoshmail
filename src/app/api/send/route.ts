import { NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { supabase } from "@/lib/supabase";
import { requireUser } from "@/lib/session";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { badRequest, check, HttpError, isUuid, readForm, route, tooLarge } from "@/lib/http";
import { getDefaultRecipient, getSmtpSettings, isMailMaintenance, logSmtpFailure, parseRecipients } from "@/lib/mail";
import { getObjectBuffer } from "@/lib/r2";
import { resolveUniqueName, storeFile } from "@/lib/drive";
import { sanitizeFileName } from "@/lib/files";
import {
  MAIL_MAX_BODY,
  MAIL_MAX_DIRECT_BYTES,
  MAIL_MAX_SUBJECT,
  MAIL_MAX_TOTAL_BYTES,
  ONE_MB,
} from "@/lib/constants";
import type { SendMailResponse } from "@/types/api";

const DB_LIMIT_PER_MINUTE = 5;
const DB_LIMIT_PER_HOUR = 30;
const MAX_DRIVE_ATTACHMENTS = 20;

const maintenance = () =>
  new HttpError(503, "Mail sending is temporarily unavailable. Please try again later.", "maintenance");

function parseDriveIds(form: FormData): string[] {
  const values = form.getAll("driveFileIds").filter((v): v is string => typeof v === "string" && v.trim() !== "");
  let ids: unknown[] = [];
  for (const v of values) {
    const t = v.trim();
    if (t.startsWith("[")) {
      try {
        const parsed = JSON.parse(t);
        if (!Array.isArray(parsed)) throw new Error("not an array");
        ids = ids.concat(parsed);
      } catch {
        throw badRequest("driveFileIds must be a JSON array of ids.");
      }
    } else {
      ids.push(t);
    }
  }
  if (!ids.every(isUuid)) throw badRequest("Invalid Swosh Drive attachment.");
  const unique = Array.from(new Set((ids as string[]).map((s) => s.toLowerCase())));
  if (unique.length > MAX_DRIVE_ATTACHMENTS) throw badRequest(`You can attach at most ${MAX_DRIVE_ATTACHMENTS} Drive files.`);
  return unique;
}

async function enforceDbRateLimit(userId: string): Promise<void> {
  const since = (ms: number) => new Date(Date.now() - ms).toISOString();
  const [minute, hour] = await Promise.all([
    supabase
      .from("email_logs")
      .select("id", { count: "exact", head: true })
      .eq("sender_id", userId)
      .in("status", ["pending", "sent"])
      .gt("sent_at", since(MINUTE)),
    supabase
      .from("email_logs")
      .select("id", { count: "exact", head: true })
      .eq("sender_id", userId)
      .in("status", ["pending", "sent"])
      .gt("sent_at", since(60 * MINUTE)),
  ]);
  check(minute, "mail rate limit (minute)");
  check(hour, "mail rate limit (hour)");
  if ((minute.count ?? 0) >= DB_LIMIT_PER_MINUTE || (hour.count ?? 0) >= DB_LIMIT_PER_HOUR) {
    throw new HttpError(429, "You are sending emails too quickly. Please wait and try again.", "rate_limited", { "Retry-After": "60" });
  }
}

// POST /api/send (multipart): to, subject, body, files[], driveFileIds (JSON string[]), saveToDrive
export const POST = route("POST /api/send", async (request: Request) => {
  const user = await requireUser();
  if (isMailMaintenance()) throw maintenance();
  const smtp = getSmtpSettings();
  if (!smtp) {
    console.error("[mail] EMAIL_USER / EMAIL_PASS are not configured");
    throw maintenance();
  }
  if (smtp.host.toLowerCase().includes("gmail.com") && smtp.pass.length !== 16) {
    console.warn(`[mail] EMAIL_PASS is ${smtp.pass.length} characters; Gmail app passwords are 16. Sending will likely fail.`);
  }

  await enforceRateLimit(`mail_send_${user.id}`, 5, MINUTE, "You can send at most 5 emails per minute.");

  // Reject oversized bodies before parsing (direct files + text fields + multipart overhead).
  const declared = Number(request.headers.get("content-length") || "0");
  if (declared > MAIL_MAX_DIRECT_BYTES + ONE_MB) {
    throw tooLarge("Direct attachments can be at most 4 MB in total. Attach larger files from Swosh Drive.", "too_large");
  }

  const form = await readForm(request);
  const recipients = parseRecipients(form.get("to"), getDefaultRecipient());
  if (!recipients.ok) throw badRequest(recipients.error, "invalid_recipient");

  const subjectRaw = typeof form.get("subject") === "string" ? (form.get("subject") as string) : "";
  const subjectInput = subjectRaw.replace(/[\r\n]+/g, " ").trim();
  if (subjectInput.length > MAIL_MAX_SUBJECT) throw badRequest(`Subject can be at most ${MAIL_MAX_SUBJECT} characters.`);
  const bodyInput = typeof form.get("body") === "string" ? (form.get("body") as string) : "";
  if (bodyInput.length > MAIL_MAX_BODY) throw badRequest("Message body is too long (max 100,000 characters).");
  const saveToDrive = form.get("saveToDrive") === "true";

  const directFiles = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const directBytes = directFiles.reduce((s, f) => s + f.size, 0);
  if (directBytes > MAIL_MAX_DIRECT_BYTES) {
    throw tooLarge("Direct attachments can be at most 4 MB in total. Attach larger files from Swosh Drive.", "too_large");
  }

  // Drive attachments: ownership-checked up front.
  const driveIds = parseDriveIds(form);
  let driveRows: { id: string; name: string; size: number | string; key: string }[] = [];
  if (driveIds.length > 0) {
    driveRows = (check(
      await supabase.from("files").select("id, name, size, key").eq("owner_id", user.id).in("id", driveIds),
      "mail drive attachments"
    ) ?? []) as typeof driveRows;
    if (driveRows.length !== driveIds.length) {
      throw new HttpError(404, "One or more Swosh Drive attachments were not found.", "not_found");
    }
  }
  const driveBytes = driveRows.reduce((s, r) => s + (Number(r.size) || 0), 0);
  if (directBytes + driveBytes > MAIL_MAX_TOTAL_BYTES) {
    throw tooLarge("Attachments can be at most 20 MB in total.", "too_large");
  }

  await enforceDbRateLimit(user.id);

  // Read everything before logging/sending, so a storage failure aborts cleanly.
  const direct = await Promise.all(
    directFiles.map(async (f) => ({
      name: sanitizeFileName(f.name, "attachment"),
      type: f.type || "application/octet-stream",
      content: Buffer.from(await f.arrayBuffer()),
    }))
  );
  if (direct.reduce((s, d) => s + d.content.byteLength, 0) > MAIL_MAX_DIRECT_BYTES) {
    throw tooLarge("Direct attachments can be at most 4 MB in total.", "too_large");
  }
  const drive = await Promise.all(
    driveRows.map(async (r) => ({ id: r.id, name: r.name, size: Number(r.size) || 0, content: await getObjectBuffer(r.key) }))
  );

  const allNames = [...direct.map((d) => d.name), ...drive.map((d) => d.name)];
  const subject = subjectInput || (allNames.length ? `Swoshmail: ${allNames.length} attachment${allNames.length === 1 ? "" : "s"}` : "Swoshmail message");
  const text = bodyInput || (allNames.length ? `Attachments: ${allNames.join(", ")}` : "(no message)");
  const to = recipients.recipients.join(", ");

  // Log as pending BEFORE sending: the DB rate limit counts pending + sent, and a log
  // failure aborts the send (closes the old "log insert failed silently" bypass).
  const log = check(
    await supabase
      .from("email_logs")
      .insert({ sender_id: user.id, recipient: to, subject, body: text, status: "pending" })
      .select("id")
      .single(),
    "insert email log"
  ) as { id: string };

  const secure = smtp.port === 465;
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure,
    requireTLS: !secure,
    auth: { user: smtp.user, pass: smtp.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });

  try {
    await transporter.sendMail({
      from: { name: "Swoshmail", address: smtp.user },
      to: recipients.recipients,
      subject,
      text,
      attachments: [
        ...direct.map((d) => ({ filename: d.name, content: d.content, contentType: d.type })),
        ...drive.map((d) => ({ filename: d.name, content: d.content })),
      ],
    });
  } catch (err) {
    logSmtpFailure(err, smtp);
    const { error } = await supabase.from("email_logs").update({ status: "failed" }).eq("id", log.id);
    if (error) console.error("[mail] could not mark log failed:", error);
    throw new HttpError(502, "We couldn't send your email right now. Please try again later.", "send_failed");
  } finally {
    transporter.close();
  }

  {
    const { error } = await supabase.from("email_logs").update({ status: "sent" }).eq("id", log.id);
    if (error) console.error("[mail] could not mark log sent:", error);
  }

  // Archive only after a successful send, so retries never duplicate Drive copies.
  const attachmentRows: { email_log_id: string; file_id: string | null; file_name: string; file_size: number }[] = [];
  let archived = 0;
  for (const d of direct) {
    let fileId: string | null = null;
    if (saveToDrive) {
      try {
        const name = await resolveUniqueName(user.id, null, d.name);
        const row = await storeFile({ userId: user.id, name, folderId: null, body: d.content, contentType: d.type });
        fileId = row.id;
        archived++;
      } catch (err) {
        console.error("[mail] archiving attachment failed:", err);
      }
    }
    attachmentRows.push({ email_log_id: log.id, file_id: fileId, file_name: d.name, file_size: d.content.byteLength });
  }
  for (const d of drive) {
    attachmentRows.push({ email_log_id: log.id, file_id: d.id, file_name: d.name, file_size: d.size });
  }
  if (attachmentRows.length > 0) {
    const { error } = await supabase.from("email_attachments").insert(attachmentRows);
    if (error) console.error("[mail] could not log attachments:", error);
  }

  const res: SendMailResponse = { success: true, archived };
  return NextResponse.json(res);
});
