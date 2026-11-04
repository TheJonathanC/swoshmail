/**
 * Mail configuration and recipient validation.
 * SMTP diagnostics are only ever written to server logs.
 */
import { MAIL_MAX_RECIPIENTS } from "@/lib/constants";

/**
 * Deliberately strict address syntax: a plain addr-spec only (no display names,
 * comments, quoted local parts, groups, IP literals or encoded words), so nothing
 * reaches nodemailer's address parser that could smuggle extra recipients/headers.
 */
const EMAIL_RE =
  /^[A-Za-z0-9_%+-]+(?:\.[A-Za-z0-9_%+-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

export function isValidEmail(address: string): boolean {
  return address.length <= 254 && address.split("@")[0].length <= 64 && EMAIL_RE.test(address);
}

export type RecipientResult = { ok: true; recipients: string[] } | { ok: false; error: string };

/**
 * Parses a comma/semicolon separated recipient list. Empty input falls back to
 * `defaultRecipient`. Max 5 unique addresses, each must pass the strict regex.
 */
export function parseRecipients(input: unknown, defaultRecipient: string | null): RecipientResult {
  const raw = typeof input === "string" ? input : "";
  if (/[\r\n<>"()\\]/.test(raw)) return { ok: false, error: "Recipients must be plain email addresses separated by commas." };
  const parts = raw
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    if (!defaultRecipient) return { ok: false, error: "Please enter a recipient email address." };
    return { ok: true, recipients: [defaultRecipient] };
  }
  const seen = new Set<string>();
  const unique = parts.filter((p) => {
    const k = p.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (unique.length > MAIL_MAX_RECIPIENTS) {
    return { ok: false, error: `You can send to at most ${MAIL_MAX_RECIPIENTS} recipients.` };
  }
  const invalid = unique.find((p) => !isValidEmail(p));
  if (invalid) return { ok: false, error: "One or more recipient addresses are invalid." };
  return { ok: true, recipients: unique };
}

const clean = (v: string | undefined) => (v ? v.replace(/["']/g, "").trim() : "");

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export function getSmtpSettings(): SmtpSettings | null {
  const user = clean(process.env.EMAIL_USER);
  const pass = clean(process.env.EMAIL_PASS).replace(/\s+/g, "");
  const host = clean(process.env.SMTP_HOST) || "smtp.gmail.com";
  const portNum = parseInt(process.env.SMTP_PORT || "465", 10);
  const port = Number.isFinite(portNum) && portNum > 0 ? portNum : 465;
  if (!user || !pass) return null;
  return { host, port, user, pass };
}

/** Default recipient (EMAIL_TO, else the sending account), validated. */
export function getDefaultRecipient(): string | null {
  const to = clean(process.env.EMAIL_TO) || clean(process.env.EMAIL_USER);
  return to && isValidEmail(to) ? to : null;
}

export function isMailMaintenance(): boolean {
  return /^(1|true|yes|on)$/i.test((process.env.MAIL_MAINTENANCE || "").trim());
}

/** Writes actionable SMTP diagnostics to the server log only. */
export function logSmtpFailure(err: unknown, settings: SmtpSettings | null): void {
  const e = err as { code?: string; responseCode?: number; message?: string; permanent?: boolean };
  let hint = "";
  if (e?.code === "EAUTH" || e?.responseCode === 535) {
    hint =
      "SMTP authentication failed: check EMAIL_USER matches the account that generated the app password, EMAIL_PASS is a 16-character app password, and 2-Step Verification is on.";
  } else if (e?.code === "ETIMEDOUT" || e?.code === "ESOCKETTIMEDOUT" || e?.code === "ESOCKET") {
    hint = `SMTP connection to ${settings?.host}:${settings?.port} timed out; outbound SMTP may be blocked. Try SMTP_PORT=587.`;
  } else if (e?.code === "ECONNREFUSED") {
    hint = "SMTP connection refused: check SMTP_HOST and SMTP_PORT.";
  }
  console.error("[mail] send failed:", { code: e?.code, responseCode: e?.responseCode, permanent: e?.permanent, message: e?.message, hint });
}
