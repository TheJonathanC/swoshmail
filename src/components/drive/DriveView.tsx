"use client";

import { useCallback, useId, useMemo, useRef, useState, type InputHTMLAttributes } from "react";
import type { CreateFolderTreeResponse, FileItem, FolderItem } from "@/types/api";
import { AlertCircleIcon, ArchiveIcon, FileIcon, RefreshCwIcon, SearchIcon } from "@/components/Icons";
import { useToast } from "@/components/ui/Toast";
import { useDriveListing } from "@/hooks/useDriveListing";
import { useDriveUploads, type UploadEntry } from "@/hooks/useDriveUploads";
import { useNoteEditor } from "@/hooks/useNoteEditor";
import { useSelection } from "@/hooks/useSelection";
import { useZipDownload } from "@/hooks/useZipDownload";
import { errorMessage, postJson } from "@/lib/client/api";
import { ONE_GB, pluralize } from "@/lib/client/files";
import { bundleDirectories, bundlesFromInput, readDrop, type DropPayload, type FolderBundle } from "@/lib/client/folderEntries";
import Breadcrumbs from "./Breadcrumbs";
import DriveToolbar from "./DriveToolbar";
import Dropzone from "./Dropzone";
import FileList from "./FileList";
import FolderGrid from "./FolderGrid";
import { folderPath } from "./FolderPicker";
import SelectionToolbar from "./SelectionToolbar";
import UploadProgressPanel from "./UploadProgressPanel";
import BatchDeleteModal from "./modals/BatchDeleteModal";
import DuplicateConflictModal from "./modals/DuplicateConflictModal";
import FileDeleteModal from "./modals/FileDeleteModal";
import FolderDeleteModal from "./modals/FolderDeleteModal";
import FolderUploadModal from "./modals/FolderUploadModal";
import NewFolderModal from "./modals/NewFolderModal";
import NoteEditorModal from "./modals/NoteEditorModal";
import PreviewModal from "./modals/PreviewModal";
import ShareModal from "./modals/ShareModal";
import SharedFileModal from "./modals/SharedFileModal";

export interface StorageState {
  used: number;
  quota: number;
  loaded: boolean;
}

interface DriveViewProps {
  folderId: string;
  shareToken: string | null;
  onNavigateFolder: (folderId: string) => void;
  onCloseShare: () => void;
  storage: StorageState;
  onStorage: (patch: { used?: number; quota?: number }) => void;
  onAttachToMail: (files: FileItem[]) => void;
  onFilesDeleted: (ids: string[]) => void;
  /** Bumped by other modules (e.g. mail archiving) to force a refresh. */
  refreshKey?: number;
}

// webkitdirectory isn't in React's DOM typings
const directoryInputProps = { webkitdirectory: "", directory: "" } as InputHTMLAttributes<HTMLInputElement>;

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
const toFolderParam = (id: string) => (id === "root" ? null : id);

export default function DriveView({
  folderId,
  shareToken,
  onNavigateFolder,
  onCloseShare,
  storage,
  onStorage,
  onAttachToMail,
  onFilesDeleted,
  refreshKey = 0,
}: DriveViewProps) {
  const toast = useToast();
  const searchId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [search, setSearch] = useState("");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [fileToDelete, setFileToDelete] = useState<FileItem | null>(null);
  const [folderToDelete, setFolderToDelete] = useState<FolderItem | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<FileItem | null>(null);
  const [shareFile, setShareFile] = useState<FileItem | null>(null);
  const [pendingFolders, setPendingFolders] = useState<FolderBundle[]>([]);

  const listing = useDriveListing(folderId, {
    refreshKey,
    onLoaded: (data) => onStorage({ used: data.totalUsed, quota: data.quota || ONE_GB }),
  });
  const data = listing.data;
  const trail = data?.breadcrumbs ?? [];
  const locationName = folderId === "root" ? "Drive" : trail[trail.length - 1]?.name ?? "this folder";

  const query = search.trim().toLowerCase();
  const files = useMemo(
    () => (data?.files ?? []).filter((f) => !query || f.name.toLowerCase().includes(query)),
    [data?.files, query]
  );
  const folders = useMemo(
    () => (data?.folders ?? []).filter((f) => !query || f.name.toLowerCase().includes(query)),
    [data?.folders, query]
  );
  const fileIds = useMemo(() => files.map((f) => f.id), [files]);
  const selection = useSelection(folderId, fileIds);
  const selectedFiles = useMemo(() => files.filter((f) => selection.selected.has(f.id)), [files, selection.selected]);

  const uploads = useDriveUploads({
    currentFolderId: folderId,
    currentFiles: data?.files ?? null,
    mutateListing: listing.mutate,
    reloadListing: listing.reload,
    used: storage.used,
    quota: storage.quota,
    onStorageChange: (used) => onStorage({ used }),
  });
  const zip = useZipDownload();

  const upsertFile = useCallback(
    (file: FileItem, totalUsed?: number) => {
      if ((file.folder_id ?? "root") === folderId) {
        listing.mutate((d) => ({ ...d, files: [file, ...d.files.filter((f) => f.id !== file.id)] }));
      }
      if (typeof totalUsed === "number" && Number.isFinite(totalUsed)) onStorage({ used: totalUsed });
    },
    [folderId, listing, onStorage]
  );

  const notes = useNoteEditor({ onSaved: (file, totalUsed) => upsertFile(file, totalUsed) });

  // ---- uploads
  const enqueueFlat = (list: File[], target: string) =>
    uploads.enqueue(list.map<UploadEntry>((file) => ({ file, folderId: toFolderParam(target) })));

  const handlePayload = (payload: DropPayload) => {
    if (payload.files.length > 0) enqueueFlat(payload.files, folderId);
    if (payload.folders.length > 0) setPendingFolders((prev) => [...prev, ...payload.folders]);
  };

  const onDrop = (dataTransfer: DataTransfer) => {
    readDrop(dataTransfer)
      .then(handlePayload)
      .catch(() => toast("danger", "Couldn't read the dropped items", "Try choosing the files with the Upload buttons instead."));
  };

  const chooseFolderMode = async (mode: "tree" | "flat") => {
    const [bundle, ...rest] = pendingFolders;
    setPendingFolders(rest);
    if (!bundle) return;
    const target = folderId;
    if (mode === "flat") {
      enqueueFlat(
        bundle.entries.map((e) => e.file),
        target
      );
      return;
    }
    try {
      const tree = await postJson<CreateFolderTreeResponse>("/api/drive/folders/tree", {
        parentId: toFolderParam(target),
        rootName: bundle.rootName,
        paths: bundleDirectories(bundle),
      });
      listing.reload();
      toast("success", "Folder created", `"${bundle.rootName}" was created. Uploading ${pluralize(bundle.entries.length, "file")}…`);
      uploads.enqueue(bundle.entries.map((e) => ({ file: e.file, folderId: tree.folderIds[e.dir] ?? tree.rootId })));
    } catch (err) {
      toast("danger", "Folder upload failed", `${errorMessage(err, "Couldn't create the folders.")} Nothing was uploaded.`);
    }
  };

  // ---- deletes
  const onFilesRemoved = (ids: string[], totalUsed: number) => {
    listing.mutate((d) => ({ ...d, files: d.files.filter((f) => !ids.includes(f.id)) }));
    onStorage({ used: totalUsed });
    onFilesDeleted(ids);
  };

  const onFolderRemoved = (id: string, totalUsed: number) => {
    listing.mutate((d) => ({ ...d, folders: d.folders.filter((f) => f.id !== id) }));
    onStorage({ used: totalUsed });
  };

  const onFolderCreated = (folder: FolderItem) => {
    if ((folder.parent_id ?? "root") !== folderId) return;
    listing.mutate((d) => ({ ...d, folders: [...d.folders.filter((f) => f.id !== folder.id), folder].sort(byName) }));
  };

  const attach = (list: FileItem[]) => {
    onAttachToMail(list);
    selection.clear();
  };

  // ---- content
  let content;
  if (listing.isLoading) {
    content = (
      <div className="state-panel" role="status">
        <span className="spinner" aria-hidden="true" />
        <p>Loading folder…</p>
      </div>
    );
  } else if (!data) {
    content = (
      <div className="state-panel state-error" role="alert">
        <AlertCircleIcon size={28} />
        <p className="state-title">This folder couldn&apos;t be loaded</p>
        <p className="muted-text">{listing.error ?? "Something went wrong."}</p>
        <div className="state-actions">
          <button type="button" className="btn btn-primary" onClick={listing.reload}>
            <RefreshCwIcon size={15} /> Retry
          </button>
          {folderId !== "root" && (
            <button type="button" className="btn btn-secondary" onClick={() => onNavigateFolder("root")}>
              Go to Drive
            </button>
          )}
        </div>
      </div>
    );
  } else if (files.length === 0 && folders.length === 0) {
    content = (
      <div className="state-panel">
        <FileIcon size={28} />
        {query ? (
          <>
            <p className="state-title">Nothing matches &ldquo;{search.trim()}&rdquo;</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSearch("")}>
              Clear search
            </button>
          </>
        ) : (
          <>
            <p className="state-title">This folder is empty</p>
            <p className="muted-text">Upload files, drop a folder above or create a note.</p>
          </>
        )}
      </div>
    );
  } else {
    content = (
      <>
        <FolderGrid
          folders={folders}
          onOpen={onNavigateFolder}
          onZip={(f) => zip.downloadFolder(f.id, f.name)}
          onDelete={setFolderToDelete}
        />
        <FileList
          files={files}
          selected={selection.selected}
          allSelected={selection.allSelected}
          someSelected={selection.someSelected}
          onToggle={selection.toggle}
          onToggleAll={selection.toggleAll}
          onPreview={setPreviewFile}
          onEdit={(f) => notes.openEdit(f)}
          onShare={setShareFile}
          onAttach={(f) => attach([f])}
          onDelete={setFileToDelete}
        />
      </>
    );
  }

  return (
    <div className="drive-view">
      <DriveToolbar
        storage={storage}
        onNewNote={() => notes.openNew(folderId)}
        onNewFolder={() => setNewFolderOpen(true)}
        onUploadFiles={() => fileInputRef.current?.click()}
        onUploadFolder={() => folderInputRef.current?.click()}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (list.length) enqueueFlat(list, folderId);
        }}
      />
      <input
        ref={folderInputRef}
        type="file"
        hidden
        tabIndex={-1}
        {...directoryInputProps}
        onChange={(e) => {
          const list = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (list.length) handlePayload(bundlesFromInput(list));
        }}
      />

      <div className="drive-location">
        <Breadcrumbs trail={data?.breadcrumbs ?? []} currentFolderId={folderId} onNavigate={onNavigateFolder} />
        <div className="drive-location-actions">
          {listing.isRefreshing && <span className="spinner spinner-sm" role="status" aria-label="Refreshing" />}
          {folderId !== "root" && data && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => zip.downloadFolder(folderId, locationName)} disabled={zip.isPreparing}>
              <ArchiveIcon size={14} />
              <span>Download folder</span>
            </button>
          )}
        </div>
      </div>

      <Dropzone onBrowse={() => fileInputRef.current?.click()} onDrop={onDrop} uploading={uploads.isUploading} />

      {uploads.progress && <UploadProgressPanel progress={uploads.progress} onCancel={uploads.cancel} />}

      {selection.count > 0 && (
        <SelectionToolbar
          count={selection.count}
          allSelected={selection.allSelected}
          onToggleAll={selection.toggleAll}
          onZip={() => zip.downloadFiles([...selection.selected])}
          zipBusy={zip.isPreparing}
          onAttach={() => attach(selectedFiles)}
          onDelete={() => setBatchDeleteOpen(true)}
          onClear={selection.clear}
        />
      )}

      <div className="search-field">
        <label htmlFor={searchId} className="sr-only">
          Search this folder
        </label>
        <SearchIcon size={18} className="search-field-icon" />
        <input
          id={searchId}
          type="search"
          className="form-input"
          placeholder="Search this folder"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
        />
      </div>

      {listing.error && data && (
        <div className="callout callout-danger" role="alert">
          <AlertCircleIcon size={16} />
          <span>Couldn&apos;t refresh this folder. {listing.error}</span>
          <button type="button" className="btn btn-secondary btn-sm callout-action" onClick={listing.reload}>
            Retry
          </button>
        </div>
      )}

      {content}

      {/* ---- dialogs */}
      {newFolderOpen && (
        <NewFolderModal parentId={folderId} locationName={locationName} onClose={() => setNewFolderOpen(false)} onCreated={onFolderCreated} />
      )}
      {fileToDelete && <FileDeleteModal file={fileToDelete} onClose={() => setFileToDelete(null)} onDeleted={onFilesRemoved} />}
      {batchDeleteOpen && selectedFiles.length > 0 && (
        <BatchDeleteModal
          files={selectedFiles}
          onClose={() => setBatchDeleteOpen(false)}
          onDeleted={(ids, used) => {
            onFilesRemoved(ids, used);
            selection.clear();
          }}
        />
      )}
      {folderToDelete && <FolderDeleteModal folder={folderToDelete} onClose={() => setFolderToDelete(null)} onDeleted={onFolderRemoved} />}
      {pendingFolders[0] && (
        <FolderUploadModal
          key={`${pendingFolders[0].rootName}-${pendingFolders.length}`}
          bundle={pendingFolders[0]}
          locationName={locationName}
          pendingAfter={pendingFolders.length - 1}
          onChoose={(mode) => void chooseFolderMode(mode)}
          onCancel={() => setPendingFolders((prev) => prev.slice(1))}
        />
      )}
      {uploads.conflict && <DuplicateConflictModal conflict={uploads.conflict} onChoose={uploads.resolveConflict} />}
      {previewFile && (
        <PreviewModal
          file={previewFile}
          onClose={() => setPreviewFile(null)}
          onEdit={(file, content) => {
            setPreviewFile(null);
            notes.openEdit(file, content);
          }}
          onShare={(file) => {
            setPreviewFile(null);
            setShareFile(file);
          }}
        />
      )}
      {shareFile && <ShareModal file={shareFile} onClose={() => setShareFile(null)} />}
      {notes.open && <NoteEditorModal editor={notes} locationName={notes.file && (notes.file.folder_id ?? "root") !== folderId ? "its original folder" : locationName} />}
      {shareToken && (
        <SharedFileModal
          key={shareToken}
          token={shareToken}
          initialFolderId={folderId}
          initialFolderPath={folderPath(data, folderId)}
          onClose={onCloseShare}
          onSaved={(file, used) => upsertFile(file, used)}
        />
      )}
    </div>
  );
}
