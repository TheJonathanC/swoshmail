"use client";

import { useState, useRef } from "react";

interface Toast {
  id: string;
  type: "success" | "danger";
  title: string;
  message: string;
}

export default function Home() {
  // Auth state
  const [password, setPassword] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [authError, setAuthError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [shake, setShake] = useState(false);

  // Upload form state
  const [files, setFiles] = useState<File[]>([]);
  const [emailTo, setEmailTo] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // UI state
  const [toasts, setToasts] = useState<Toast[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addToast = (type: "success" | "danger", title: string, message: string) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 5000);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setIsVerifying(true);
    setAuthError("");

    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (res.ok) {
        setIsAuthenticated(true);
        addToast("success", "Access Granted", "Welcome to Secure Email Backup.");
      } else {
        const data = await res.json();
        setAuthError(data.error || "Invalid password");
        setShake(true);
        setTimeout(() => setShake(false), 4000);
      }
    } catch (err) {
      setAuthError("Failed to connect to the server.");
      setShake(true);
      setTimeout(() => setShake(false), 4000);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleLogout = () => {
    setPassword("");
    setIsAuthenticated(false);
    setFiles([]);
    setEmailTo("");
    setSubject("");
    setBodyText("");
    addToast("success", "Logged Out", "You have been logged out successfully.");
  };

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles && droppedFiles.length > 0) {
      const newFiles = Array.from(droppedFiles);
      setFiles((prev) => [...prev, ...newFiles]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      const newFiles = Array.from(selectedFiles);
      setFiles((prev) => [...prev, ...newFiles]);
    }
  };

  const handleRemoveFile = (indexToRemove: number) => {
    setFiles((prev) => prev.filter((_, idx) => idx !== indexToRemove));
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleUploadSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (files.length === 0) return;

    setIsUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append("password", password);
    files.forEach((file) => {
      formData.append("files", file);
    });
    if (emailTo.trim()) {
      formData.append("to", emailTo);
    }
    if (subject.trim()) {
      formData.append("subject", subject);
    }
    if (bodyText.trim()) {
      formData.append("body", bodyText);
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/send");

    // Track upload progress
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentage = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percentage);
      }
    };

    xhr.onload = () => {
      setIsUploading(false);
      try {
        const response = JSON.parse(xhr.responseText);
        if (xhr.status === 200 && response.success) {
          addToast("success", "Files Emailed!", response.message || "All files sent successfully.");
          // Clear inputs
          setFiles([]);
          setEmailTo("");
          setSubject("");
          setBodyText("");
          if (fileInputRef.current) fileInputRef.current.value = "";
        } else {
          addToast("danger", "Send Failed", response.error || "Could not email the backup.");
        }
      } catch (err) {
        addToast("danger", "Upload Error", "Server returned an invalid response.");
      }
    };

    xhr.onerror = () => {
      setIsUploading(false);
      addToast("danger", "Network Error", "Unable to connect to the server.");
    };

    xhr.send(formData);
  };

  // Helper to format file sizes
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Render login screen if unauthenticated
  if (!isAuthenticated) {
    return (
      <div className={`auth-container glass-panel ${shake ? "shake-animation" : ""}`}>
        <div className="auth-header">
          <div className="auth-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <h1 className="auth-title">Security Key Required</h1>
          <p className="auth-subtitle">This page is protected. Enter your credentials to proceed.</p>
        </div>

        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label className="form-label">System Password</label>
            <div className="input-wrapper">
              <input
                type={showPassword ? "text" : "password"}
                className="form-input"
                placeholder="Enter password..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                style={{
                  position: "absolute",
                  right: "12px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                )}
              </button>
            </div>
            {authError && (
              <div className="error-text">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                {authError}
              </div>
            )}
          </div>

          <button type="submit" className="btn-primary" disabled={isVerifying}>
            {isVerifying ? <div className="spinner"></div> : "Unlock Console"}
          </button>
        </form>
      </div>
    );
  }

  // Render dashboard screen if authenticated
  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);
  const isLargeFiles = totalBytes > 4.5 * 1024 * 1024;

  return (
    <div className="dashboard-container glass-panel">
      <header className="dashboard-header">
        <div className="dashboard-logo">
          <div className="logo-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <span className="logo-text">Secure Email Backup</span>
        </div>
        <button className="btn-secondary" onClick={handleLogout}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
            <polyline points="16 17 21 12 16 7"></polyline>
            <line x1="21" y1="12" x2="9" y2="12"></line>
          </svg>
          Lock Console
        </button>
      </header>

      <form onSubmit={handleUploadSubmit}>
        {/* Dropzone area */}
        <div
          className={`dropzone ${isDragging ? "active" : ""}`}
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            style={{ display: "none" }}
            multiple
          />
          <div className="dropzone-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.2 15c.7-1.2 1-2.5.7-3.9-.3-2-1.9-3.6-3.9-3.9-1.4-.3-2.7 0-3.9.7"></path>
              <path d="M16 13a4 4 0 1 1-8 0a4 4 0 0 1 8 0z"></path>
              <path d="M12 5V3m0 0L9 6m3-3l3 3"></path>
            </svg>
          </div>
          <div className="dropzone-title">
            {files.length > 0 ? "Add more files" : "Drag & drop your files here"}
          </div>
          <div className="dropzone-subtitle">
            or click to browse from explorer (multiple allowed)
          </div>
        </div>

        {/* Selected files view */}
        {files.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "15px" }}>
            {files.map((file, index) => (
              <div key={`${file.name}-${index}`} className="file-card" style={{ marginTop: 0 }}>
                <div className="file-info">
                  <span className="file-icon">📄</span>
                  <div>
                    <div className="file-name" title={file.name}>
                      {file.name}
                    </div>
                    <div className="file-size">{formatFileSize(file.size)}</div>
                  </div>
                </div>
                <button type="button" className="btn-remove" onClick={() => handleRemoveFile(index)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 8px", fontSize: "13px", color: "var(--text-muted)", fontWeight: 500 }}>
              <span>Total files: {files.length}</span>
              <span>Total size: {formatFileSize(totalBytes)}</span>
            </div>
          </div>
        )}

        {/* Warning for large files */}
        {isLargeFiles && (
          <div className="error-text" style={{ marginTop: "12px", background: "rgba(239,68,68,0.08)", padding: "10px 14px", borderRadius: "8px" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0 }}>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
              <line x1="12" y1="9" x2="12" y2="13"></line>
              <line x1="12" y1="17" x2="12.01" y2="17"></line>
            </svg>
            <span style={{ fontSize: "12px", lineHeight: "1.4" }}>
              Warning: Total size ({formatFileSize(totalBytes)}) exceeds Vercel's **4.5 MB limit**. The upload may fail.
            </span>
          </div>
        )}

        <div className="form-divider"></div>

        {/* Metadata Details */}
        <div className="extra-fields">
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Send Email To (Optional)</label>
            <input
              type="email"
              className="form-input"
              placeholder="e.g. your-backup-destination@email.com"
              value={emailTo}
              onChange={(e) => setEmailTo(e.target.value)}
              disabled={isUploading}
            />
            <div className="input-desc">Leave blank to send to the default configured inbox.</div>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Custom Email Subject (Optional)</label>
            <input
              type="text"
              className="form-input"
              placeholder="e.g. Server Logs - Aug 10"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={isUploading}
            />
            <div className="input-desc">Defaults to "Email Backup: [Filename]" or "[N] files".</div>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Notes / Email Body (Optional)</label>
            <textarea
              className="form-input"
              rows={3}
              placeholder="Add any notes about these backup files..."
              style={{ resize: "vertical", minHeight: "80px" }}
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              disabled={isUploading}
            />
          </div>
        </div>

        {/* Progress bar */}
        {isUploading && (
          <div className="progress-container">
            <div className="progress-label">
              <span>Uploading and emailing backups...</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="progress-bar-wrapper">
              <div className="progress-bar-fill" style={{ width: `${uploadProgress}%` }}></div>
            </div>
          </div>
        )}

        <button
          type="submit"
          className="btn-primary"
          style={{ marginTop: isUploading ? "15px" : "0" }}
          disabled={files.length === 0 || isUploading}
        >
          {isUploading ? (
            <>
              <div className="spinner"></div>
              Sending Backup...
            </>
          ) : (
            <>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
              Send to Destination Inbox
            </>
          )}
        </button>
      </form>

      {/* Toast Notification Mount */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <span className="toast-icon">{toast.type === "success" ? "✓" : "⚠"}</span>
            <div className="toast-content">
              <div className="toast-title">{toast.title}</div>
              <div className="toast-message">{toast.message}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
