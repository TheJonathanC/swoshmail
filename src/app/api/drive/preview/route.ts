import { requireUser } from "@/lib/session";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { requireUuid, route } from "@/lib/http";
import { getOwnedFile } from "@/lib/drive";
import { textPreview } from "@/lib/serve";

// GET /api/drive/preview?fileId=<uuid> -> TextPreviewResponse
export const GET = route("GET /api/drive/preview", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`drive_preview_${user.id}`, 120, MINUTE, "Too many preview requests. Please wait a moment.");
  const fileId = requireUuid(new URL(request.url).searchParams.get("fileId"), "fileId");
  const file = await getOwnedFile(user.id, fileId);
  return textPreview(file);
});
