"use client";

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { signOut } from "next-auth/react";
import type { FileItem } from "@/types/api";
import DriveView, { type StorageState } from "@/components/drive/DriveView";
import MailComposer from "@/components/mail/MailComposer";
import { useToast } from "@/components/ui/Toast";
import { resumePresence, signOffPresence } from "@/hooks/chat/usePresence";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useMailConfig } from "@/hooks/useMailConfig";
import { clearStoredDraft, useMailDraft } from "@/hooks/useMailDraft";
import { useUrlState, type WorkspaceTab } from "@/hooks/useUrlState";
import { ONE_GB, pluralize } from "@/lib/client/files";
import type { SessionUser } from "@/lib/client/session";
import LoadingScreen from "./LoadingScreen";
import MobileNav from "./MobileNav";
import { TAB_LABELS } from "./NavLinks";
import Sidebar from "./Sidebar";

const ChatPanel = dynamic(() => import("@/components/ChatPanel"), {
  ssr: false,
  loading: () => <LoadingScreen label="Loading chat…" />,
});

/**
 * Signed-in workspace. Rendered with key={user.id} so every piece of per-user state
 * (draft, Drive listing, chat) is discarded when the account changes or signs out.
 */
export default function Workspace({ user }: { user: SessionUser }) {
  const toast = useToast();
  const { tab, folderId, shareToken, navigate } = useUrlState();
  const [unreadChats, setUnreadChats] = useState(0);
  const [storage, setStorage] = useState<StorageState>({ used: 0, quota: ONE_GB, loaded: false });
  const [driveRefresh, setDriveRefresh] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const mail = useMailDraft(user.id);
  const mailConfig = useMailConfig();

  useDocumentTitle(`${unreadChats > 0 ? `(${unreadChats}) ` : ""}${TAB_LABELS[tab]} · Swosh Workspace`);

  const onStorage = useCallback((patch: { used?: number; quota?: number }) => {
    setStorage((s) => ({
      used: typeof patch.used === "number" && Number.isFinite(patch.used) ? patch.used : s.used,
      quota: patch.quota && patch.quota > 0 ? patch.quota : s.quota,
      loaded: true,
    }));
  }, []);

  const goToTab = useCallback((next: WorkspaceTab) => navigate({ tab: next }), [navigate]);

  const handleSignOut = async () => {
    setSigningOut(true);
    clearStoredDraft(user.id);
    mail.reset();
    try {
      // Mark the user offline while the session is still valid (best-effort, bounded wait).
      await signOffPresence();
      await signOut({ redirect: false });
      toast("success", "Signed out", "You've been signed out of Swosh Workspace.");
    } catch {
      resumePresence();
      setSigningOut(false);
      toast("danger", "Sign out failed", "Couldn't reach Swosh Workspace. Check your connection and try again.");
    }
  };

  const attachToMail = (files: FileItem[]) => {
    if (files.length === 0) return;
    mail.addDriveFiles(files);
    navigate({ tab: "mail" });
    toast(
      "success",
      "Attached to email",
      files.length === 1 ? `${files[0].name} was added to your draft.` : `${pluralize(files.length, "file")} were added to your draft.`
    );
  };

  const navProps = {
    active: tab,
    unreadChats,
    onNavigate: goToTab,
    username: user.username,
    onSignOut: () => void handleSignOut(),
    signingOut,
    storage,
  };

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <Sidebar {...navProps} />
      <MobileNav {...navProps} />
      <main id="main-content" className="main-content" tabIndex={-1}>
        <h1 className="sr-only">Swosh Workspace</h1>
        <section className="module-panel" hidden={tab !== "mail"} aria-label="Mail">
          <MailComposer
            mail={mail}
            config={mailConfig.config}
            configLoaded={mailConfig.loaded && !mailConfig.failed}
            onDriveChanged={(used) => {
              if (typeof used === "number") onStorage({ used });
              setDriveRefresh((n) => n + 1);
            }}
          />
        </section>
        <section className="module-panel" hidden={tab !== "drive"} aria-labelledby="drive-heading">
          <DriveView
            folderId={folderId}
            shareToken={shareToken}
            refreshKey={driveRefresh}
            onNavigateFolder={(id) => navigate({ tab: "drive", folderId: id })}
            onCloseShare={() => navigate({ share: null }, { replace: true })}
            storage={storage}
            onStorage={onStorage}
            onAttachToMail={attachToMail}
            onFilesDeleted={mail.removeDriveFiles}
          />
        </section>
        <section className="module-panel module-panel-fill" hidden={tab !== "chat"} aria-labelledby="chat-heading">
          <div className="module-heading module-heading-chat">
            <h2 className="module-title" id="chat-heading">
              Chat
            </h2>
          </div>
          <div className="chat-tab-wrapper module-fill-body">
            <ChatPanel userId={user.id} username={user.username} active={tab === "chat"} onUnreadChange={setUnreadChats} />
          </div>
        </section>
      </main>
    </div>
  );
}
