"use client";

import type { MouseEvent } from "react";
import type { Breadcrumb } from "@/types/api";
import { ChevronRightIcon, CloudIcon } from "@/components/Icons";
import { buildWorkspaceUrl } from "@/hooks/useUrlState";

interface BreadcrumbsProps {
  trail: Breadcrumb[];
  currentFolderId: string;
  onNavigate: (folderId: string) => void;
  /** Build real hrefs (Drive view) so crumbs can be opened in a new tab; pickers pass false. */
  linkable?: boolean;
  label?: string;
  rootLabel?: string;
}

export default function Breadcrumbs({
  trail,
  currentFolderId,
  onNavigate,
  linkable = true,
  label = "Breadcrumb",
  rootLabel = "Drive",
}: BreadcrumbsProps) {
  const crumbs: Breadcrumb[] = [{ id: "root", name: rootLabel }, ...trail.filter((c) => c.id !== "root")];
  const onClick = (e: MouseEvent<HTMLElement>, id: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    onNavigate(id);
  };

  return (
    <nav aria-label={label} className="breadcrumbs">
      <ol className="breadcrumbs-list">
        {crumbs.map((crumb, index) => {
          const isCurrent = index === crumbs.length - 1 || crumb.id === currentFolderId;
          const content = (
            <>
              {index === 0 && <CloudIcon size={15} />}
              <span className="truncate">{crumb.name}</span>
            </>
          );
          return (
            <li key={crumb.id} className="breadcrumb">
              {index > 0 && <ChevronRightIcon size={14} className="breadcrumb-separator" />}
              {isCurrent ? (
                <span className="breadcrumb-link is-current" aria-current="page">
                  {content}
                </span>
              ) : linkable ? (
                <a
                  className="breadcrumb-link"
                  href={buildWorkspaceUrl({ tab: "drive", folderId: crumb.id, shareToken: null })}
                  onClick={(e) => onClick(e, crumb.id)}
                >
                  {content}
                </a>
              ) : (
                <button type="button" className="breadcrumb-link" onClick={(e) => onClick(e, crumb.id)}>
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
