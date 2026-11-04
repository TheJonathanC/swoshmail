"use client";

import type { MouseEvent } from "react";
import { CloudIcon, MailIcon, MessageIcon } from "@/components/Icons";
import type { WorkspaceTab } from "@/hooks/useUrlState";

const ITEMS: { tab: WorkspaceTab; label: string; short: string; Icon: typeof MailIcon }[] = [
  { tab: "mail", label: "Swosh Mail", short: "Mail", Icon: MailIcon },
  { tab: "drive", label: "Swosh Drive", short: "Drive", Icon: CloudIcon },
  { tab: "chat", label: "Swosh Chat", short: "Chat", Icon: MessageIcon },
];

export const TAB_LABELS: Record<WorkspaceTab, string> = { mail: "Mail", drive: "Drive", chat: "Chat" };

interface NavLinksProps {
  active: WorkspaceTab;
  unreadChats: number;
  onNavigate: (tab: WorkspaceTab) => void;
  variant: "sidebar" | "segmented";
}

export default function NavLinks({ active, unreadChats, onNavigate, variant }: NavLinksProps) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>, tab: WorkspaceTab) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onNavigate(tab);
  };

  return (
    <ul className={variant === "sidebar" ? "nav-list" : "nav-segmented"}>
      {ITEMS.map(({ tab, label, short, Icon }) => {
        const isActive = tab === active;
        const badge = tab === "chat" && unreadChats > 0 ? unreadChats : 0;
        return (
          <li key={tab}>
            <a
              href={`/${tab}`}
              className={`nav-item${isActive ? " active" : ""}`}
              aria-current={isActive ? "page" : undefined}
              title={variant === "sidebar" ? label : undefined}
              onClick={(e) => onClick(e, tab)}
            >
              <span className="nav-icon">
                <Icon size={18} />
                {badge > 0 && variant === "sidebar" && <span className="nav-badge-dot" aria-hidden="true" />}
              </span>
              <span className="nav-label">{variant === "sidebar" ? label : short}</span>
              {badge > 0 && (
                <span className="nav-badge">
                  {badge > 99 ? "99+" : badge}
                  <span className="sr-only"> unread {badge === 1 ? "message" : "messages"}</span>
                </span>
              )}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
