"use client";

import { useEffect } from "react";

/** The single place document.title is written. Pass null to leave the title alone. */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}
