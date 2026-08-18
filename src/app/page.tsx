"use client";

import { useState, useEffect, useRef } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import dynamic from "next/dynamic";

const ChatPanel = dynamic(() => import("@/components/ChatPanel"), { ssr: false });

interface FileItem {
  id: string;
  name: string;
  size: string;
  key: string;
  url: string;
  owner_id: string;
  uploaded_at: string;
}

interface Toast {
  id: string;
  type: "success" | "danger";
  title: string;
  message: string;
}

const ONE_GB = 1024 * 1024 * 1024;

export default function Home() {
  const { data: session, status } = useSession();

  // Navigation tab state
  const [activeTab, setActiveTab] = useState<"mail" | "drive" | "chat">("mail");

  // Auth form state (only used if unauthenticated)
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [shake, setShake] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);

  // Swosh Mail state
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [saveToDrive, setSaveToDrive] = useState(false);
  const [directFiles, setDirectFiles] = useState<File[]>([]);
  const [attachedDriveFiles, setAttachedDriveFiles] = useState<FileItem[]>([]);
  const [isSendingMail, setIsSendingMail] = useState(false);
  const [mailProgress, setMailProgress] = useState(0);
  const [isMailFileModalOpen, setIsMailFileModalOpen] = useState(false);

  // Swosh Drive state
  const [driveFiles, setDriveFiles] = useState<FileItem[]>([]);
  const [totalUsed, setTotalUsed] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDriveFilesLoading, setIsDriveFilesLoading] = useState(false);
  const [isDriveUploading, setIsDriveUploading] = useState(false);
  const [driveUploadProgress, setDriveUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Toast State
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Refs
  const mailFileInputRef = useRef<HTMLInputElement>(null);
  const driveFileInputRef = useRef<HTMLInputElement>(null);

  // Autofill username on mount
  useEffect(() => {
    const remembered = localStorage.getItem("remembered_username");
    if (remembered) {
      setUsername(remembered);
    }
  }, []);

  // Fetch Drive Files when authenticated or active tab becomes drive
  useEffect(() => {
    if (status === "authenticated") {
      fetchDriveFiles();
    }
  }, [status]);

  const addToast = (type: "success" | "danger", title: string, message: string) => {
    const id = Date.now().toString();
    setToasts((prev) => [...prev, { id, type, title, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 5000);
  };

  const fetchDriveFiles = async () => {
    setIsDriveFilesLoading(true);
    try {
      const res = await fetch("/api/drive");
      if (res.ok) {
        const data = await res.json();
        setDriveFiles(data.files || []);
        setTotalUsed(data.totalUsed || 0);
      }
    } catch (err) {
      console.error("Failed to load drive files:", err);
      addToast("danger", "Fetch Error", "Could not retrieve files from Swosh Drive.");
    } finally {
      setIsDriveFilesLoading(false);
    }
  };

  // Auth Submit Handlers
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;

    setIsVerifying(true);
    setAuthError("");

    try {
      const res = await signIn("credentials", {
        redirect: false,
        username,
        password,
      });

      if (res && res.error) {
        setAuthError("Invalid username or password.");
        setShake(true);
        setTimeout(() => setShake(false), 500);
      } else {
        localStorage.setItem("remembered_username", username);
        addToast("success", "Unlocked Console", `Welcome back, ${username}!`);
      }
    } catch (err) {
      setAuthError("A connection error occurred.");
      setShake(true);
      setTimeout(() => setShake(false), 500);
    } finally {
      setIsVerifying(false);
    }
  };

  const handleLogout = () => {
    signOut({ redirect: false });
    // Keep username in state for autofill but clear fields
    setPassword("");
    setDirectFiles([]);
    setAttachedDriveFiles([]);
    setDriveFiles([]);
    setTotalUsed(0);
    addToast("success", "Console Locked", "Console secured successfully.");
  };

  // Drive Upload Handling
  const handleDriveFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const filesList = e.target.files;
    if (filesList && filesList.length > 0) {
      uploadFileToDrive(filesList[0]);
    }
  };

  const handleDriveDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const filesList = e.dataTransfer.files;
    if (filesList && filesList.length > 0) {
      uploadFileToDrive(filesList[0]);
    }
  };

  const uploadFileToDrive = (file: File) => {
    if (totalUsed + file.size > ONE_GB) {
      addToast("danger", "Quota Exceeded", "This file exceeds your 1 GB drive storage limit.");
      return;
    }

    setIsDriveUploading(true);
    setDriveUploadProgress(0);

    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/drive");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setDriveUploadProgress(percent);
      }
    };

    xhr.onload = () => {
      setIsDriveUploading(false);
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status === 200 && data.success) {
          addToast("success", "Uploaded", `${file.name} saved to Swosh Drive.`);
          fetchDriveFiles();
          if (driveFileInputRef.current) driveFileInputRef.current.value = "";
        } else {
          addToast("danger", "Upload Failed", data.error || "Could not save file.");
        }
      } catch (err) {
        addToast("danger", "Upload Error", "Server returned an invalid response.");
      }
    };

    xhr.onerror = () => {
      setIsDriveUploading(false);
      addToast("danger", "Network Error", "Unable to connect to the server.");
    };

    xhr.send(formData);
  };

  const handleDriveFileDelete = async (fileId: string, fileName: string) => {
    if (!confirm(`Are you sure you want to delete ${fileName}?`)) return;

    try {
      const res = await fetch("/api/drive/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });

      if (res.ok) {
        addToast("success", "Deleted", `${fileName} was removed.`);
        // Remove from attached lists if deleted
        setAttachedDriveFiles((prev) => prev.filter((f) => f.id !== fileId));
        fetchDriveFiles();
      } else {
        const data = await res.json();
        addToast("danger", "Delete Failed", data.error || "Failed to delete file.");
      }
    } catch (err) {
      addToast("danger", "Delete Error", "Could not connect to database.");
    }
  };

  const handleDriveFileMail = (file: FileItem) => {
    // Check if already attached
    if (!attachedDriveFiles.some((f) => f.id === file.id)) {
      setAttachedDriveFiles((prev) => [...prev, file]);
    }
    setActiveTab("mail");
    addToast("success", "File Attached", `Attached ${file.name} to email compose.`);
  };

  // Mail Direct Attachment Handling
  const handleMailDirectFileAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const filesList = e.target.files;
    if (filesList) {
      setDirectFiles((prev) => [...prev, ...Array.from(filesList)]);
    }
  };

  const handleRemoveDirectFile = (index: number) => {
    setDirectFiles((prev) => prev.filter((_, i) => i !== index));
    if (mailFileInputRef.current) mailFileInputRef.current.value = "";
  };

  const handleRemoveAttachedDriveFile = (id: string) => {
    setAttachedDriveFiles((prev) => prev.filter((f) => f.id !== id));
  };

  // Mail Submit Handling
  const handleMailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSendingMail(true);
    setMailProgress(0);

    const formData = new FormData();
    if (emailTo.trim()) formData.append("to", emailTo);
    if (emailSubject.trim()) formData.append("subject", emailSubject);
    if (emailBody.trim()) formData.append("body", emailBody);
    formData.append("saveToDrive", saveToDrive ? "true" : "false");

    // Add direct files
    directFiles.forEach((file) => {
      formData.append("files", file);
    });

    // Add drive file IDs
    attachedDriveFiles.forEach((file) => {
      formData.append("driveFileIds", file.id);
    });

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/send");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setMailProgress(percent);
      }
    };

    xhr.onload = () => {
      setIsSendingMail(false);
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status === 200 && data.success) {
          addToast("success", "Email Dispatched", data.message || "Email sent successfully.");
          // Clear forms
          setEmailTo("");
          setEmailSubject("");
          setEmailBody("");
          setDirectFiles([]);
          setAttachedDriveFiles([]);
          setSaveToDrive(false);
          if (mailFileInputRef.current) mailFileInputRef.current.value = "";
          // Refresh drive if files were auto-saved
          if (saveToDrive) fetchDriveFiles();
        } else {
          addToast("danger", "Dispatch Failed", data.error || "Could not send email.");
        }
      } catch (err) {
        addToast("danger", "Error", "Server returned an invalid response.");
      }
    };

    xhr.onerror = () => {
      setIsSendingMail(false);
      addToast("danger", "Network Error", "Unable to connect to the server.");
    };

    xhr.send(formData);
  };

  // Helper formats
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  // Filter drive files by query
  const filteredDriveFiles = driveFiles.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Status Screen: Session loading
  if (status === "loading") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
        <div className="spinner" style={{ width: "32px", height: "32px" }}></div>
        <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Verifying credentials...</p>
      </div>
    );
  }

  // Status Screen: Unauthenticated Login Form
  if (status === "unauthenticated") {
    return (
      <div className={`auth-container glass-panel ${shake ? "shake-animation" : ""}`}>
        <div className="auth-header">
          <div className="auth-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <h1 className="auth-title">Swosh Console</h1>
          <p className="auth-subtitle">Enter credentials to unlock Swosh Workspace.</p>
        </div>

        <form onSubmit={handleLogin}>
          <div className="form-group">
            <label className="form-label">Username</label>
            <input
              type="text"
              className="form-input"
              placeholder="Username..."
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus={!username}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <div className="input-wrapper">
              <input
                type={showPassword ? "text" : "password"}
                className="form-input"
                placeholder="Password..."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus={!!username}
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
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
            {isVerifying ? <div className="spinner"></div> : "Unlock Workspace"}
          </button>
        </form>
      </div>
    );
  }

  // Dashboard calculations
  const totalDirectBytes = directFiles.reduce((acc, f) => acc + f.size, 0);
  const isMailDirectFilesTooLarge = totalDirectBytes > 4.5 * 1024 * 1024;
  const quotaUsedPercentage = Math.min((totalUsed / ONE_GB) * 100, 100);

  // Status Screen: Authenticated Dashboard
  return (
    <div className="workspace-container glass-panel">
      {/* 1. Left Sidebar Navigation */}
      <aside className="sidebar">
        <div>
          <div className="dashboard-logo" style={{ marginBottom: "30px" }}>
            <div className="logo-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: "rotate(-15deg)" }}>
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </div>
            <span className="logo-text" style={{ fontSize: "20px" }}>Swoshmail</span>
          </div>

          <nav className="sidebar-menu">
            <button
              className={`nav-item ${activeTab === "mail" ? "active" : ""}`}
              onClick={() => setActiveTab("mail")}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                <polyline points="22,6 12,13 2,6"></polyline>
              </svg>
              Swosh Mail
            </button>
            <button
              className={`nav-item ${activeTab === "drive" ? "active" : ""}`}
              onClick={() => setActiveTab("drive")}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
              Swosh Drive
            </button>
            <button
              className={`nav-item ${activeTab === "chat" ? "active" : ""}`}
              onClick={() => setActiveTab("chat")}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              </svg>
              Swosh Chat
            </button>
          </nav>
        </div>

        <div className="sidebar-footer">
          {/* Drive Storage Quota Tracker */}
          <div className="quota-tracker">
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px", fontWeight: "bold" }}>
              <span>DRIVE STORAGE</span>
              <span>{formatBytes(totalUsed)} / 1 GB</span>
            </div>
            <div className="progress-bar-wrapper" style={{ height: "4px", margin: 0 }}>
              <div
                className="progress-bar-fill"
                style={{
                  width: `${quotaUsedPercentage}%`,
                  background: quotaUsedPercentage > 85 ? "var(--danger)" : quotaUsedPercentage > 60 ? "#f97316" : "var(--success)",
                }}
              ></div>
            </div>
          </div>

          {/* User logout section */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid rgba(255, 255, 255, 0.05)" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--text-muted)" }}>@{session?.user?.name}</span>
            <button className="btn-secondary" style={{ padding: "6px 12px", fontSize: "11px" }} onClick={handleLogout}>
              Lock Console
            </button>
          </div>
        </div>
      </aside>

      {/* 2. Main Area Panel */}
      <main className="main-content">

        {/* MODULE: Swosh Mail tab */}
        {activeTab === "mail" && (
          <div>
            <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "20px" }}>Compose Email</h2>
            <form onSubmit={handleMailSubmit}>
              <div className="extra-fields" style={{ marginBottom: "20px" }}>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Recipient Email (Optional)</label>
                  <input
                    type="email"
                    className="form-input"
                    placeholder="e.g. backup@example.com"
                    value={emailTo}
                    onChange={(e) => setEmailTo(e.target.value)}
                    disabled={isSendingMail}
                  />
                  <div className="input-desc">Defaults to your pre-configured target email.</div>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Subject (Optional)</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Enter email subject..."
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    disabled={isSendingMail}
                  />
                  <div className="input-desc">Defaults to "Swoshmail Message" or attachment listings.</div>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">Email Message / Body (Optional)</label>
                  <textarea
                    className="form-input"
                    rows={4}
                    placeholder="Type email body message here..."
                    value={emailBody}
                    onChange={(e) => setEmailBody(e.target.value)}
                    disabled={isSendingMail}
                    style={{ resize: "vertical", minHeight: "100px" }}
                  />
                </div>
              </div>

              {/* Attachment selectors */}
              <div style={{ marginBottom: "24px" }}>
                <label className="form-label" style={{ marginBottom: "12px", display: "block" }}>Attachments</label>
                <div style={{ display: "flex", gap: "12px", marginBottom: "15px" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => mailFileInputRef.current?.click()}
                    disabled={isSendingMail}
                  >
                    📎 Upload Local Files
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setIsMailFileModalOpen(true)}
                    disabled={isSendingMail}
                  >
                    ☁️ Attach from Drive
                  </button>
                  <input
                    type="file"
                    multiple
                    ref={mailFileInputRef}
                    onChange={handleMailDirectFileAdd}
                    style={{ display: "none" }}
                  />
                </div>

                {/* Direct Uploads attachments view */}
                {directFiles.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
                    <div style={{ fontSize: "11px", fontWeight: "bold", color: "var(--text-muted)" }}>DIRECT ATTACHMENTS (UPLOADED FROM LOCAL):</div>
                    {directFiles.map((file, idx) => (
                      <div key={`direct-${idx}`} className="file-card" style={{ marginTop: 0, padding: "8px 14px" }}>
                        <div className="file-info">
                          <span className="file-icon">📎</span>
                          <div>
                            <div className="file-name" style={{ fontSize: "13px" }}>{file.name}</div>
                            <div className="file-size" style={{ fontSize: "11px" }}>{formatBytes(file.size)}</div>
                          </div>
                        </div>
                        <button type="button" className="btn-remove" onClick={() => handleRemoveDirectFile(idx)}>
                          ✕
                        </button>
                      </div>
                    ))}
                    {isMailDirectFilesTooLarge && (
                      <div className="error-text" style={{ background: "rgba(239,68,68,0.08)", padding: "10px", borderRadius: "8px" }}>
                        ⚠️ Total local uploads size ({formatBytes(totalDirectBytes)}) exceeds Vercel's **4.5 MB request limit**. Uploading will likely fail. Consider uploading files to Swosh Drive first, then attaching them!
                      </div>
                    )}
                  </div>
                )}

                {/* Drive attachments view */}
                {attachedDriveFiles.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ fontSize: "11px", fontWeight: "bold", color: "var(--text-muted)" }}>DRIVE ATTACHMENTS (PULLED FROM CLOUD):</div>
                    {attachedDriveFiles.map((file) => (
                      <div key={file.id} className="file-card" style={{ marginTop: 0, padding: "8px 14px" }}>
                        <div className="file-info">
                          <span className="file-icon">☁️</span>
                          <div>
                            <div className="file-name" style={{ fontSize: "13px" }}>{file.name}</div>
                            <div className="file-size" style={{ fontSize: "11px" }}>{formatBytes(parseInt(file.size))}</div>
                          </div>
                        </div>
                        <button type="button" className="btn-remove" onClick={() => handleRemoveAttachedDriveFile(file.id)}>
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {directFiles.length > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "25px" }}>
                  <input
                    type="checkbox"
                    id="save_to_drive_check"
                    checked={saveToDrive}
                    onChange={(e) => setSaveToDrive(e.target.checked)}
                    style={{ width: "16px", height: "16px", cursor: "pointer" }}
                  />
                  <label htmlFor="save_to_drive_check" style={{ fontSize: "13px", cursor: "pointer" }}>
                    Save copy of local attachments directly to **Swosh Drive**
                  </label>
                </div>
              )}

              {/* Progress indicator */}
              {isSendingMail && (
                <div className="progress-container" style={{ marginBottom: "20px" }}>
                  <div className="progress-label">
                    <span>Sending email...</span>
                    <span>{mailProgress}%</span>
                  </div>
                  <div className="progress-bar-wrapper">
                    <div className="progress-bar-fill" style={{ width: `${mailProgress}%` }}></div>
                  </div>
                </div>
              )}

              <button type="submit" className="btn-primary" disabled={isSendingMail}>
                {isSendingMail ? (
                  <>
                    <div className="spinner"></div>
                    Sending...
                  </>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="22" y1="2" x2="11" y2="13"></line>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                    Send Swoshmail
                  </>
                )}
              </button>
            </form>
          </div>
        )}

        {/* MODULE: Swosh Drive tab */}
        {activeTab === "drive" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h2 style={{ fontSize: "20px", fontWeight: 700 }}>Swosh Drive Explorer</h2>
              <button
                className="btn-primary"
                style={{ width: "auto", padding: "10px 18px" }}
                onClick={() => driveFileInputRef.current?.click()}
                disabled={isDriveUploading}
              >
                {isDriveUploading ? "Uploading..." : "Upload File"}
              </button>
              <input
                type="file"
                ref={driveFileInputRef}
                onChange={handleDriveFileUpload}
                style={{ display: "none" }}
              />
            </div>

            {/* Dropzone file upload */}
            <div
              className={`dropzone ${isDragging ? "active" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDriveDrop}
              style={{ marginBottom: "25px", padding: "30px 15px" }}
            >
              <div className="dropzone-icon" style={{ fontSize: "32px" }}>☁️</div>
              <div className="dropzone-title" style={{ fontSize: "14px" }}>Drag files here to upload directly to drive</div>
            </div>

            {isDriveUploading && (
              <div className="progress-container" style={{ marginBottom: "25px" }}>
                <div className="progress-label">
                  <span>Uploading file to SwoshDrive...</span>
                  <span>{driveUploadProgress}%</span>
                </div>
                <div className="progress-bar-wrapper">
                  <div className="progress-bar-fill" style={{ width: `${driveUploadProgress}%` }}></div>
                </div>
              </div>
            )}

            {/* File search explorer */}
            <div className="form-group" style={{ marginBottom: "20px" }}>
              <div className="input-wrapper">
                <input
                  type="text"
                  className="form-input"
                  placeholder="Search files..."
                  style={{ paddingLeft: "42px" }}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <div style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }}>
                  🔍
                </div>
              </div>
            </div>

            {/* File list table */}
            {isDriveFilesLoading ? (
              <div className="empty-state">
                <div className="spinner" style={{ margin: "20px auto" }}></div>
                <p>Loading files...</p>
              </div>
            ) : filteredDriveFiles.length === 0 ? (
              <div className="empty-state">
                <p>{searchQuery ? "No files match your search query." : "No files saved in Swosh Drive yet."}</p>
              </div>
            ) : (
              <div className="drive-table-wrapper">
                <table className="drive-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Size</th>
                      <th>Uploaded</th>
                      <th style={{ textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDriveFiles.map((file) => (
                      <tr key={file.id}>
                        <td>
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <span style={{ fontSize: "18px" }}>📄</span>
                            <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", maxWidth: "250px", whiteSpace: "nowrap" }} title={file.name}>
                              {file.name}
                            </span>
                          </div>
                        </td>
                        <td>{formatBytes(parseInt(file.size))}</td>
                        <td style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                          {new Date(file.uploaded_at).toLocaleDateString()}
                        </td>
                        <td className="action-buttons-cell">
                          <button
                            type="button"
                            className="btn-icon"
                            title="Attach to Swosh Mail"
                            onClick={() => handleDriveFileMail(file)}
                          >
                            ✉️
                          </button>
                          <a
                            href={file.url}
                            className="btn-icon"
                            title="Download"
                            download={file.name}
                          >
                            ⬇️
                          </a>
                          <button
                            type="button"
                            className="btn-icon delete"
                            title="Delete File"
                            onClick={() => handleDriveFileDelete(file.id, file.name)}
                          >
                            🗑️
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* MODULE: Swosh Chat tab */}
        {activeTab === "chat" && (
          <div>
            <h2 style={{ fontSize: "20px", fontWeight: 700, marginBottom: "20px" }}>Swosh Chat</h2>
            <ChatPanel
              userId={(session?.user as any)?.id}
              username={(session?.user as any)?.username || session?.user?.name || ""}
            />
          </div>
        )}
      </main>

      {/* MODAL: Select from Drive file picker inside compose mail */}
      {isMailFileModalOpen && (
        <div className="modal-overlay" onClick={() => setIsMailFileModalOpen(false)}>
          <div className="modal-content glass-panel" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h3 className="modal-title">Attach File from Swosh Drive</h3>
              <button
                type="button"
                className="btn-remove"
                style={{ padding: "6px" }}
                onClick={() => setIsMailFileModalOpen(false)}
              >
                ✕
              </button>
            </header>

            <div className="modal-body">
              {driveFiles.length === 0 ? (
                <div className="empty-state" style={{ padding: "20px 0" }}>
                  Your drive is empty. Upload files in the Drive tab first!
                </div>
              ) : (
                driveFiles.map((file) => {
                  const isSelected = attachedDriveFiles.some((f) => f.id === file.id);
                  return (
                    <div
                      key={file.id}
                      className={`select-file-row ${isSelected ? "selected" : ""}`}
                      onClick={() => {
                        if (isSelected) {
                          setAttachedDriveFiles((prev) => prev.filter((f) => f.id !== file.id));
                        } else {
                          setAttachedDriveFiles((prev) => [...prev, file]);
                        }
                      }}
                    >
                      <div className="checkbox-custom">
                        {isSelected && "✓"}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: "14px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {file.name}
                        </div>
                        <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                          {formatBytes(parseInt(file.size))}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <footer className="modal-footer">
              <button
                type="button"
                className="btn-primary"
                style={{ width: "auto", padding: "10px 20px" }}
                onClick={() => setIsMailFileModalOpen(false)}
              >
                Save Selection
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* Toast Notification Container */}
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
