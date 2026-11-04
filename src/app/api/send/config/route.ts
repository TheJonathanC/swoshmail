import { NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { route } from "@/lib/http";
import { getDefaultRecipient, getSmtpSettings, isMailMaintenance } from "@/lib/mail";
import { MAIL_MAX_DIRECT_BYTES, MAIL_MAX_TOTAL_BYTES } from "@/lib/constants";
import type { MailConfigResponse } from "@/types/api";

// GET /api/send/config
export const GET = route("GET /api/send/config", async () => {
  await requireUser();
  const res: MailConfigResponse = {
    defaultRecipient: getDefaultRecipient(),
    // Unconfigured SMTP is reported as maintenance so the UI disables sending.
    maintenance: isMailMaintenance() || !getSmtpSettings(),
    maxDirectBytes: MAIL_MAX_DIRECT_BYTES,
    maxTotalBytes: MAIL_MAX_TOTAL_BYTES,
  };
  return NextResponse.json(res, { headers: { "Cache-Control": "private, no-store" } });
});
