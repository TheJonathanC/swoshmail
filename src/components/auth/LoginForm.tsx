"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { signIn } from "next-auth/react";
import { AlertCircleIcon, EyeIcon, EyeOffIcon, LinkIcon, LockIcon } from "@/components/Icons";
import { useToast } from "@/components/ui/Toast";
import { readStorage, writeStorage } from "@/lib/client/storage";

const REMEMBERED_USERNAME_KEY = "remembered_username";

interface FieldErrors {
  username?: string;
  password?: string;
}

export default function LoginForm({ hasSharedLink }: { hasSharedLink: boolean }) {
  const toast = useToast();
  const ids = useId();
  const usernameId = `${ids}-username`;
  const passwordId = `${ids}-password`;
  const formErrorId = `${ids}-error`;

  const [username, setUsername] = useState(() => readStorage("local", REMEMBERED_USERNAME_KEY) ?? "");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [shake, setShake] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const fail = (message: string) => {
    setFormError(message);
    setShake(true);
    window.setTimeout(() => setShake(false), 450);
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const errors: FieldErrors = {};
    if (!username.trim()) errors.username = "Enter your username.";
    if (!password) errors.password = "Enter your password.";
    setFieldErrors(errors);
    setFormError("");
    if (errors.username) return usernameRef.current?.focus();
    if (errors.password) return passwordRef.current?.focus();

    setSubmitting(true);
    try {
      const res = await signIn("credentials", { redirect: false, username: username.trim(), password });
      if (!res || res.error) {
        const tooMany = res?.status === 429 || /too many|rate/i.test(res?.error ?? "");
        fail(
          tooMany
            ? "Too many sign-in attempts. Wait a minute and try again."
            : res
              ? "That username and password don't match. Check them and try again."
              : "Couldn't reach Swosh Workspace. Check your connection and try again."
        );
        setPassword("");
        passwordRef.current?.focus();
        return;
      }
      writeStorage("local", REMEMBERED_USERNAME_KEY, username.trim());
      toast("success", "Signed in", `Welcome back, ${username.trim()}.`);
    } catch {
      fail("Couldn't reach Swosh Workspace. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const describedBy = (fieldErrorId: string, hasError: boolean) =>
    [hasError ? fieldErrorId : null, formError ? formErrorId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={`auth-card glass-panel${shake ? " shake-animation" : ""}`}>
      <header className="auth-header">
        <div className="auth-icon" aria-hidden="true">
          <LockIcon size={28} />
        </div>
        <h1 className="auth-title">Sign in to Swosh Workspace</h1>
        <p className="auth-subtitle">Mail, Drive and Chat in one place.</p>
      </header>

      {hasSharedLink && (
        <div className="callout callout-info auth-shared-callout">
          <LinkIcon size={18} />
          <div>
            <strong className="callout-title">A file was shared with you</strong>
            Sign in to preview it, download it or save a copy to your Drive.
          </div>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate className="auth-form">
        <div className="form-group">
          <label className="form-label" htmlFor={usernameId}>
            Username
          </label>
          <input
            ref={usernameRef}
            id={usernameId}
            name="username"
            type="text"
            className="form-input"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              if (fieldErrors.username) setFieldErrors((f) => ({ ...f, username: undefined }));
            }}
            autoFocus={!username}
            aria-invalid={fieldErrors.username ? true : undefined}
            aria-describedby={describedBy(`${usernameId}-error`, Boolean(fieldErrors.username))}
            disabled={submitting}
          />
          {fieldErrors.username && (
            <p id={`${usernameId}-error`} className="field-error">
              <AlertCircleIcon size={14} /> {fieldErrors.username}
            </p>
          )}
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor={passwordId}>
            Password
          </label>
          <div className="input-wrapper input-with-trailing">
            <input
              ref={passwordRef}
              id={passwordId}
              name="password"
              type={showPassword ? "text" : "password"}
              className="form-input"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }));
              }}
              autoFocus={Boolean(username)}
              aria-invalid={fieldErrors.password ? true : undefined}
              aria-describedby={describedBy(`${passwordId}-error`, Boolean(fieldErrors.password))}
              disabled={submitting}
            />
            <button
              type="button"
              className="input-trailing-btn"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              aria-controls={passwordId}
            >
              {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
            </button>
          </div>
          {fieldErrors.password && (
            <p id={`${passwordId}-error`} className="field-error">
              <AlertCircleIcon size={14} /> {fieldErrors.password}
            </p>
          )}
        </div>

        {formError && (
          <div id={formErrorId} className="callout callout-danger" role="alert">
            <AlertCircleIcon size={16} />
            <span>{formError}</span>
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={submitting}>
          {submitting ? (
            <>
              <span className="spinner spinner-sm" aria-hidden="true" /> Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </button>
      </form>

      <p className="auth-footnote">Don&apos;t have an account? Ask your workspace admin.</p>
    </div>
  );
}
