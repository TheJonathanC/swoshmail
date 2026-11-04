import { requireUser } from "@/lib/session";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { requireUuid, route } from "@/lib/http";
import { getOwnedFile } from "@/lib/drive";
import { streamFile } from "@/lib/serve";

// GET /api/drive/download?fileId=<uuid>[&inline=1]
// inline is honored only for raster images and pdf; everything else is an attachment.
export const GET = route("GET /api/drive/download", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`drive_download_${user.id}`, 120, MINUTE, "Too many downloads. Please wait a moment.");
  const params = new URL(request.url).searchParams;
  const fileId = requireUuid(params.get("fileId"), "fileId");
  const inline = params.get("inline") === "1" || params.get("inline") === "true";
  const file = await getOwnedFile(user.id, fileId);
  return streamFile(file, inline);
});
