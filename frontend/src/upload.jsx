import React, { useRef, useState } from "react";

const MAX_FILES = 10;
const MAX_EACH = 30 * 1024 * 1024;
const MAX_TOTAL = 64 * 1024 * 1024;

function fileSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function UploadDropzone({ name = "files", disabled = false, onFiles }) {
  const inputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  function commit(next) {
    const total = next.reduce((sum, file) => sum + file.size, 0);
    if (next.length > MAX_FILES) {
      setError(`每批最多 ${MAX_FILES} 份`);
      return;
    }
    if (next.some((file) => file.size > MAX_EACH)) {
      setError("单份文件不能超过 30MB");
      return;
    }
    if (total > MAX_TOTAL) {
      setError("整批文件不能超过 64MB");
      return;
    }
    setError("");
    setFiles(next);
    if (inputRef.current) {
      const transfer = new DataTransfer();
      next.forEach((file) => transfer.items.add(file));
      inputRef.current.files = transfer.files;
    }
    onFiles?.(next);
  }

  function pick(list) {
    commit([...files, ...Array.from(list)]);
  }

  function remove(index) {
    commit(files.filter((_, current) => current !== index));
  }

  return (
    <div
      className={`upload-field ${dragging ? "is-dragging" : ""} ${disabled ? "is-disabled" : ""}`}
    >
      <input
        ref={inputRef}
        className="upload-input"
        type="file"
        name={name}
        accept=".pdf,.csv,.xlsx"
        multiple
        required
        disabled={disabled}
        onChange={(event) => pick(event.target.files)}
        onInvalid={() => setError("请选择至少一份原件")}
      />
      <div
        className="upload-zone"
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (!disabled && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (!disabled) pick(event.dataTransfer.files);
        }}
      >
        <span className="upload-icon" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="26"
            height="26"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path
              d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 15.5v2A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-2"
              strokeLinecap="round"
            />
          </svg>
        </span>
        <strong>把原件拖到这里，或点击选择</strong>
        <span className="upload-hint">
          PDF / CSV / XLSX · 每批最多 10 份 · 单份 ≤30MB · 整批 ≤64MB
        </span>
      </div>
      {files.length > 0 && (
        <ul className="upload-list">
          {files.map((file, index) => (
            <li key={`${file.name}-${file.lastModified}`}>
              <span className="upload-file-name" title={file.name}>
                {file.name}
              </span>
              <span className="upload-file-size">{fileSize(file.size)}</span>
              <button
                type="button"
                className="ghost upload-remove"
                onClick={() => remove(index)}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="upload-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
