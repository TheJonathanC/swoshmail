import { requireUser } from "@/lib/session";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { route } from "@/lib/http";
import { resolveShare } from "@/lib/shares";
import { streamFile } from "@/lib/serve";

// GET /api/drive/share/download?token= -> attachment stream
export const GET = route("GET /api/drive/share/download", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`drive_share_dl_${user.id}`, 30, MINUTE, "Too many downloads. Please wait a moment.");
  const { file } = await resolveShare(new URL(request.url).searchParams.get("token"), user.id);
  return streamFile(file, false);
});
