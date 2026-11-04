import { FileTextIcon, FolderIcon, FolderPlusIcon, UploadIcon } from "@/components/Icons";
import QuotaBar from "@/components/layout/QuotaBar";

interface DriveToolbarProps {
  storage: { used: number; quota: number; loaded: boolean };
  onNewNote: () => void;
  onNewFolder: () => void;
  onUploadFiles: () => void;
  onUploadFolder: () => void;
}

export default function DriveToolbar({ storage, onNewNote, onNewFolder, onUploadFiles, onUploadFolder }: DriveToolbarProps) {
  return (
    <div className="drive-toolbar">
      <div className="module-heading">
        <h2 className="module-title" id="drive-heading">
          Drive
        </h2>
        <QuotaBar variant="compact" used={storage.used} quota={storage.quota} loaded={storage.loaded} />
      </div>
      <div className="drive-actions" role="group" aria-label="Create and upload">
        <button type="button" className="btn btn-secondary btn-sm" onClick={onNewNote}>
          <FileTextIcon size={16} />
          <span>New note</span>
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onNewFolder}>
          <FolderPlusIcon size={16} />
          <span>New folder</span>
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onUploadFolder}>
          <FolderIcon size={16} />
          <span>Upload folder</span>
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={onUploadFiles}>
          <UploadIcon size={16} />
          <span>Upload files</span>
        </button>
      </div>
    </div>
  );
}
