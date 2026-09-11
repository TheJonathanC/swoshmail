"use client";

import { useState, useEffect, useRef } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import dynamic from "next/dynamic";
import { 
  FolderIcon, FileIcon, CloudIcon, TrashIcon, DownloadIcon, EyeIcon, 
  MailIcon, UploadIcon, ChevronRightIcon, SearchIcon, PaperclipIcon, PlusIcon, MessageIcon, CheckIcon, CloseIcon,
  AlertCircleIcon, LockIcon, RefreshCwIcon, FilesIcon, ArchiveIcon
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
  const [uploadQueueCount, setUploadQueueCount] = useState(0);
  const [uploadQueueDone, setUploadQueueDone] = useState(0);
  const [folderUploadPending, setFolderUploadPending] = useState<{ files: File[]; folderName: string } | null>(null);
  const [duplicateConflict, setDuplicateConflict] = useState<{ file: File; existingFile: FileItem; remainingQueue: File[]; targetFolderId: string } | null>(null);

  // Folder creation and deletion state
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [isSubmittingFolder, setIsSubmittingFolder] = useState(false);
  const [folderToDelete, setFolderToDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeletingFolder, setIsDeletingFolder] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeletingFile, setIsDeletingFile] = useState(false);

  // Multi-selection, Batch Delete & ZIP Download state
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [isBatchDeleteModalOpen, setIsBatchDeleteModalOpen] = useState(false);
  const [isDeletingBatch, setIsDeletingBatch] = useState(false);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [zippingTargetId, setZippingTargetId] = useState<string | null>(null);

  // File Preview state
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [previewContent, setPreviewContent] = useState("");
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Toast State
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Refs
  const mailFileInputRef = useRef<HTMLInputElement>(null);
  const driveFileInputRef = useRef<HTMLInputElement>(null);
  const driveFolderInputRef = useRef<HTMLInputElement>(null);

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
      setSelectedFileIds([]);
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

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
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
    if (!newFolderName.trim() || isSubmittingFolder) return;

    setIsSubmittingFolder(true);
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
        addToast("success", "Folder Created", `Folder "${newFolderName.trim()}" created.`);
        setNewFolderName("");
        setIsCreatingFolder(false);
        fetchDriveFiles();
      } else {
        const data = await res.json();
        addToast("danger", "Failed", data.error || "Could not create folder.");
      }
    } catch (err) {
      addToast("danger", "Error", "Network error while creating folder.");
    } finally {
      setIsSubmittingFolder(false);
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

  // --- Multi-file & folder upload handlers ---

  const handleDriveFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const filesList = e.target.files;
    if (!filesList || filesList.length === 0) return;
    const files = Array.from(filesList);
    startUploadQueue(files, currentFolderId);
    if (driveFileInputRef.current) driveFileInputRef.current.value = "";
  };

  const handleDriveFolderUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const filesList = e.target.files;
    if (!filesList || filesList.length === 0) return;
    const files = Array.from(filesList);
    // Detect folder name from webkitRelativePath (e.g. "MyFolder/file.txt")
    const firstPath = (files[0] as any).webkitRelativePath || "";
    const folderName = firstPath.split("/")[0] || "Uploaded Folder";
    setFolderUploadPending({ files, folderName });
    if (driveFolderInputRef.current) driveFolderInputRef.current.value = "";
  };

  const handleFolderUploadChoice = async (createFolder: boolean) => {
    if (!folderUploadPending) return;
    const { files, folderName } = folderUploadPending;
    setFolderUploadPending(null);

    if (createFolder) {
      // Create the folder first, then upload files into it
      try {
        const res = await fetch("/api/drive/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: folderName,
            parentId: currentFolderId === "root" ? null : currentFolderId,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          addToast("success", "Folder Created", `Folder "${folderName}" created.`);
          startUploadQueue(files, data.folder.id);
          // Navigate to the new folder so user sees files appearing
          setCurrentFolderId(data.folder.id);
        } else {
          const data = await res.json();
          addToast("danger", "Folder Error", data.error || "Could not create folder.");
          // Still upload files to current folder as fallback
          startUploadQueue(files, currentFolderId);
        }
      } catch {
        addToast("danger", "Error", "Network error creating folder.");
        startUploadQueue(files, currentFolderId);
      }
    } else {
      // Upload files flat into current folder
      startUploadQueue(files, currentFolderId);
    }
  };

  const handleDriveDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    // Try to detect folder entries via DataTransfer API
    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const entries: FileSystemEntry[] = [];
      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }

      // Check if any entry is a directory
      const dirEntry = entries.find((e) => e.isDirectory);
      if (dirEntry) {
        // Read all files from the directory recursively
        const folderFiles = await readDirectoryFiles(dirEntry as FileSystemDirectoryEntry);
        if (folderFiles.length > 0) {
          setFolderUploadPending({ files: folderFiles, folderName: dirEntry.name });
          return;
        }
      }
    }

    // Fallback: regular file drop (single or multi)
    const filesList = e.dataTransfer.files;
    if (filesList && filesList.length > 0) {
      startUploadQueue(Array.from(filesList), currentFolderId);
    }
  };

  // Recursively read all files from a FileSystemDirectoryEntry
  const readDirectoryFiles = (dirEntry: FileSystemDirectoryEntry): Promise<File[]> => {
    return new Promise((resolve) => {
      const allFiles: File[] = [];
      const reader = dirEntry.createReader();
      const readEntries = () => {
        reader.readEntries(async (entries) => {
          if (entries.length === 0) {
            resolve(allFiles);
            return;
          }
          for (const entry of entries) {
            if (entry.isFile) {
              const file = await new Promise<File>((res) => (entry as FileSystemFileEntry).file(res));
              allFiles.push(file);
            } else if (entry.isDirectory) {
              const subFiles = await readDirectoryFiles(entry as FileSystemDirectoryEntry);
              allFiles.push(...subFiles);
            }
          }
          readEntries(); // Continue reading (batched results)
        });
      };
      readEntries();
    });
  };

  // Start processing an upload queue
  const startUploadQueue = (files: File[], targetFolderId: string) => {
    if (files.length === 0) return;
    setUploadQueueCount(files.length);
    setUploadQueueDone(0);
    processNextUpload(files, 0, targetFolderId);
  };

  // Process files one by one from the queue
  const processNextUpload = (queue: File[], index: number, targetFolderId: string) => {
    if (index >= queue.length) {
      // All done
      setIsDriveUploading(false);
      setUploadQueueCount(0);
      setUploadQueueDone(0);
      fetchDriveFiles();
      return;
    }

    const file = queue[index];

    // Check for duplicates in the current folder's files
    const existingDup = driveFiles.find(
      (f) => f.name === file.name && (
        (targetFolderId === "root" && f.folder_id === null) ||
        f.folder_id === targetFolderId
      )
    );

    if (existingDup) {
      // Show duplicate conflict modal, pause queue
      setDuplicateConflict({
        file,
        existingFile: existingDup,
        remainingQueue: queue,
        targetFolderId,
      });
      return; // paused until user decides
    }

    // No duplicate - upload directly
    uploadSingleFile(file, targetFolderId, null, queue, index);
  };

  // Handle user's choice on a duplicate conflict
  const handleDuplicateChoice = (action: "replace" | "rename" | "skip") => {
    if (!duplicateConflict) return;
    const { file, existingFile, remainingQueue, targetFolderId } = duplicateConflict;
    setDuplicateConflict(null);

    const nextIndex = remainingQueue.indexOf(file) + 1;

    if (action === "skip") {
      setUploadQueueDone((prev) => prev + 1);
      processNextUpload(remainingQueue, nextIndex, targetFolderId);
    } else if (action === "replace") {
      uploadSingleFile(file, targetFolderId, existingFile.id, remainingQueue, remainingQueue.indexOf(file));
    } else if (action === "rename") {
      // Rename the file by appending (1), (2), etc.
      const ext = file.name.includes(".") ? "." + file.name.split(".").pop() : "";
      const baseName = ext ? file.name.slice(0, -(ext.length)) : file.name;
      let counter = 1;
      let newName = `${baseName} (${counter})${ext}`;
      // Check against existing files to find a unique name
      while (driveFiles.some((f) => f.name === newName && (
        (targetFolderId === "root" && f.folder_id === null) || f.folder_id === targetFolderId
      ))) {
        counter++;
        newName = `${baseName} (${counter})${ext}`;
      }
      // Create a renamed File object
      const renamedFile = new File([file], newName, { type: file.type, lastModified: file.lastModified });
      uploadSingleFile(renamedFile, targetFolderId, null, remainingQueue, remainingQueue.indexOf(file));
    }
  };

  // Upload a single file to the drive with XHR for progress tracking
  const uploadSingleFile = (
    file: File,
    targetFolderId: string,
    replaceFileId: string | null,
    queue: File[],
    currentIndex: number
  ) => {
    const totalBytes = queue.reduce((sum, f) => sum + f.size, 0);
    if (!replaceFileId && totalUsed + file.size > ONE_GB) {
      addToast("danger", "Quota Exceeded", `"${file.name}" exceeds your 1 GB drive storage limit.`);
      setUploadQueueDone((prev) => prev + 1);
      processNextUpload(queue, currentIndex + 1, targetFolderId);
      return;
    }

    setIsDriveUploading(true);
    setDriveUploadProgress(0);

    const formData = new FormData();
    formData.append("file", file);
    if (targetFolderId !== "root") formData.append("folderId", targetFolderId);
    if (replaceFileId) formData.append("replaceFileId", replaceFileId);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/drive");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setDriveUploadProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status === 200 && data.success) {
          const verb = data.replaced ? "Replaced" : "Uploaded";
          addToast("success", verb, `${file.name} saved to Swosh Drive.`);
          if (data.file) {
            setDriveFiles((prev) => {
              if (data.replaced) {
                return prev.map((f) => (f.id === data.file.id ? data.file : f));
              }
              return [data.file, ...prev.filter((f) => f.id !== data.file.id)];
            });
          }
        } else {
          addToast("danger", "Upload Failed", data.error || `Could not save ${file.name}.`);
        }
      } catch (err) {
        addToast("danger", "Upload Error", "Server returned an invalid response.");
      }
      setUploadQueueDone((prev) => prev + 1);
      processNextUpload(queue, currentIndex + 1, targetFolderId);
    };
    xhr.onerror = () => {
      addToast("danger", "Network Error", `Failed to upload ${file.name}.`);
      setUploadQueueDone((prev) => prev + 1);
      processNextUpload(queue, currentIndex + 1, targetFolderId);
    };
    xhr.send(formData);
  };

  const handleDriveFileDelete = (fileId: string, fileName: string) => {
    setFileToDelete({ id: fileId, name: fileName });
  };

  const confirmFileDelete = async () => {
    if (!fileToDelete || isDeletingFile) return;
    setIsDeletingFile(true);

    try {
      const res = await fetch("/api/drive/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId: fileToDelete.id }),
      });

      if (res.ok) {
        addToast("success", "Deleted", `${fileToDelete.name} was removed.`);
        setAttachedDriveFiles((prev) => prev.filter((f) => f.id !== fileToDelete.id));
        setSelectedFileIds((prev) => prev.filter((id) => id !== fileToDelete.id));
        fetchDriveFiles();
      } else {
        const data = await res.json();
        addToast("danger", "Delete Failed", data.error || "Failed to delete file.");
      }
    } catch {
      addToast("danger", "Delete Error", "Could not connect to database.");
    } finally {
      setIsDeletingFile(false);
      setFileToDelete(null);
    }
  };

  // --- Multi-selection handlers ---
  const toggleSelectFile = (fileId: string) => {
    setSelectedFileIds((prev) =>
      prev.includes(fileId) ? prev.filter((id) => id !== fileId) : [...prev, fileId]
    );
  };

  const toggleSelectAll = () => {
    const visibleIds = filteredDriveFiles.map((f) => f.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedFileIds.includes(id));
    if (allSelected) {
      setSelectedFileIds((prev) => prev.filter((id) => !visibleIds.includes(id)));
    } else {
      setSelectedFileIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  const clearSelection = () => {
    setSelectedFileIds([]);
  };

  const confirmBatchDelete = async () => {
    if (selectedFileIds.length === 0 || isDeletingBatch) return;
    setIsDeletingBatch(true);

    try {
      const res = await fetch("/api/drive/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: selectedFileIds }),
      });

      if (res.ok) {
        const count = selectedFileIds.length;
        addToast("success", "Files Deleted", `${count} ${count === 1 ? "file was" : "files were"} permanently removed.`);
        setAttachedDriveFiles((prev) => prev.filter((f) => !selectedFileIds.includes(f.id)));
        setSelectedFileIds([]);
        setIsBatchDeleteModalOpen(false);
        fetchDriveFiles();
      } else {
        const data = await res.json();
        addToast("danger", "Delete Failed", data.error || "Failed to delete files.");
      }
    } catch {
      addToast("danger", "Delete Error", "Could not connect to database.");
    } finally {
      setIsDeletingBatch(false);
    }
  };

  const handleDownloadSelectedZip = async () => {
    if (selectedFileIds.length === 0 || isDownloadingZip) return;
    setIsDownloadingZip(true);
    addToast("success", "Preparing Archive", `Zipping ${selectedFileIds.length} ${selectedFileIds.length === 1 ? "file" : "files"}...`);

    try {
      const res = await fetch("/api/drive/zip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileIds: selectedFileIds }),
      });

      if (!res.ok) {
        const err = await res.json();
        addToast("danger", "Download Failed", err.error || "Failed to generate ZIP archive.");
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition");
      let filename = `swosh-drive-${new Date().toISOString().slice(0, 10)}.zip`;
      if (disposition && disposition.includes("filename=")) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = decodeURIComponent(match[1]);
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      addToast("success", "Archive Ready", `"${filename}" has been downloaded.`);
    } catch (err) {
      console.error("ZIP download error:", err);
      addToast("danger", "Download Error", "Failed to download ZIP archive.");
    } finally {
      setIsDownloadingZip(false);
    }
  };

  const handleDownloadFolderZip = async (folderId: string, folderName: string) => {
    if (isDownloadingZip) return;
    setIsDownloadingZip(true);
    setZippingTargetId(folderId);
    addToast("success", "Preparing Folder", `Zipping folder "${folderName}" and all contents...`);

    try {
      const res = await fetch(`/api/drive/zip?folderId=${encodeURIComponent(folderId)}`);

      if (!res.ok) {
        const err = await res.json();
        addToast("danger", "Download Failed", err.error || "Failed to generate folder ZIP.");
        return;
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const disposition = res.headers.get("Content-Disposition");
      let filename = `${folderName}.zip`;
      if (disposition && disposition.includes("filename=")) {
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = decodeURIComponent(match[1]);
      }
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      addToast("success", "Folder Ready", `"${filename}" has been downloaded.`);
    } catch (err) {
      console.error("Folder ZIP download error:", err);
      addToast("danger", "Download Error", "Failed to download folder ZIP archive.");
    } finally {
      setIsDownloadingZip(false);
      setZippingTargetId(null);
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
      {/* 1. Sidebar / Mobile Top Navigation */}
      <aside className="sidebar">
        <div className="sidebar-top-section">
          <div className="sidebar-header-row">
            <div className="dashboard-logo">
              <div className="logo-icon">
                <div style={{ transform: "rotate(-10deg)", display: "flex" }}>
                  <MailIcon size={22} />
                </div>
              </div>
              <span className="logo-text">Swoshmail</span>
            </div>

            <div className="mobile-user-actions">
              <div className="mobile-user-badge" title={`@${session?.user?.name}`}>
                <span className="user-dot"></span>
                <span className="user-handle">@{session?.user?.name}</span>
              </div>
              <button className="btn-secondary lock-btn" onClick={handleLogout} title="Lock Console" aria-label="Lock Console">
                <LockIcon size={13} />
                <span className="lock-btn-text">Lock</span>
              </button>
            </div>
          </div>

          <nav className="sidebar-menu" aria-label="Main Navigation">
            <button
              className={`nav-item ${activeTab === "mail" ? "active" : ""}`}
              onClick={() => setActiveTab("mail")}
            >
              <MailIcon size={18} />
              <span className="nav-label-desktop">Swosh Mail</span>
              <span className="nav-label-mobile">Mail</span>
            </button>
            <button
              className={`nav-item ${activeTab === "drive" ? "active" : ""}`}
              onClick={() => setActiveTab("drive")}
            >
              <CloudIcon size={18} />
              <span className="nav-label-desktop">Swosh Drive</span>
              <span className="nav-label-mobile">Drive</span>
            </button>
            <button
              className={`nav-item ${activeTab === "chat" ? "active" : ""}`}
              onClick={() => setActiveTab("chat")}
            >
              <MessageIcon size={18} />
              <span className="nav-label-desktop">Swosh Chat</span>
              <span className="nav-label-mobile">Chat</span>
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

          <div className="desktop-user-row" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderTop: "1px solid rgba(255, 255, 255, 0.05)" }}>
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
                  <div className="input-desc">Defaults to &ldquo;Swoshmail Message&rdquo; or attachment listings.</div>
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
                <div className="attachment-buttons-row">
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
                        ⚠️ Total local uploads size ({formatBytes(totalDirectBytes)}) exceeds Vercel&apos;s **4.5 MB request limit**. Uploading will likely fail. Consider uploading files to Swosh Drive first, then attaching them!
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
          <div className="drive-tab-content">
            <div className="drive-header-bar">
              <div className="drive-title-row">
                <h2 className="module-title">Swosh Drive Explorer</h2>
                <div className="mobile-quota-badge">
                  <CloudIcon size={12} /> {formatBytes(totalUsed)} / 1 GB
                </div>
              </div>
              <div className="drive-actions-group">
                <button
                  type="button"
                  className="btn-secondary drive-action-btn"
                  onClick={() => {
                    setNewFolderName("");
                    setIsCreatingFolder(true);
                  }}
                >
                  <PlusIcon size={16} /> <span className="drive-btn-text">New Folder</span>
                </button>

                <button
                  type="button"
                  className="btn-secondary drive-action-btn"
                  onClick={() => driveFolderInputRef.current?.click()}
                  disabled={isDriveUploading}
                >
                  <FolderIcon size={16} /> <span className="drive-btn-text">Upload Folder</span>
                </button>

                <button
                  type="button"
                  className="btn-primary drive-action-btn"
                  onClick={() => driveFileInputRef.current?.click()}
                  disabled={isDriveUploading}
                >
                  {isDriveUploading ? (
                    uploadQueueCount > 1
                      ? `Uploading ${uploadQueueDone + 1}/${uploadQueueCount}...`
                      : "Uploading..."
                  ) : (
                    <>
                      <UploadIcon size={16} /> <span className="drive-btn-text">Upload Files</span>
                    </>
                  )}
                </button>
                <input
                  type="file"
                  multiple
                  ref={driveFileInputRef}
                  onChange={handleDriveFileUpload}
                  style={{ display: "none" }}
                />
                <input
                  type="file"
                  ref={driveFolderInputRef}
                  onChange={handleDriveFolderUpload}
                  style={{ display: "none" }}
                  {...({ webkitdirectory: "", directory: "" } as any)}
                />
              </div>
            </div>

            {/* Breadcrumb Navigation Trail */}
            <div className="breadcrumbs-bar">
              <div className="breadcrumbs-trail">
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

              {currentFolderId !== "root" && (
                <button
                  type="button"
                  className="btn-download-folder"
                  title="Download this folder and all contents as ZIP"
                  onClick={() => {
                    const currentFolderName = breadcrumbs.length > 0 ? breadcrumbs[breadcrumbs.length - 1].name : "folder";
                    handleDownloadFolderZip(currentFolderId, currentFolderName);
                  }}
                  disabled={isDownloadingZip}
                >
                  {isDownloadingZip && zippingTargetId === currentFolderId ? (
                    <>
                      <div className="spinner-sm" />
                      <span>Zipping...</span>
                    </>
                  ) : (
                    <>
                      <ArchiveIcon size={14} />
                      <span>Download Folder (.zip)</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Dropzone file upload */}
            <div
              className={`dropzone ${isDragging ? "active" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDriveDrop}
              onClick={() => driveFileInputRef.current?.click()}
            >
              <div className="dropzone-icon" style={{ color: "var(--primary)" }}><CloudIcon size={36} /></div>
              <div className="dropzone-title">
                <span className="desktop-drop-text">Drag files or a folder here to upload directly to this directory</span>
                <span className="mobile-drop-text">Tap or drop files / folder to upload</span>
              </div>
            </div>

            {isDriveUploading && (
              <div className="progress-container" style={{ marginTop: "12px", marginBottom: "20px" }}>
                <div className="progress-label">
                  <span>
                    {uploadQueueCount > 1
                      ? `Uploading file ${Math.min(uploadQueueDone + 1, uploadQueueCount)} of ${uploadQueueCount}...`
                      : "Uploading file..."}
                  </span>
                  <span>{driveUploadProgress}%</span>
                </div>
                <div className="progress-bar-wrapper">
                  <div className="progress-bar-fill" style={{ width: `${driveUploadProgress}%` }}></div>
                </div>
              </div>
            )}

            {/* Selection Action Toolbar */}
            {selectedFileIds.length > 0 && (
              <div className="drive-selection-toolbar">
                <div className="selection-info-group">
                  <span className="selection-count-badge">{selectedFileIds.length}</span>
                  <span className="selection-text">
                    {selectedFileIds.length === 1 ? "1 file selected" : `${selectedFileIds.length} files selected`}
                  </span>
                  <button
                    type="button"
                    className="selection-text-btn"
                    onClick={toggleSelectAll}
                  >
                    {filteredDriveFiles.length > 0 && filteredDriveFiles.every((f) => selectedFileIds.includes(f.id))
                      ? "Deselect all"
                      : "Select all"}
                  </button>
                </div>
                <div className="selection-actions-group">
                  <button
                    type="button"
                    className="btn-secondary selection-btn"
                    onClick={handleDownloadSelectedZip}
                    disabled={isDownloadingZip}
                    title="Download selected files as a ZIP archive"
                  >
                    {isDownloadingZip && !zippingTargetId ? (
                      <>
                        <div className="spinner-sm" />
                        <span>Zipping...</span>
                      </>
                    ) : (
                      <>
                        <ArchiveIcon size={15} />
                        <span>Download ZIP</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn-danger selection-btn"
                    onClick={() => setIsBatchDeleteModalOpen(true)}
                    disabled={isDeletingBatch}
                    title="Delete selected files"
                  >
                    <TrashIcon size={15} />
                    <span>Delete ({selectedFileIds.length})</span>
                  </button>
                  <button
                    type="button"
                    className="selection-btn-close"
                    title="Clear selection"
                    aria-label="Clear selection"
                    onClick={clearSelection}
                  >
                    <CloseIcon size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* File search explorer */}
            <div className="form-group drive-search-group">
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
                    <div className="folder-card-actions">
                      <button
                        type="button"
                        className="folder-action-btn download"
                        title="Download folder as ZIP"
                        aria-label={`Download folder ${folder.name} as ZIP`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownloadFolderZip(folder.id, folder.name);
                        }}
                        disabled={isDownloadingZip}
                      >
                        {isDownloadingZip && zippingTargetId === folder.id ? (
                          <div className="spinner-sm" />
                        ) : (
                          <DownloadIcon size={14} />
                        )}
                      </button>
                      <button
                        type="button"
                        className="folder-action-btn delete"
                        title="Delete folder and contents"
                        aria-label={`Delete folder ${folder.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setFolderToDelete({ id: folder.id, name: folder.name });
                        }}
                      >
                        <TrashIcon size={14} />
                      </button>
                    </div>
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
                        <th className="drive-col-select">
                          <input
                            type="checkbox"
                            className="drive-checkbox"
                            checked={
                              filteredDriveFiles.length > 0 &&
                              filteredDriveFiles.every((f) => selectedFileIds.includes(f.id))
                            }
                            ref={(el) => {
                              if (el) {
                                const count = filteredDriveFiles.filter((f) => selectedFileIds.includes(f.id)).length;
                                el.indeterminate = count > 0 && count < filteredDriveFiles.length;
                              }
                            }}
                            onChange={toggleSelectAll}
                            title="Select all"
                            aria-label="Select all files"
                          />
                        </th>
                        <th>Name</th>
                        <th>Size</th>
                        <th>Uploaded</th>
                        <th className="drive-actions-th">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDriveFiles.map((file) => (
                        <tr
                          key={file.id}
                          className={`drive-file-row ${selectedFileIds.includes(file.id) ? "selected" : ""}`}
                        >
                          <td className="drive-col-select" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="drive-checkbox"
                              checked={selectedFileIds.includes(file.id)}
                              onChange={() => toggleSelectFile(file.id)}
                              aria-label={`Select ${file.name}`}
                            />
                          </td>
                          <td className="drive-col-name">
                            <div className="drive-file-main-info">
                              <span className="drive-file-icon-badge"><FileIcon size={18} /></span>
                              <div className="drive-file-text-col">
                                <span className="drive-file-name" title={file.name}>
                                  {file.name}
                                </span>

                                <span className="drive-mobile-meta">
                                  {formatBytes(parseInt(file.size))} &bull; {new Date(file.uploaded_at).toLocaleDateString()}
                                </span>
                              </div>
                            </div>
                          </td>
                          <td className="drive-col-size">{formatBytes(parseInt(file.size))}</td>
                          <td className="drive-col-date">
                            {new Date(file.uploaded_at).toLocaleDateString()}
                          </td>
                          <td className="drive-col-actions">
                            <div className="action-buttons-cell">
                              {isPreviewable(file.name) && (
                                <button
                                  type="button"
                                  className="btn-icon"
                                  title="Preview File"
                                  aria-label="Preview File"
                                  onClick={() => handleFilePreview(file)}
                                >
                                  <EyeIcon size={16} />
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn-icon"
                                title="Attach to Swosh Mail"
                                aria-label="Attach to Swosh Mail"
                                onClick={() => handleDriveFileMail(file)}
                              >
                                <MailIcon size={16} />
                              </button>
                              <a
                                href={file.url}
                                className="btn-icon"
                                title="Download"
                                aria-label="Download"
                                download={file.name}
                              >
                                <DownloadIcon size={16} />
                              </a>
                              <button
                                type="button"
                                className="btn-icon delete"
                                title="Delete File"
                                aria-label="Delete File"
                                onClick={() => handleDriveFileDelete(file.id, file.name)}
                              >
                                <TrashIcon size={16} />
                              </button>
                            </div>
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
          <div className="chat-tab-wrapper">
            <h2 className="module-title desktop-chat-title">Swosh Chat</h2>
            <ChatPanel
              userId={(session?.user as any)?.id}
              username={(session?.user as any)?.username || session?.user?.name || ""}
            />
          </div>
        )}
      </main>

      {/* MODAL: Create New Folder */}
      {isCreatingFolder && (
        <div className="modal-overlay" onClick={() => !isSubmittingFolder && setIsCreatingFolder(false)}>
          <div className="modal-content glass-panel" style={{ maxWidth: "420px" }} onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleCreateFolder}>
              <header className="modal-header">
                <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--foreground)" }}>
                  <span className="folder-icon" style={{ display: "inline-flex" }}><FolderIcon size={20} /></span> New Folder
                </h3>
                <button
                  type="button"
                  className="btn-remove"
                  style={{ padding: "6px" }}
                  onClick={() => setIsCreatingFolder(false)}
                  disabled={isSubmittingFolder}
                  title="Close"
                  aria-label="Close modal"
                >
                  <CloseIcon size={16} />
                </button>
              </header>
              <div className="modal-body" style={{ padding: "16px 0 20px 0" }}>
                <label className="form-label" htmlFor="popup-folder-input">Folder Name</label>
                <input
                  id="popup-folder-input"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Invoices, Project Assets..."
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  autoFocus
                  maxLength={60}
                  disabled={isSubmittingFolder}
                  required
                />
              </div>
              <footer className="modal-footer" style={{ borderTop: "1px solid rgba(255, 255, 255, 0.05)", paddingTop: "15px" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: "10px 16px" }}
                  onClick={() => {
                    setIsCreatingFolder(false);
                    setNewFolderName("");
                  }}
                  disabled={isSubmittingFolder}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  style={{ padding: "10px 18px", width: "auto" }}
                  disabled={!newFolderName.trim() || isSubmittingFolder}
                >
                  {isSubmittingFolder ? <div className="spinner"></div> : "Create Folder"}
                </button>
              </footer>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Folder Delete Confirmation */}
      {folderToDelete && (
        <div className="modal-overlay" onClick={() => !isDeletingFolder && setFolderToDelete(null)}>
          <div className="modal-content glass-panel" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--danger)" }}>
                <TrashIcon size={18} /> Delete Folder
              </h3>
              <button
                type="button"
                className="btn-remove"
                style={{ padding: "6px" }}
                onClick={() => setFolderToDelete(null)}
                disabled={isDeletingFolder}
                title="Close"
                aria-label="Close modal"
              >
                <CloseIcon size={16} />
              </button>
            </header>
            <div className="modal-body" style={{ padding: "20px 0" }}>
              <p style={{ marginBottom: "12px", fontSize: "14px", lineHeight: 1.5 }}>
                Are you sure you want to delete the folder <strong>&ldquo;{folderToDelete.name}&rdquo;</strong>?
              </p>
              <div className="error-text" style={{ background: "rgba(239,68,68,0.1)", padding: "12px", borderRadius: "8px", color: "var(--danger)" }}>
                ⚠️ <strong>WARNING:</strong> This will permanently delete all files and subfolders inside it. This action cannot be undone.
              </div>
            </div>
            <footer className="modal-footer" style={{ borderTop: "1px solid rgba(255, 255, 255, 0.05)", paddingTop: "15px" }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: "10px 16px" }}
                onClick={() => setFolderToDelete(null)}
                disabled={isDeletingFolder}
              >
                Cancel
              </button>
              <button
                type="button"
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

      {/* MODAL: File Delete Confirmation */}
      {fileToDelete && (
        <div className="modal-overlay" onClick={() => !isDeletingFile && setFileToDelete(null)}>
          <div className="modal-content glass-panel" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--danger)" }}>
                <TrashIcon size={18} /> Delete File
              </h3>
              <button
                type="button"
                className="btn-remove"
                style={{ padding: "6px" }}
                onClick={() => setFileToDelete(null)}
                disabled={isDeletingFile}
                title="Close"
                aria-label="Close modal"
              >
                <CloseIcon size={16} />
              </button>
            </header>
            <div className="modal-body" style={{ padding: "20px 0" }}>
              <p style={{ marginBottom: "12px", fontSize: "14px", lineHeight: 1.5 }}>
                Are you sure you want to delete <strong>&ldquo;{fileToDelete.name}&rdquo;</strong>?
              </p>
              <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.5 }}>
                This file will be permanently removed from your Swosh Drive. This action cannot be undone.
              </p>
            </div>
            <footer className="modal-footer" style={{ borderTop: "1px solid rgba(255, 255, 255, 0.05)", paddingTop: "15px" }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: "10px 16px" }}
                onClick={() => setFileToDelete(null)}
                disabled={isDeletingFile}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ background: "var(--danger)", padding: "10px 16px", width: "auto" }}
                onClick={confirmFileDelete}
                disabled={isDeletingFile}
              >
                {isDeletingFile ? <div className="spinner"></div> : "Delete File"}
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* MODAL: Batch Delete Confirmation */}
      {isBatchDeleteModalOpen && (
        <div className="modal-overlay" onClick={() => !isDeletingBatch && setIsBatchDeleteModalOpen(false)}>
          <div className="modal-content glass-panel" style={{ maxWidth: "440px" }} onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--danger)" }}>
                <TrashIcon size={18} /> Delete Selected Files
              </h3>
              <button
                type="button"
                className="btn-remove"
                style={{ padding: "6px" }}
                onClick={() => setIsBatchDeleteModalOpen(false)}
                disabled={isDeletingBatch}
                title="Close"
                aria-label="Close modal"
              >
                <CloseIcon size={16} />
              </button>
            </header>
            <div className="modal-body" style={{ padding: "16px 0" }}>
              <p style={{ marginBottom: "12px", fontSize: "14px", lineHeight: 1.5 }}>
                Are you sure you want to delete <strong>{selectedFileIds.length} {selectedFileIds.length === 1 ? "file" : "files"}</strong>?
              </p>
              <div className="batch-delete-preview-list">
                {driveFiles
                  .filter((f) => selectedFileIds.includes(f.id))
                  .slice(0, 5)
                  .map((f) => (
                    <div key={f.id} className="batch-delete-item">
                      <span className="batch-delete-icon"><FileIcon size={14} /></span>
                      <span className="batch-delete-name" title={f.name}>{f.name}</span>
                      <span className="batch-delete-size">{formatBytes(parseInt(f.size))}</span>
                    </div>
                  ))}
                {selectedFileIds.length > 5 && (
                  <div className="batch-delete-overflow">
                    +{selectedFileIds.length - 5} more files selected
                  </div>
                )}
              </div>
              <p style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "12px", lineHeight: 1.5 }}>
                These files will be permanently removed from your Swosh Drive. This action cannot be undone.
              </p>
            </div>
            <footer className="modal-footer" style={{ borderTop: "1px solid rgba(255, 255, 255, 0.05)", paddingTop: "15px" }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: "10px 16px" }}
                onClick={() => setIsBatchDeleteModalOpen(false)}
                disabled={isDeletingBatch}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                style={{ background: "var(--danger)", padding: "10px 16px", width: "auto" }}
                onClick={confirmBatchDelete}
                disabled={isDeletingBatch}
              >
                {isDeletingBatch ? (
                  <div className="spinner"></div>
                ) : (
                  `Delete ${selectedFileIds.length} ${selectedFileIds.length === 1 ? "File" : "Files"}`
                )}
              </button>
            </footer>
          </div>
        </div>
      )}


      {/* MODAL: Folder Upload Decision */}
      {folderUploadPending && (
        <div className="modal-overlay" onClick={() => setFolderUploadPending(null)}>
          <div className="modal-content glass-panel" style={{ maxWidth: "460px" }} onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--foreground)" }}>
                <span className="folder-icon" style={{ display: "inline-flex" }}><FolderIcon size={20} /></span> Upload Folder
              </h3>
              <button
                type="button"
                className="btn-remove"
                style={{ padding: "6px" }}
                onClick={() => setFolderUploadPending(null)}
                title="Cancel"
                aria-label="Cancel folder upload"
              >
                <CloseIcon size={16} />
              </button>
            </header>
            <div className="modal-body" style={{ padding: "16px 0 20px 0" }}>
              <p style={{ marginBottom: "12px", fontSize: "14px", lineHeight: 1.5 }}>
                You selected folder <strong>&ldquo;{folderUploadPending.folderName}&rdquo;</strong> containing{" "}
                <strong>{folderUploadPending.files.length}</strong> file{folderUploadPending.files.length === 1 ? "" : "s"} ({formatBytes(folderUploadPending.files.reduce((a, b) => a + b.size, 0))}).
              </p>
              <p style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.5, marginBottom: "16px" }}>
                How would you like to upload these files?
              </p>

              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    textAlign: "left",
                    borderRadius: "10px",
                    border: "1px solid rgba(99, 102, 241, 0.3)",
                    background: "rgba(99, 102, 241, 0.08)",
                  }}
                  onClick={() => handleFolderUploadChoice(true)}
                >
                  <span style={{ color: "var(--primary)", display: "inline-flex", flexShrink: 0 }}><FolderIcon size={20} /></span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "13.5px", color: "#fff" }}>
                      Create new folder &ldquo;{folderUploadPending.folderName}&rdquo;
                    </div>
                    <div style={{ fontSize: "11.5px", color: "var(--text-muted)", marginTop: "2px" }}>
                      Creates a folder with this name and places all files inside it
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  className="btn-secondary"
                  style={{
                    padding: "12px 14px",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    textAlign: "left",
                    borderRadius: "10px",
                  }}
                  onClick={() => handleFolderUploadChoice(false)}
                >
                  <span style={{ color: "var(--text-muted)", display: "inline-flex", flexShrink: 0 }}><FilesIcon size={20} /></span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "13.5px", color: "#fff" }}>
                      Upload files directly here
                    </div>
                    <div style={{ fontSize: "11.5px", color: "var(--text-muted)", marginTop: "2px" }}>
                      Uploads all files flat into current directory ({currentFolderId === "root" ? "Root" : breadcrumbs[breadcrumbs.length - 1]?.name || "current folder"})
                    </div>
                  </div>
                </button>
              </div>
            </div>
            <footer className="modal-footer" style={{ borderTop: "1px solid rgba(255, 255, 255, 0.05)", paddingTop: "15px" }}>
              <button
                type="button"
                className="btn-secondary"
                style={{ padding: "8px 16px" }}
                onClick={() => setFolderUploadPending(null)}
              >
                Cancel
              </button>
            </footer>
          </div>
        </div>
      )}

      {/* MODAL: Duplicate File Conflict */}
      {duplicateConflict && (
        <div className="modal-overlay">
          <div className="modal-content glass-panel" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <h3 className="modal-title" style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--foreground)" }}>
                <span style={{ color: "#f59e0b", display: "inline-flex" }}><RefreshCwIcon size={18} /></span> File Already Exists
              </h3>
              <button
                type="button"
                className="btn-remove"
                style={{ padding: "6px" }}
                onClick={() => {
                  setDuplicateConflict(null);
                  setIsDriveUploading(false);
                  setUploadQueueCount(0);
                  setUploadQueueDone(0);
                  fetchDriveFiles();
                }}
                title="Cancel upload"
                aria-label="Cancel upload"
              >
                <CloseIcon size={16} />
              </button>
            </header>
            <div className="modal-body" style={{ padding: "16px 0 20px 0" }}>
              <p style={{ fontSize: "14px", lineHeight: 1.5, marginBottom: "14px" }}>
                <strong>&ldquo;{duplicateConflict.file.name}&rdquo;</strong> already exists in this folder.
              </p>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(255, 255, 255, 0.04)", border: "1px solid rgba(255, 255, 255, 0.06)", borderRadius: "8px", padding: "10px 14px", marginBottom: "18px" }}>
                <div>
                  <span style={{ color: "var(--text-muted)", fontSize: "11.5px", display: "block" }}>Existing</span>
                  <span style={{ fontSize: "13px", fontWeight: 500 }}>{formatBytes(parseInt(duplicateConflict.existingFile.size))}</span>
                </div>
                <ChevronRightIcon size={16} className="breadcrumb-separator" />
                <div style={{ textAlign: "right" }}>
                  <span style={{ color: "var(--text-muted)", fontSize: "11.5px", display: "block" }}>New</span>
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--primary)" }}>{formatBytes(duplicateConflict.file.size)}</span>
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  className="btn-secondary"
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    justifyContent: "center",
                    border: "1px solid rgba(239, 68, 68, 0.3)",
                    color: "var(--danger)",
                    background: "rgba(239, 68, 68, 0.08)",
                  }}
                  onClick={() => handleDuplicateChoice("replace")}
                >
                  Replace
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  style={{ flex: 1, padding: "10px 14px", justifyContent: "center" }}
                  onClick={() => handleDuplicateChoice("rename")}
                >
                  Keep Both (1)
                </button>
              </div>
            </div>
            <footer className="modal-footer" style={{ borderTop: "1px solid rgba(255, 255, 255, 0.05)", paddingTop: "12px", display: "flex", justifyContent: "space-between" }}>
              {uploadQueueCount > 1 ? (
                <>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ padding: "6px 12px", fontSize: "12px" }}
                    onClick={() => handleDuplicateChoice("skip")}
                  >
                    Skip
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ padding: "6px 12px", fontSize: "12px", color: "var(--text-muted)" }}
                    onClick={() => {
                      setDuplicateConflict(null);
                      setIsDriveUploading(false);
                      setUploadQueueCount(0);
                      setUploadQueueDone(0);
                      fetchDriveFiles();
                    }}
                  >
                    Cancel all
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="btn-secondary"
                  style={{ padding: "6px 14px", fontSize: "12px", marginLeft: "auto" }}
                  onClick={() => {
                    setDuplicateConflict(null);
                    setIsDriveUploading(false);
                    setUploadQueueCount(0);
                    setUploadQueueDone(0);
                  }}
                >
                  Cancel
                </button>
              )}
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
                title="Close"
              >
                <CloseIcon size={16} />
              </button>
            </header>

            <div className="modal-body" style={{ overflowY: "auto" }}>
              {(() => {
                const ext = previewFile.name.split(".").pop()?.toLowerCase() || "";
                const isImage = ["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext);

                if (isImage) {
                  return (
                    <div className="preview-image-container">
                      <img
                        src={`${previewFile.url}&inline=true`}
                        alt={previewFile.name}
                        className="preview-image"
                      />
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
                title="Close"
              >
                <CloseIcon size={16} />
              </button>
            </header>

            <div className="modal-body">
              {/* Folder navigation inside attach modal */}
              {folders.length > 0 && (
                <div className="attach-folder-nav" style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "10px", marginBottom: "8px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className={`btn-secondary ${currentFolderId === "root" ? "active" : ""}`}
                    style={{ padding: "4px 10px", fontSize: "12px", background: currentFolderId === "root" ? "var(--primary-glow)" : undefined, color: currentFolderId === "root" ? "var(--primary)" : undefined }}
                    onClick={() => setCurrentFolderId("root")}
                  >
                    <CloudIcon size={12} /> Root
                  </button>
                  {folders.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      className={`btn-secondary ${currentFolderId === f.id ? "active" : ""}`}
                      style={{ padding: "4px 10px", fontSize: "12px", background: currentFolderId === f.id ? "var(--primary-glow)" : undefined, color: currentFolderId === f.id ? "var(--primary)" : undefined }}
                      onClick={() => setCurrentFolderId(f.id)}
                    >
                      <FolderIcon size={12} /> {f.name}
                    </button>
                  ))}
                </div>
              )}

              {driveFiles.length === 0 ? (
                <div className="empty-state" style={{ padding: "20px 0" }}>
                  No files found in this folder.
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
      <div className="toast-container" aria-live="polite">
        {toasts.slice(-3).map((toast) => (
          <div
            key={toast.id}
            className={`toast toast-${toast.type}`}
            onClick={() => removeToast(toast.id)}
            role="alert"
          >
            <div className="toast-icon-wrapper">
              {toast.type === "success" ? <CheckIcon size={16} /> : <AlertCircleIcon size={16} />}
            </div>
            <div className="toast-content">
              <div className="toast-title">{toast.title}</div>
              <div className="toast-message">{toast.message}</div>
            </div>
            <button
              type="button"
              className="toast-close-btn"
              onClick={(e) => {
                e.stopPropagation();
                removeToast(toast.id);
              }}
              aria-label="Dismiss notification"
            >
              <CloseIcon size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
