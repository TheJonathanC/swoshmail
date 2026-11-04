"use client";

import { LogOutIcon } from "@/components/Icons";
import NavLinks from "./NavLinks";
import { BrandMark, type ShellNavProps } from "./Sidebar";

/** Phone top bar: brand, user + sign out, and a segmented tab control. */
export default function MobileNav({ active, unreadChats, onNavigate, username, onSignOut, signingOut }: ShellNavProps) {
  return (
    <header className="mobile-nav">
      <div className="mobile-nav-row">
        <BrandMark />
        <div className="mobile-nav-user">
          <span className="user-chip truncate" title={`Signed in as @${username}`}>
            <span className="user-dot" aria-hidden="true" />
            <span className="sr-only">Signed in as </span>@{username}
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onSignOut} disabled={signingOut}>
            <LogOutIcon size={14} />
            Sign out
          </button>
        </div>
      </div>
      <nav aria-label="Main">
        <NavLinks variant="segmented" active={active} unreadChats={unreadChats} onNavigate={onNavigate} />
      </nav>
    </header>
  );
}
