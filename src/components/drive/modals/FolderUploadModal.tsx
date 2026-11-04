import { FilesIcon, FolderIcon, FolderPlusIcon } from "@/components/Icons";
import Modal from "@/components/ui/Modal";
import { bundleDirectories, type FolderBundle } from "@/lib/client/folderEntries";
import { formatBytes, pluralize } from "@/lib/client/files";

interface FolderUploadModalProps {
  bundle: FolderBundle;
  locationName: string;
  pendingAfter: number;
  onChoose: (mode: "tree" | "flat") => void;
  onCancel: () => void;
}

export default function FolderUploadModal({ bundle, locationName, pendingAfter, onChoose, onCancel }: FolderUploadModalProps) {
  const subfolders = bundleDirectories(bundle).length;
  const bytes = bundle.entries.reduce((acc, e) => acc + e.file.size, 0);

  return (
    <Modal
      open
      onClose={onCancel}
      size="md"
      title="Upload folder"
      icon={<FolderIcon size={18} />}
      footer={
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          {pendingAfter > 0 ? "Skip this folder" : "Cancel"}
        </button>
      }
    >
      <p className="modal-message">
        <strong className="break-anywhere">{bundle.rootName}</strong> contains {pluralize(bundle.entries.length, "file")}
        {subfolders > 0 ? ` in ${pluralize(subfolders, "subfolder")}` : ""} ({formatBytes(bytes)}).
      </p>
      <div className="choice-list" role="group" aria-label="How to upload">
        <button type="button" className="choice-card choice-card-primary" onClick={() => onChoose("tree")}>
          <FolderPlusIcon size={20} />
          <span className="choice-card-text">
            <span className="choice-card-title break-anywhere">Create folder &ldquo;{bundle.rootName}&rdquo;</span>
            <span className="choice-card-desc">
              Keeps the folder structure{subfolders > 0 ? `, including ${pluralize(subfolders, "subfolder")}` : ""}, inside {locationName}.
            </span>
          </span>
        </button>
        <button type="button" className="choice-card" onClick={() => onChoose("flat")}>
          <FilesIcon size={20} />
          <span className="choice-card-text">
            <span className="choice-card-title">Upload files only</span>
            <span className="choice-card-desc">Puts every file directly into {locationName}, without subfolders.</span>
          </span>
        </button>
      </div>
    </Modal>
  );
}
