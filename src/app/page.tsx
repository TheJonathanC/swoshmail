"use client";

import { useState, useEffect, useRef } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import dynamic from "next/dynamic";
import { 
  FolderIcon, FileIcon, CloudIcon, TrashIcon, DownloadIcon, EyeIcon, 
  MailIcon, UploadIcon, ChevronRightIcon, SearchIcon, PaperclipIcon, PlusIcon, MessageIcon, CheckIcon
} from "@/components/Icons";

const ChatPanel = dynamic(() => import("@/components/ChatPanel"), { ssr: false });

interface FolderItem {
  id: string;
  name: string;
  parent_id: string | null;
  owner_id: string;
  created_at: string;
}

interface FileItem {
  id: string;
  name: string;
  size: string;
  key: string;
  url: string;
  owner_id: string;
  uploaded_at: string;
  folder_id: string | null;
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

  // Auth form state
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
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string>("root");
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string; name: string }[]>([]);
  const [totalUsed, setTotalUsed] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [isDriveFilesLoading, setIsDriveFilesLoading] = useState(false);
  const [isDriveUploading, setIsDriveUploading] = useState(false);
  const [driveUploadProgress, setDriveUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  // Folder creation and deletion state
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);

  // File Preview state
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [previewContent, setPreviewContent] = useState("");
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Toast State
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Refs
  const mailFileInputRef = useRef<HTMLInputElement>(null);
  const driveFileInputRef = useRef<HTMLInputElement>(null);

  // Update document title based on active module
  useEffect(() => {
    const titleMap: Record<string, string> = {
      mail: "Swosh Mail",
      drive: "Swosh Drive",
      chat: "Swosh Chat",
    };
    document.title = titleMap[activeTab] || "Swosh Workspace";
  }, [activeTab]);

  useEffect(() => {
    const remembered = localStorage.getItem("remembered_username");
    if (remembered) {
      setUsername(remembered);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") {
      fetchDriveFiles();
    }
  }, [status, currentFolderId]);

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
      const res = await fetch(`/api/drive?folderId=${currentFolderId}`);
      if (res.ok) {
        const data = await res.json();
        setDriveFiles(data.files || []);
        setFolders(data.folders || []);
        setTotalUsed(data.totalUsed || 0);
        setBreadcrumbs(data.breadcrumbs || []);
      }
    } catch (err) {
      console.error("Failed to load drive files:", err);
      addToast("danger", "Fetch Error", "Could not retrieve files from Swosh Drive.");
    } finally {
      setIsDriveFilesLoading(false);
    }
  };

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
    setPassword("");
    setDirectFiles([]);
    setAttachedDriveFiles([]);
    setDriveFiles([]);
    setFolders([]);
    setCurrentFolderId("root");
    setTotalUsed(0);
    addToast("success", "Console Locked", "Console secured successfully.");
  };

  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;

    try {
      const res = await fetch("/api/drive/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newFolderName.trim(),
          parentId: currentFolderId === "root" ? null : currentFolderId,
        }),
      });

      if (res.ok) {
        addToast("success", "Folder Created", `Folder "${newFolderName}" created.`);
        setNewFolderName("");
        setIsCreatingFolder(false);
        fetchDriveFiles();
      } else {
        const data = await res.json();
        addToast("danger", "Failed", data.error || "Could not create folder.");
      }
    } catch (err) {
      addToast("danger", "Error", "Network error while creating folder.");
    }
  };

  const confirmFolderDelete = async () => {
    if (!folderToDelete) return;
    setIsDeletingFolder(true);

    try {
      const res = await fetch("/api/drive/folders/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: folderToDelete.id }),
      });

      if (res.ok) {
        addToast("success", "Folder Deleted", `Folder "${folderToDelete.name}" was deleted.`);
        fetchDriveFiles();
      } else {
        const data = await res.json();
        addToast("danger", "Delete Failed", data.error || "Failed to delete folder.");
      }
    } catch (err) {
      addToast("danger", "Error", "Could not connect to database.");
    } finally {
      setIsDeletingFolder(false);
      setFolderToDelete(null);
    }
  };

  const handleDriveFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const filesList = e.target.files;
    if (filesList && filesList.length > 0) uploadFileToDrive(filesList[0]);
  };

  const handleDriveDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const filesList = e.dataTransfer.files;
    if (filesList && filesList.length > 0) uploadFileToDrive(filesList[0]);
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
    if (currentFolderId !== "root") formData.append("folderId", currentFolderId);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/drive");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setDriveUploadProgress(Math.round((event.loaded / event.total) * 100));
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
    if (!attachedDriveFiles.some((f) => f.id === file.id)) {
      setAttachedDriveFiles((prev) => [...prev, file]);
    }
    setActiveTab("mail");
    addToast("success", "File Attached", `Attached ${file.name} to email compose.`);
  };

  const handleFilePreview = async (file: FileItem) => {
    setPreviewFile(file);
    setPreviewContent("");

    const ext = file.name.split(".").pop()?.toLowerCase();
    const isImage = ["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext || "");

    if (isImage) return;

    setIsPreviewLoading(true);
    try {
      const res = await fetch(`/api/drive/preview?key=${encodeURIComponent(file.key)}`);
      if (res.ok) {
        const data = await res.json();
        setPreviewContent(data.content || "");
      } else {
        const data = await res.json();
        setPreviewContent(`[Failed to load preview: ${data.error || "Unknown error"}]`);
      }
    } catch (err) {
      setPreviewContent("[Error connecting to server to load preview.]");
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleRemoveDirectFile = (index: number) => {
    setDirectFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleRemoveAttachedDriveFile = (id: string) => {
    setAttachedDriveFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleMailDirectFileAdd = (e: React.ChangeEvent<HTMLInputElement>) => {
    const filesList = e.target.files;
    if (filesList) setDirectFiles((prev) => [...prev, ...Array.from(filesList)]);
  };

  const handleMailSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSendingMail(true);
    setMailProgress(0);

    const formData = new FormData();
    if (emailTo.trim()) formData.append("to", emailTo);
    if (emailSubject.trim()) formData.append("subject", emailSubject);
    if (emailBody.trim()) formData.append("body", emailBody);
    formData.append("saveToDrive", saveToDrive ? "true" : "false");

    directFiles.forEach((file) => formData.append("files", file));
    attachedDriveFiles.forEach((file) => formData.append("driveFileIds", file.id));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/send");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setMailProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      setIsSendingMail(false);
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status === 200 && data.success) {
          addToast("success", "Email Dispatched", data.message || "Email sent successfully.");
          setEmailTo(""); setEmailSubject(""); setEmailBody("");
          setDirectFiles([]); setAttachedDriveFiles([]); setSaveToDrive(false);
          if (mailFileInputRef.current) mailFileInputRef.current.value = "";
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

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const filteredDriveFiles = driveFiles.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredFolders = folders.filter((fol) =>
    fol.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const isPreviewable = (fileName: string) => {
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    return [
      "png", "jpg", "jpeg", "gif", "svg", "webp",
      "txt", "log", "md", "json", "css", "js", "ts", "html", "xml", "csv"
    ].includes(ext);
  };

  if (status === "loading") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
        <div className="spinner" style={{ width: "32px", height: "32px" }}></div>
        <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Verifying credentials...</p>
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <div className={`auth-container glass-panel ${shake ? "shake-animation" : ""}`}>
        <div className="auth-header">
          <div className="auth-icon">
            <MailIcon size={32} />
          </div>
          <h1 className="auth-title">Swoshmail Console</h1>
          <p className="auth-subtitle">Enter credentials to unlock Swoshmail Workspace.</p>
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
                <EyeIcon size={18} />
              </button>
            </div>
            {authError && (
              <div className="error-text">
                <TrashIcon size={14} /> {authError}
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

  const totalDirectBytes = directFiles.reduce((acc, f) => acc + f.size, 0);
  const isMailDirectFilesTooLarge = totalDirectBytes > 4.5 * 1024 * 1024;
  const quotaUsedPercentage = Math.min((totalUsed / ONE_GB) * 100, 100);

  return (
    <div className="workspace-container glass-panel">
      {/* 1. Left Sidebar Navigation */}
      <aside className="sidebar">
        <div>
          <div className="dashboard-logo" style={{ marginBottom: "30px" }}>
            <div className="logo-icon">
              <div style={{ transform: "rotate(-10deg)", display: "flex" }}>
                <MailIcon size={22} />
              </div>
            </div>
            <span className="logo-text" style={{ fontSize: "20px" }}>Swoshmail</span>
          </div>

          <nav className="sidebar-menu">
            <button
              className={`nav-item ${activeTab === "mail" ? "active" : ""}`}
              onClick={() => setActiveTab("mail")}
            >
              <MailIcon size={18} /> Swosh Mail
            </button>
            <button
              className={`nav-item ${activeTab === "drive" ? "active" : ""}`}
              onClick={() => setActiveTab("drive")}
            >
              <CloudIcon size={18} /> Swosh Drive
            </button>
            <button
              className={`nav-item ${activeTab === "chat" ? "active" : ""}`}
              onClick={() => setActiveTab("chat")}
            >
              <MessageIcon size={18} /> Swosh Chat
            </button>
          </nav>
        </div>

        <div className="sidebar-footer">
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
                    <PaperclipIcon size={16} /> Upload Local Files
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => setIsMailFileModalOpen(true)}
                    disabled={isSendingMail}
                  >
                    <CloudIcon size={16} /> Attach from Drive
                  </button>
                  <input
                    type="file"
                    multiple
                    ref={mailFileInputRef}
                    onChange={handleMailDirectFileAdd}
                    style={{ display: "none" }}
                  />
                </div>

                {directFiles.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
                    <div style={{ fontSize: "11px", fontWeight: "bold", color: "var(--text-muted)" }}>DIRECT ATTACHMENTS (UPLOADED FROM LOCAL):</div>
                    {directFiles.map((file, idx) => (
                      <div key={`direct-${idx}`} className="file-card" style={{ marginTop: 0, padding: "8px 14px" }}>
                        <div className="file-info">
                          <span className="file-icon"><PaperclipIcon size={16} /></span>
                          <div>
                            <div className="file-name" style={{ fontSize: "13px" }}>{file.name}</div>
                            <div className="file-size" style={{ fontSize: "11px" }}>{formatBytes(file.size)}</div>
                          </div>
                        </div>
                        <button type="button" className="btn-remove" onClick={() => handleRemoveDirectFile(idx)}>
                          <TrashIcon size={14} />
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

                {attachedDriveFiles.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ fontSize: "11px", fontWeight: "bold", color: "var(--text-muted)" }}>DRIVE ATTACHMENTS (PULLED FROM CLOUD):</div>
                    {attachedDriveFiles.map((file) => (
                      <div key={file.id} className="file-card" style={{ marginTop: 0, padding: "8px 14px" }}>
                        <div className="file-info">
                          <span className="file-icon"><CloudIcon size={16} /></span>
                          <div>
                            <div className="file-name" style={{ fontSize: "13px" }}>{file.name}</div>
                            <div className="file-size" style={{ fontSize: "11px" }}>{formatBytes(parseInt(file.size))}</div>
                          </div>
                        </div>
                        <button type="button" className="btn-remove" onClick={() => handleRemoveAttachedDriveFile(file.id)}>
                          <TrashIcon size={14} />
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
                    <MailIcon size={18} /> Send Swoshmail
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
              <div style={{ display: "flex", gap: "12px" }}>
                {isCreatingFolder ? (
                  <form onSubmit={handleCreateFolder} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <input
                      type="text"
                      className="form-input"
                      style={{ padding: "8px 12px", width: "160px", fontSize: "13px" }}
                      placeholder="Folder name..."
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      autoFocus
                    />
                    <button type="submit" className="btn-primary" style={{ width: "auto", padding: "8px 12px" }}>
                      Create
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ padding: "8px 12px" }}
                      onClick={() => { setIsCreatingFolder(false); setNewFolderName(""); }}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button
                    className="btn-secondary"
                    style={{ padding: "10px 18px" }}
                    onClick={() => setIsCreatingFolder(true)}
                  >
                    <PlusIcon size={16} /> New Folder
                  </button>
                )}

                <button
                  className="btn-primary"
                  style={{ width: "auto", padding: "10px 18px" }}
                  onClick={() => driveFileInputRef.current?.click()}
                  disabled={isDriveUploading}
                >
                  {isDriveUploading ? "Uploading..." : <><UploadIcon size={16} /> Upload File</>}
                </button>
                <input
                  type="file"
                  ref={driveFileInputRef}
                  onChange={handleDriveFileUpload}
                  style={{ display: "none" }}
                />
              </div>
            </div>

            {/* Breadcrumb Navigation Trail */}
            <div className="breadcrumbs-bar">
              <span
                className={`breadcrumb-item ${currentFolderId === "root" ? "active" : ""}`}
                onClick={() => currentFolderId !== "root" && setCurrentFolderId("root")}
              >
                <CloudIcon size={16} /> Drive
              </span>
              {breadcrumbs.map((crumb, index) => (
                <span key={crumb.id} style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                  <ChevronRightIcon size={14} className="breadcrumb-separator" />
                  <span
                    className={`breadcrumb-item ${index === breadcrumbs.length - 1 ? "active" : ""}`}
                    onClick={() => index !== breadcrumbs.length - 1 && setCurrentFolderId(crumb.id)}
                  >
                    {crumb.name}
                  </span>
                </span>
              ))}
            </div>

            {/* Dropzone file upload */}
            <div
              className={`dropzone ${isDragging ? "active" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDriveDrop}
              style={{ marginBottom: "25px", padding: "20px 15px" }}
            >
              <div className="dropzone-icon" style={{ color: "var(--primary)" }}><CloudIcon size={36} /></div>
              <div className="dropzone-title" style={{ fontSize: "13px" }}>Drag files here to upload directly to this directory</div>
            </div>

            {isDriveUploading && (
              <div className="progress-container" style={{ marginBottom: "25px" }}>
                <div className="progress-label">
                  <span>Uploading file to Cloudflare R2...</span>
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
                  placeholder="Search files and folders..."
                  style={{ paddingLeft: "42px" }}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <div style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--text-muted)", pointerEvents: "none" }}>
                  <SearchIcon size={18} />
                </div>
              </div>
            </div>

            {/* Folder Explorer Grid */}
            {filteredFolders.length > 0 && (
              <div className="folder-grid">
                {filteredFolders.map((folder) => (
                  <div
                    key={folder.id}
                    className="folder-card"
                    onClick={() => setCurrentFolderId(folder.id)}
                  >
                    <div className="folder-info">
                      <span className="folder-icon"><FolderIcon size={20} /></span>
                      <span className="folder-name" title={folder.name}>
                        {folder.name}
                      </span>
                    </div>
                    <button
                      className="folder-delete-btn"
                      title="Delete folder and contents"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFolderToDelete({ id: folder.id, name: folder.name });
                      }}
                    >
                      <TrashIcon size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* File list table */}
            {isDriveFilesLoading ? (
              <div className="empty-state">
                <div className="spinner" style={{ margin: "20px auto" }}></div>
                <p>Loading directory...</p>
              </div>
            ) : filteredDriveFiles.length === 0 && filteredFolders.length === 0 ? (
              <div className="empty-state">
                <div style={{ color: "var(--text-muted)", marginBottom: "12px", display: "flex", justifyContent: "center" }}>
                  <FileIcon size={32} />
                </div>
                <p>{searchQuery ? "No items match your search query." : "This directory is empty."}</p>
              </div>
            ) : (
              filteredDriveFiles.length > 0 && (
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
                              <span style={{ color: "var(--text-muted)" }}><FileIcon size={18} /></span>
                              <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", maxWidth: "250px", whiteSpace: "nowrap" }} title={file.name}>
                                {file.name}
                              </span>
                            </div>
                          </td>
                          <td style={{ color: "var(--text-muted)", fontSize: "13px" }}>{formatBytes(parseInt(file.size))}</td>
                          <td style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                            {new Date(file.uploaded_at).toLocaleDateString()}
                          </td>
                          <td className="action-buttons-cell">
                            {isPreviewable(file.name) && (
                              <button
                                type="button"
                                className="btn-icon"
                                title="Preview File"
                                onClick={() => handleFilePreview(file)}
                              >
                                <EyeIcon size={16} />
                              </button>
                            )}
                            <button
                              type="button"
                              className="btn-icon"
                              title="Attach to Swosh Mail"
                              onClick={() => handleDriveFileMail(file)}
                            >
                              <MailIcon size={16} />
                            </button>
                            <a
                              href={file.url}
                              className="btn-icon"
                              title="Download"
                              download={file.name}
                            >
                              <DownloadIcon size={16} />
                            </a>
                            <button
                              type="button"
                              className="btn-icon delete"
                              title="Delete File"
                              onClick={() => handleDriveFileDelete(file.id, file.name)}
                            >
                              <TrashIcon size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
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

      {/* MODAL: Folder Delete Confirmation */}
      {folderToDelete && (
        <div className="modal-overlay" onClick={() => !isDeletingFolder && setFolderToDelete(null)}>
          <div className="modal-content glass-panel" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--danger)" }}>
                <TrashIcon size={18} /> Delete Folder
              </h3>
            </header>
            <div className="modal-body" style={{ padding: "20px" }}>
              <p style={{ marginBottom: "12px", fontSize: "14px", lineHeight: 1.5 }}>
                Are you sure you want to delete the folder <strong>"{folderToDelete.name}"</strong>?
              </p>
              <div className="error-text" style={{ background: "rgba(239,68,68,0.1)", padding: "12px", borderRadius: "8px", color: "var(--danger)" }}>
                ⚠️ <strong>WARNING:</strong> This will permanently delete all files and subfolders inside it. This action cannot be undone.
              </div>
            </div>
            <footer className="modal-footer" style={{ borderTop: "1px solid rgba(255, 255, 255, 0.05)", paddingTop: "15px" }}>
              <button
                className="btn-secondary"
                style={{ padding: "10px 16px" }}
                onClick={() => setFolderToDelete(null)}
                disabled={isDeletingFolder}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                style={{ background: "var(--danger)", padding: "10px 16px", width: "auto" }}
                onClick={confirmFolderDelete}
                disabled={isDeletingFolder}
              >
                {isDeletingFolder ? <div className="spinner"></div> : "Delete Permanently"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* MODAL: File Previewer */}
      {previewFile && (
        <div className="modal-overlay" onClick={() => setPreviewFile(null)}>
          <div className="modal-content glass-panel" style={{ maxWidth: "640px" }} onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <FileIcon size={18} /> {previewFile.name}
              </h3>
              <button
                type="button"
                className="btn-remove"
                style={{ padding: "6px" }}
                onClick={() => setPreviewFile(null)}
              >
                <TrashIcon size={14} /> {/* Actually should be X icon, but we'll use btn-remove which acts like X in this context */}
              </button>
            </header>

            <div className="modal-body" style={{ overflowY: "auto" }}>
              {(() => {
                const ext = previewFile.name.split(".").pop()?.toLowerCase() || "";
                const isImage = ["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext);

                if (isImage) {
                  return (
                    <div className="preview-image-container">
                      <img src={previewFile.url} alt={previewFile.name} className="preview-image" />
                    </div>
                  );
                }

                if (isPreviewLoading) {
                  return (
                    <div className="empty-state" style={{ padding: "40px 0" }}>
                      <div className="spinner" style={{ margin: "0 auto 12px auto" }}></div>
                      Loading file body...
                    </div>
                  );
                }

                return (
                  <div className="preview-text-box">
                    {previewContent}
                  </div>
                );
              })()}
            </div>

            <footer className="modal-footer" style={{ borderTop: "1px solid rgba(255, 255, 255, 0.05)", paddingTop: "15px", marginTop: "5px" }}>
              <span style={{ fontSize: "12px", color: "var(--text-muted)", marginRight: "auto", display: "flex", alignSelf: "center" }}>
                Size: {formatBytes(parseInt(previewFile.size))}
              </span>
              <a
                href={previewFile.url}
                className="btn-primary"
                style={{ width: "auto", padding: "8px 16px", textDecoration: "none", fontSize: "13px" }}
                download={previewFile.name}
              >
                <DownloadIcon size={16} /> Download File
              </a>
            </footer>
          </div>
        </div>
      )}

      {/* MODAL: Select from Drive file picker */}
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
                <TrashIcon size={14} />
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
                        {isSelected && <CheckIcon size={12} />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: "10px" }}>
                        <FileIcon size={16} className="text-muted" />
                        <div>
                          <div style={{ fontSize: "14px", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {file.name}
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                            {formatBytes(parseInt(file.size))}
                          </div>
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
            <span className="toast-icon">{toast.type === "success" ? <CheckIcon size={14} /> : "⚠"}</span>
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
