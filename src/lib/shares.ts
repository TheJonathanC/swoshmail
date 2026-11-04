/** File sharing (file_shares table): link resolution and access checks. */
import { supabase } from "@/lib/supabase";
import { check, HttpError, isUuid } from "@/lib/http";
import type { ShareItem } from "@/types/api";

export interface ShareRow {
  id: string;
  file_id: string;
  owner_id: string;
  recipient_id: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export interface ResolvedShare {
  share: ShareRow;
  file: { id: string; name: string; size: number; key: string; uploaded_at: string; owner_id: string };
  ownerUsername: string;
}

const unavailable = () =>
  new HttpError(404, "This share link is invalid, has expired, or was revoked.", "share_unavailable");

export function isShareActive(share: Pick<ShareRow, "revoked_at" | "expires_at">, now = Date.now()): boolean {
  if (share.revoked_at) return false;
  if (share.expires_at && new Date(share.expires_at).getTime() <= now) return false;
  return true;
}

/** Validates a share token (the share id) for the signed-in user. Every failure is a 404. */
export async function resolveShare(token: unknown, userId: string): Promise<ResolvedShare> {
  if (!isUuid(token)) throw unavailable();
  const row = check(
    await supabase
      .from("file_shares")
      .select(
        "id, file_id, owner_id, recipient_id, created_at, expires_at, revoked_at, file:files!file_shares_file_id_fkey(id, name, size, key, uploaded_at, owner_id), owner:users!file_shares_owner_id_fkey(username)"
      )
      .eq("id", token)
      .maybeSingle(),
    "resolve share"
  ) as (ShareRow & {
    file: ResolvedShare["file"] | ResolvedShare["file"][] | null;
    owner: { username: string } | { username: string }[] | null;
  }) | null;
  if (!row || !isShareActive(row)) throw unavailable();
  if (row.recipient_id && row.recipient_id !== userId && row.owner_id !== userId) throw unavailable();
  const file = Array.isArray(row.file) ? row.file[0] : row.file;
  if (!file || file.owner_id !== row.owner_id) throw unavailable();
  const owner = Array.isArray(row.owner) ? row.owner[0] : row.owner;
  return {
    share: row,
    file: { ...file, size: Number(file.size) || 0 },
    ownerUsername: owner?.username ?? "a Swosh user",
  };
}

export function appOrigin(request: Request): string {
  const configured = process.env.NEXTAUTH_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      /* fall through */
    }
  }
  return new URL(request.url).origin;
}

export function toShareItem(row: ShareRow, recipientUsername: string | null, origin: string): ShareItem {
  return {
    id: row.id,
    file_id: row.file_id,
    recipient_username: recipientUsername,
    created_at: row.created_at,
    expires_at: row.expires_at,
    url: `${origin}/drive?share=${row.id}`,
  };
}
