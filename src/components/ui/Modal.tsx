"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { CloseIcon } from "@/components/Icons";

type ModalSize = "sm" | "md" | "lg" | "xl";
type ModalTone = "default" | "danger" | "warning";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
  tone?: ModalTone;
  /** While busy, Esc / overlay click / close button are ignored. */
  busy?: boolean;
  /** Close when the overlay is clicked (default true). */
  dismissOnOverlay?: boolean;
  /** Hide the header close button (still closable with Esc). */
  hideCloseButton?: boolean;
  /** Element to focus on open; defaults to the first focusable element in the body. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  className?: string;
  bodyClassName?: string;
}

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible glass modal: role="dialog", aria-modal, labelled title,
 * focus trap, Esc to close, focus restore and background scroll lock.
 */
export default function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  footer,
  size = "md",
  tone = "default",
  busy = false,
  dismissOnOverlay = true,
  hideCloseButton = false,
  initialFocusRef,
  className = "",
  bodyClassName = "",
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);

  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  });

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;

    const focusTarget =
      initialFocusRef?.current ??
      panel?.querySelector<HTMLElement>(".modal-body input:not([disabled]), .modal-body textarea:not([disabled])") ??
      panel?.querySelector<HTMLElement>(".modal-footer " + "button:not([disabled])") ??
      panel?.querySelector<HTMLElement>(FOCUSABLE) ??
      panel;
    focusTarget?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (!panel) return;
      // Only the top-most modal handles keys
      const modals = document.querySelectorAll("[data-swosh-modal]");
      if (modals[modals.length - 1] !== panel) return;

      if (e.key === "Escape") {
        e.preventDefault();
        if (!busyRef.current) onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissOnOverlay && !busy) onClose();
      }}
    >
      <div
        ref={panelRef}
        data-swosh-modal=""
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className={`modal-content glass-panel modal-${size} modal-tone-${tone} ${className}`}
      >
        <header className="modal-header">
          <h3 id={titleId} className="modal-title">
            {icon}
            <span className="truncate">{title}</span>
          </h3>
          {!hideCloseButton && (
            <button type="button" className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close dialog">
              <CloseIcon size={16} />
            </button>
          )}
        </header>
        <div className={`modal-body ${bodyClassName}`}>{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: ReactNode;
  warning?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "default";
  busy?: boolean;
  icon?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open,
  title,
  message,
  warning,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  busy = false,
  icon,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      icon={icon}
      tone={tone}
      size="sm"
      busy={busy}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <span className="spinner" aria-label="Working" /> : confirmLabel}
          </button>
        </>
      }
    >
      <div className="modal-message">{message}</div>
      {warning && (
        <div className="callout callout-danger" role="note">
          {warning}
        </div>
      )}
    </Modal>
  );
}
