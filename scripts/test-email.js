const { loadEnvConfig } = require("@next/env");
const nodemailer = require("nodemailer");
const path = require("path");

// Load .env.local, .env, etc. from project root
const projectDir = path.resolve(__dirname, "..");
const envConfig = loadEnvConfig(projectDir);

console.log("\n==================================================");
console.log("             SWOSHMAIL SMTP DIAGNOSTIC TOOL       ");
console.log("==================================================\n");

const loadedFiles = envConfig.loadedEnvFiles.map(f => path.basename(f.path));
if (loadedFiles.length === 0) {
  console.log("⚠️  WARNING: No .env or .env.local files found in the project root!");
  console.log("   Make sure you have created a `.env.local` file in:");
  console.log(`   ${projectDir}/.env.local\n`);
} else {
  console.log(`✅ Loaded environment file(s): ${loadedFiles.join(", ")}\n`);
}

const rawUser = process.env.EMAIL_USER;
const rawPass = process.env.EMAIL_PASS;
const rawHost = process.env.SMTP_HOST || "smtp.gmail.com";
const rawPort = parseInt(process.env.SMTP_PORT || "465", 10);

const smtpUser = rawUser?.replace(/["']/g, "").trim();
const hadSpacesInPass = rawPass ? /\s/.test(rawPass) : false;
const smtpPass = rawPass ? rawPass.replace(/["']/g, "").replace(/\s+/g, "").trim() : "";
const smtpHost = rawHost.replace(/["']/g, "").trim();
const smtpPort = isNaN(rawPort) ? 465 : rawPort;

// Display status (masking credentials)
const maskedUser = smtpUser
  ? smtpUser.replace(/^(.)(.*)(@.*)$/, (_, first, middle, domain) => `${first}${"*".repeat(middle.length)}${domain}`)
  : "(NOT SET)";

console.log(`- EMAIL_USER : ${maskedUser}`);
console.log(`- EMAIL_PASS : ${smtpPass ? `[${smtpPass.length} characters]` : "(NOT SET)"}`);
if (hadSpacesInPass) {
  console.log(`  ℹ️  Note: Spaces detected in EMAIL_PASS. Swoshmail will automatically strip them.`);
}
console.log(`- SMTP_HOST  : ${smtpHost}`);
console.log(`- SMTP_PORT  : ${smtpPort}\n`);

if (!smtpUser || !smtpPass) {
  console.error("❌ ERROR: EMAIL_USER and EMAIL_PASS must both be set in .env.local.");
  console.error("   Please edit your .env.local and populate them, e.g.:");
  console.error("   EMAIL_USER=your_email@gmail.com");
  console.error("   EMAIL_PASS=abcdefghijklmnop\n");
  process.exit(1);
}

if (smtpHost.toLowerCase().includes("gmail.com") && smtpPass.length !== 16) {
  console.error(`❌ ERROR: EMAIL_PASS length is ${smtpPass.length}. Gmail App Passwords must be exactly 16 characters.`);
  console.error("   - If you used your regular Gmail password, Google blocks it for SMTP.");
  console.error("   - Generate a 16-character App Password at: https://myaccount.google.com/apppasswords");
  console.error("   - If you pasted with spaces without quotes in .env, wrap it in quotes: EMAIL_PASS=\"xxxx xxxx xxxx xxxx\"\n");
  process.exit(1);
}

console.log(`Connecting to ${smtpHost}:${smtpPort} and verifying credentials with Gmail...`);

const isPort465 = smtpPort === 465;
const transporter = nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: isPort465,
  requireTLS: !isPort465,
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
  family: 4, // Force IPv4
  connectionTimeout: 15000,
  greetingTimeout: 15000,
  socketTimeout: 20000,
});

transporter.verify((error, success) => {
  if (error) {
    console.error("\n❌ SMTP VERIFICATION FAILED:\n");
    console.error(`   Error code   : ${error.code || "N/A"}`);
    console.error(`   Response code: ${error.responseCode || "N/A"}`);
    console.error(`   Message      : ${error.message}\n`);

    if (error.code === "EAUTH" || error.responseCode === 535 || error.message.includes("535")) {
      console.log("🔍 DIAGNOSIS: Gmail rejected the login credentials (535-5.7.8).");
      console.log("   Common causes & fixes:");
      console.log("   1. Account mismatch: The App Password was generated on a different Google account");
      console.log(`      than ${smtpUser}. Ensure you are signed into the right account.`);
      console.log("   2. 2-Step Verification: Ensure 2FA is turned ON at https://myaccount.google.com/security.");
      console.log("   3. Revoked password: Generate a fresh 16-letter App Password at https://myaccount.google.com/apppasswords.");
      console.log("   4. Server restart: Next.js must be restarted for .env changes to take effect.\n");
    } else if (error.code === "ETIMEDOUT" || error.code === "ESOCKETTIMEDOUT") {
      console.log(`🔍 DIAGNOSIS: Connection timed out on port ${smtpPort}.`);
      console.log("   Your hosting provider or network might block outbound SMTP connections on this port.");
      console.log("   Try changing SMTP_PORT to 587 in .env.local.\n");
    }
    process.exit(1);
  } else {
    console.log("\n✅ SUCCESS: SMTP connection established and credentials verified successfully!");
    console.log("   Swoshmail is ready to dispatch emails.\n");
    process.exit(0);
  }
});
