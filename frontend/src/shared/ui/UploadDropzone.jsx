import React, { useEffect, useMemo, useRef, useState } from "react";
import { formatFileSize, randomId } from "@/shared/lib/format.js";
import { UploadIcon, XIcon } from "./icons.jsx";

const MAX_FILES = 10;
const MAX_EACH = 30 * 1024 * 1024;
// Nginx 的 64MB 是整个 multipart 请求体上限，boundary 与文件头会额外占几 KB；
// 前端按 60MB 收口，避免“正好 64MB 却被 413 拒绝”。
const MAX_TOTAL = 60 * 1024 * 1024;
const MAX_TOTAL_LABEL = "60MB";

function fileExtension(name) {
  const index = String(name || "").lastIndexOf(".");
  if (index < 0 || index === name.length - 1) return "FILE";
  return name.slice(index + 1).toUpperCase();
}

function UploadFileCard({ file, previewUrl, onRemove, disabled }) {
  const extension = fileExtension(file.name);
  const isImage = Boolean(previewUrl);

  return (
    <div className={`upload-card${isImage ? " is-image" : ""}`}>
      {isImage ? (
        <img
          className="upload-card-thumb"
          src={previewUrl}
          alt=""
          draggable={false}
        />
      ) : (
        <div className="upload-card-body">
          <span className="upload-card-name" title={file.name}>
            {file.name}
          </span>
          <span className="upload-card-meta">
            <em className="upload-card-ext">{extension}</em>
            <span>{formatFileSize(file.size)}</span>
          </span>
        </div>
      )}
      <button
        type="button"
        className="upload-card-remove"
        aria-label={`移除 ${file.name}`}
        title="移除"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
      >
        <XIcon size={12} />
      </button>
    </div>
  );
}

export function UploadDropzone({ name = "files", disabled = false, onFiles }) {
  const inputRef = useRef(null);
  const batchInputRef = useRef(null);
  const [files, setFiles] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");

  const previewUrls = useMemo(
    () =>
      files.map((file) =>
        file.type?.startsWith("image/") ? URL.createObjectURL(file) : "",
      ),
    [files],
  );

  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, [previewUrls]);

  function ensureBatch() {
    if (batchInputRef.current?.value) return;
    const batch = randomId("b");
    if (batchInputRef.current) batchInputRef.current.value = batch;
  }

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
      setError(`整批文件不能超过 ${MAX_TOTAL_LABEL}`);
      return;
    }
    setError("");
    setFiles(next);
    // 批次幂等键：同一次选择在重试时复用，服务端据此回放原任务，不重复建单。
    ensureBatch();
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

  function openPicker() {
    if (!disabled) inputRef.current?.click();
  }

  const hasFiles = files.length > 0;
  const canAddMore = files.length < MAX_FILES;

  return (
    <div
      className={`upload-field ${dragging ? "is-dragging" : ""} ${disabled ? "is-disabled" : ""} ${hasFiles ? "has-files" : ""}`}
    >
      <input
        type="file"
        name={name}
        className="upload-native-input"
        ref={(node) => {
          inputRef.current = node;
          if (node && !batchInputRef.current?.value) ensureBatch();
        }}
        accept=".pdf,.csv,.xlsx"
        multiple
        required
        disabled={disabled}
        onChange={(event) => pick(event.target.files)}
        onInvalid={() => setError("请选择至少一份原件")}
      />
      <input ref={batchInputRef} type="hidden" name="batch" />

      {!hasFiles ? (
        <div
          className="upload-zone"
          role="button"
          tabIndex={disabled ? -1 : 0}
          onClick={openPicker}
          onKeyDown={(event) => {
            if (!disabled && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              openPicker();
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
            <UploadIcon />
          </span>
          <strong>把原件拖到这里，或点击选择</strong>
          <span className="upload-hint">
            PDF / CSV / XLSX · 每批最多 10 份 · 单份 ≤30MB · 整批 ≤60MB
          </span>
        </div>
      ) : (
        <div
          className="upload-cards"
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled && canAddMore) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!disabled && canAddMore) pick(event.dataTransfer.files);
          }}
        >
          {files.map((file, index) => (
            <UploadFileCard
              key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
              file={file}
              previewUrl={previewUrls[index]}
              disabled={disabled}
              onRemove={() => remove(index)}
            />
          ))}
          {canAddMore ? (
            <button
              type="button"
              className="upload-card upload-card--add"
              disabled={disabled}
              onClick={openPicker}
            >
              <span className="upload-card-add-mark" aria-hidden="true">
                ＋
              </span>
              <span>继续添加</span>
            </button>
          ) : null}
        </div>
      )}

      {hasFiles ? (
        <p className="upload-cards-count">
          已选 {files.length} 份 · 可继续拖入或点「继续添加」
        </p>
      ) : null}

      {error && (
        <p className="upload-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
