import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { requireUser } from "@/lib/session";
import { enforceRateLimit, MINUTE } from "@/lib/rate-limit";
import { badRequest, check, notFound, readJson, requireUuid, route } from "@/lib/http";
import { getOwnedFile } from "@/lib/drive";
import { appOrigin, isShareActive, resolveShare, toShareItem, type ShareRow } from "@/lib/shares";
import { previewKindFor } from "@/lib/files";
import { SHARE_MAX_EXPIRY_DAYS } from "@/lib/constants";
import type { CreateShareResponse, ListSharesResponse, SharedFileInfo } from "@/types/api";

const SHARE_COLUMNS = "id, file_id, owner_id, recipient_id, created_at, expires_at, revoked_at";

// POST /api/drive/share { fileId, recipient?, expiresInDays? } -> { share }
export const POST = route("POST /api/drive/share", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`drive_share_create_${user.id}`, 30, MINUTE, "Too many share links. Please wait a moment.");
  const body = await readJson<{ fileId: string; recipient: string | null; expiresInDays: number | null }>(request);
  const fileId = requireUuid(body.fileId, "fileId");
  await getOwnedFile(user.id, fileId);

  let recipientId: string | null = null;
  let recipientUsername: string | null = null;
  const recipient = typeof body.recipient === "string" ? body.recipient.trim().replace(/^@/, "") : "";
  if (recipient) {
    if (recipient.length > 255) throw badRequest("Invalid username.");
    const target = check(
      await supabase.from("users").select("id, username").eq("username", recipient).maybeSingle(),
      "share recipient lookup"
    ) as { id: string; username: string } | null;
    if (!target) throw notFound("No Swosh user with that username.", "user_not_found");
    if (target.id === user.id) throw badRequest("You already own this file.", "self_share");
    recipientId = target.id;
    recipientUsername = target.username;
  }

  let expiresAt: string | null = null;
  if (body.expiresInDays !== undefined && body.expiresInDays !== null) {
    const days = Number(body.expiresInDays);
    if (!Number.isFinite(days) || days <= 0 || days > SHARE_MAX_EXPIRY_DAYS) {
      throw badRequest(`Expiry must be between 1 and ${SHARE_MAX_EXPIRY_DAYS} days.`);
    }
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  const row = check(
    await supabase
      .from("file_shares")
      .insert({ file_id: fileId, owner_id: user.id, recipient_id: recipientId, expires_at: expiresAt })
      .select(SHARE_COLUMNS)
      .single(),
    "create share"
  ) as ShareRow;

  const res: CreateShareResponse = { share: toShareItem(row, recipientUsername, appOrigin(request)) };
  return NextResponse.json(res);
});

// GET /api/drive/share?fileId=  -> { shares } (owner)
// GET /api/drive/share?token=   -> SharedFileInfo (recipient)
export const GET = route("GET /api/drive/share", async (request: Request) => {
  const user = await requireUser();
  const params = new URL(request.url).searchParams;
  const token = params.get("token");

  if (token !== null) {
    await enforceRateLimit(`drive_share_view_${user.id}`, 60, MINUTE);
    const { share, file, ownerUsername } = await resolveShare(token, user.id);
    const res: SharedFileInfo = {
      id: file.id,
      name: file.name,
      size: file.size,
      uploaded_at: file.uploaded_at,
      owner_username: ownerUsername,
      previewKind: previewKindFor(file.name),
      expires_at: share.expires_at,
    };
    return NextResponse.json(res, { headers: { "Cache-Control": "private, no-store" } });
  }

  await enforceRateLimit(`drive_share_list_${user.id}`, 60, MINUTE);
  const fileId = requireUuid(params.get("fileId"), "fileId");
  await getOwnedFile(user.id, fileId);
  const rows = check(
    await supabase
      .from("file_shares")
      .select(`${SHARE_COLUMNS}, recipient:users!file_shares_recipient_id_fkey(username)`)
      .eq("owner_id", user.id)
      .eq("file_id", fileId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    "list shares"
  ) as (ShareRow & { recipient: { username: string } | { username: string }[] | null })[];
  const origin = appOrigin(request);
  const res: ListSharesResponse = {
    shares: (rows ?? [])
      .filter((r) => isShareActive(r))
      .map((r) => {
        const rec = Array.isArray(r.recipient) ? r.recipient[0] : r.recipient;
        return toShareItem(r, rec?.username ?? null, origin);
      }),
  };
  return NextResponse.json(res, { headers: { "Cache-Control": "private, no-store" } });
});

// DELETE /api/drive/share { shareId } -> { success: true }
export const DELETE = route("DELETE /api/drive/share", async (request: Request) => {
  const user = await requireUser();
  await enforceRateLimit(`drive_share_revoke_${user.id}`, 60, MINUTE);
  const body = await readJson<{ shareId: string }>(request);
  const shareId = requireUuid(body.shareId, "shareId");
  const rows = check(
    await supabase
      .from("file_shares")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", shareId)
      .eq("owner_id", user.id)
      .is("revoked_at", null)
      .select("id"),
    "revoke share"
  ) as { id: string }[];
  if (!rows || rows.length === 0) throw notFound("Share link not found.");
  return NextResponse.json({ success: true as const });
});
