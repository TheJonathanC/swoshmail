"use client";

import { useRef, useState, type DragEvent } from "react";
import { CloudIcon } from "@/components/Icons";

interface DropzoneProps {
  onBrowse: () => void;
  onDrop: (dataTransfer: DataTransfer) => void;
  uploading: boolean;
}

/** Keyboard-operable drop target. A drag counter avoids dragleave flicker over child elements. */
export default function Dropzone({ onBrowse, onDrop, uploading }: DropzoneProps) {
  const depthRef = useRef(0);
  const [dragging, setDragging] = useState(false);

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types ?? []).includes("Files");

  return (
    <button
      type="button"
      className={`dropzone${dragging ? " is-dragging" : ""}`}
      onClick={onBrowse}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depthRef.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        depthRef.current = Math.max(0, depthRef.current - 1);
        if (depthRef.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depthRef.current = 0;
        setDragging(false);
        onDrop(e.dataTransfer);
      }}
    >
      <CloudIcon size={32} className="dropzone-icon" />
      <span className="dropzone-title">
        <span className="dropzone-text-desktop">Drop files or a folder here, or click to choose files</span>
        <span className="dropzone-text-mobile">Tap to choose files to upload</span>
      </span>
      <span className="dropzone-hint">
        {uploading ? "Files you add now join the current upload queue." : "Files upload into the folder you're viewing."}
      </span>
    </button>
  );
}
