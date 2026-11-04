import { requireUser } from "@/lib/session";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { route } from "@/lib/http";
import { resolveShare } from "@/lib/shares";
import { streamFile, textPreview } from "@/lib/serve";
import { canServeInline } from "@/lib/files";

// GET /api/drive/share/preview?token= -> inline image/pdf stream, or JSON TextPreviewResponse
export const GET = route("GET /api/drive/share/preview", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`drive_share_pv_${user.id}`, 60, MINUTE, "Too many preview requests. Please wait a moment.");
  const { file } = await resolveShare(new URL(request.url).searchParams.get("token"), user.id);
  if (canServeInline(file.name)) return streamFile(file, true);
  return textPreview(file);
});
