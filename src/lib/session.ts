import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { HttpError } from "@/lib/http";

export interface SessionUser {
  id: string;
  username: string;
}

/** Validates the NextAuth session and returns the typed user, or throws a 401. */
export async function requireUser(): Promise<SessionUser> {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  if (!id) throw new HttpError(401, "Unauthorized", "unauthorized");
  return { id, username: session.user?.username ?? session.user?.name ?? "" };
}
