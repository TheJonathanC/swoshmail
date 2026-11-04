#!/usr/bin/env node
// SMTP diagnostic: loads .env.local/.env and verifies the SMTP login (no mail is sent).
// Usage: npm run test-email
import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";
import nodemailer from "nodemailer";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { loadedEnvFiles } = nextEnv.loadEnvConfig(projectDir);

console.log("\nSwoshmail SMTP diagnostic\n");
if (loadedEnvFiles.length === 0) {
  console.log(`WARNING: no .env or .env.local found in ${projectDir}\n`);
} else {
  console.log(`Loaded: ${loadedEnvFiles.map((f) => path.basename(f.path)).join(", ")}\n`);
}

const clean = (v) => (v ? v.replace(/["']/g, "").trim() : "");
const smtpUser = clean(process.env.EMAIL_USER);
const rawPass = process.env.EMAIL_PASS ?? "";
const smtpPass = clean(rawPass).replace(/\s+/g, "");
const smtpHost = clean(process.env.SMTP_HOST) || "smtp.gmail.com";
const parsedPort = parseInt(process.env.SMTP_PORT || "465", 10);
const smtpPort = Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 465;

const maskedUser = smtpUser
  ? smtpUser.replace(/^(.)(.*)(@.*)$/, (_, first, middle, domain) => `${first}${"*".repeat(middle.length)}${domain}`)
  : "(NOT SET)";
console.log(`EMAIL_USER : ${maskedUser}`);
console.log(`EMAIL_PASS : ${smtpPass ? `[${smtpPass.length} characters]` : "(NOT SET)"}`);
if (/\s/.test(rawPass)) console.log("  note: spaces in EMAIL_PASS are stripped automatically");
console.log(`SMTP_HOST  : ${smtpHost}`);
console.log(`SMTP_PORT  : ${smtpPort}\n`);

if (!smtpUser || !smtpPass) {
  console.error("ERROR: EMAIL_USER and EMAIL_PASS must both be set.\n");
  process.exit(1);
}
if (smtpHost.toLowerCase().includes("gmail.com") && smtpPass.length !== 16) {
  console.error(`ERROR: EMAIL_PASS is ${smtpPass.length} characters; Gmail App Passwords are exactly 16.`);
  console.error("Generate one at https://myaccount.google.com/apppasswords\n");
  process.exit(1);
}

const secure = smtpPort === 465;
const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure,
  requireTLS: !secure,
  auth: { user: smtpUser, pass: smtpPass },
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 20000,
});

console.log(`Connecting to ${smtpHost}:${smtpPort} ...`);
try {
  await transporter.verify();
  console.log("\nSUCCESS: SMTP connection and credentials verified.\n");
  process.exit(0);
} catch (error) {
  console.error("\nSMTP VERIFICATION FAILED");
  console.error(`  code         : ${error.code || "N/A"}`);
  console.error(`  responseCode : ${error.responseCode || "N/A"}`);
  console.error(`  message      : ${error.message}\n`);
  if (error.code === "EAUTH" || error.responseCode === 535) {
    console.log("Diagnosis: login rejected. Check the App Password belongs to EMAIL_USER,");
    console.log("2-Step Verification is on, and restart the dev server after editing .env.\n");
  } else if (error.code === "ETIMEDOUT" || error.code === "ESOCKET") {
    console.log(`Diagnosis: connection to port ${smtpPort} timed out; outbound SMTP may be blocked. Try SMTP_PORT=587.\n`);
  }
  process.exit(1);
} finally {
  transporter.close();
}
