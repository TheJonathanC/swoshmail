"use client";

import { useEffect, useState } from "react";
import type { MailConfigResponse } from "@/types/api";
import { getJson, isAbortError } from "@/lib/client/api";
import { ONE_MB } from "@/lib/client/files";

export const DEFAULT_MAIL_CONFIG: MailConfigResponse = {
  defaultRecipient: null,
  maintenance: false,
  maxDirectBytes: 4 * ONE_MB,
  maxTotalBytes: 20 * ONE_MB,
};

/** GET /api/send/config once per mount; falls back to conservative defaults. */
export function useMailConfig() {
  const [state, setState] = useState<{ config: MailConfigResponse; loaded: boolean; failed: boolean }>({
    config: DEFAULT_MAIL_CONFIG,
    loaded: false,
    failed: false,
  });

  useEffect(() => {
    const controller = new AbortController();
    getJson<MailConfigResponse>("/api/send/config", controller.signal)
      .then((config) => setState({ config: { ...DEFAULT_MAIL_CONFIG, ...config }, loaded: true, failed: false }))
      .catch((err: unknown) => {
        if (!isAbortError(err)) setState((s) => ({ ...s, loaded: true, failed: true }));
      });
    return () => controller.abort();
  }, []);

  return state;
}
