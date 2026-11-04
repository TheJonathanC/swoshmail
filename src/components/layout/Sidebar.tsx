"use client";

import { LogOutIcon, SendIcon } from "@/components/Icons";
import type { WorkspaceTab } from "@/hooks/useUrlState";
import NavLinks from "./NavLinks";
import QuotaBar from "./QuotaBar";

export interface ShellNavProps {
  active: WorkspaceTab;
  unreadChats: number;
  onNavigate: (tab: WorkspaceTab) => void;
  username: string;
  onSignOut: () => void;
  signingOut: boolean;
  storage: { used: number; quota: number; loaded: boolean };
}

export function BrandMark() {
  return (
    <div className="brand">
      <span className="brand-icon" aria-hidden="true">
        <SendIcon size={20} />
      </span>
      <span className="brand-text">Swosh Workspace</span>
    </div>
  );
}

/** Desktop / tablet sidebar (hidden on phones, where MobileNav takes over). */
export default function Sidebar({ active, unreadChats, onNavigate, username, onSignOut, signingOut, storage }: ShellNavProps) {
  return (
    <aside className="sidebar" aria-label="Workspace">
      <BrandMark />
      <nav aria-label="Main">
        <NavLinks variant="sidebar" active={active} unreadChats={unreadChats} onNavigate={onNavigate} />
      </nav>
      <div className="sidebar-footer">
        <QuotaBar used={storage.used} quota={storage.quota} loaded={storage.loaded} />
        <div className="sidebar-user">
          <span className="sidebar-username truncate" title={`Signed in as @${username}`}>
            <span className="user-dot" aria-hidden="true" />
            <span className="sr-only">Signed in as </span>@{username}
          </span>
          <button type="button" className="btn btn-secondary btn-sm sidebar-signout" onClick={onSignOut} disabled={signingOut}>
            <LogOutIcon size={14} />
            <span className="sidebar-signout-label">Sign out</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
