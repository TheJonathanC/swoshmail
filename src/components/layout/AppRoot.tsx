"use client";

import { useSession } from "next-auth/react";
import LoginForm from "@/components/auth/LoginForm";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useUrlState } from "@/hooks/useUrlState";
import { getSessionUser } from "@/lib/client/session";
import LoadingScreen from "./LoadingScreen";
import Workspace from "./Workspace";

export default function AppRoot() {
  const { data: session, status } = useSession();
  const { shareToken } = useUrlState();
  const user = status === "authenticated" ? getSessionUser(session) : null;

  useDocumentTitle(user ? null : status === "loading" ? "Swosh Workspace" : "Sign in · Swosh Workspace");

  if (status === "loading") return <LoadingScreen label="Checking your session…" />;

  if (!user) {
    return (
      <main className="auth-screen">
        <LoginForm hasSharedLink={Boolean(shareToken)} />
      </main>
    );
  }

  return <Workspace key={user.id} user={user} />;
}
