import type { Session } from "next-auth";

export interface SessionUser {
  id: string;
  username: string;
}

/** Reads the id/username the auth callbacks put on session.user, without `any`. */
export function getSessionUser(session: Session | null): SessionUser | null {
  const user = session?.user as (Session["user"] & { id?: unknown; username?: unknown }) | undefined;
  if (!user) return null;
  // Fall back to the username so an incomplete session never bounces back to the sign-in form
  const id = typeof user.id === "string" && user.id ? user.id : user.name ?? user.email ?? "";
  if (!id) return null;
  const username = typeof user.username === "string" && user.username ? user.username : user.name ?? "";
  return { id, username };
}
