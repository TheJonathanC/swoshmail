"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircleIcon, CheckIcon, CloseIcon } from "@/components/Icons";

export type ToastType = "success" | "danger" | "info";

interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message: string;
}

type AddToast = (type: ToastType, title: string, message: string) => void;

const ToastContext = createContext<AddToast | null>(null);

const AUTO_DISMISS_MS = 5000;
const MAX_VISIBLE = 4;

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Toasts live above the auth branch so sign-in / sign-out messages render too.
 * Errors stay until dismissed; others auto-dismiss and pause while hovered or focused.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const remove = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const add = useCallback<AddToast>((type, title, message) => {
    setToasts((prev) => [...prev, { id: newId(), type, title, message }].slice(-MAX_VISIBLE));
  }, []);

  const value = useMemo(() => add, [add]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-container">
        <div role="status" aria-live="polite" className="sr-only">
          {toasts.filter((t) => t.type !== "danger").slice(-1).map((t) => `${t.title}. ${t.message}`)}
        </div>
        <div role="alert" aria-live="assertive" className="sr-only">
          {toasts.filter((t) => t.type === "danger").slice(-1).map((t) => `${t.title}. ${t.message}`)}
        </div>
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} onDismiss={remove} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: string) => void }) {
  const [paused, setPaused] = useState(false);
  const remainingRef = useRef(AUTO_DISMISS_MS);
  const persistent = toast.type === "danger";

  useEffect(() => {
    if (persistent || paused) return;
    const started = Date.now();
    const timer = setTimeout(() => onDismiss(toast.id), remainingRef.current);
    return () => {
      clearTimeout(timer);
      remainingRef.current -= Date.now() - started;
    };
  }, [paused, persistent, onDismiss, toast.id]);

  return (
    <div
      className={`toast toast-${toast.type}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="toast-icon-wrapper" aria-hidden="true">
        {toast.type === "success" ? <CheckIcon size={16} /> : <AlertCircleIcon size={16} />}
      </div>
      <div className="toast-content">
        <div className="toast-title">{toast.title}</div>
        <div className="toast-message">{toast.message}</div>
      </div>
      <button
        type="button"
        className="toast-close-btn"
        onClick={() => onDismiss(toast.id)}
        aria-label={`Dismiss notification: ${toast.title}`}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}

export function useToast(): AddToast {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
