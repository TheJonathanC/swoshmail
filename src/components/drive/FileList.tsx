import type { FileItem } from "@/types/api";
import FileRow, { type FileRowActions } from "./FileRow";

interface FileListProps extends FileRowActions {
  files: FileItem[];
  selected: ReadonlySet<string>;
  allSelected: boolean;
  someSelected: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
}

export default function FileList({ files, selected, allSelected, someSelected, onToggle, onToggleAll, ...actions }: FileListProps) {
  if (files.length === 0) return null;
  return (
    <div className="table-scroll">
      <table className="file-table">
        <caption className="sr-only">Files in this folder</caption>
        <thead>
          <tr>
            <th scope="col" className="col-select">
              <input
                type="checkbox"
                className="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={onToggleAll}
                aria-label="Select all files"
              />
            </th>
            <th scope="col" className="col-name">
              Name
            </th>
            <th scope="col" className="col-size">
              Size
            </th>
            <th scope="col" className="col-date">
              Uploaded
            </th>
            <th scope="col" className="col-actions">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {files.map((file) => (
            <FileRow key={file.id} file={file} selected={selected.has(file.id)} onToggle={onToggle} {...actions} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
