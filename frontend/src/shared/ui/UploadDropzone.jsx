import React, { useEffect, useMemo, useRef, useState } from "react";
import { formatFileSize, randomId } from "@/shared/lib/format.js";
import { UploadIcon, XIcon } from "./icons.jsx";
import { useI18n } from "@/shared/i18n/index.jsx";

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
  const { t } = useI18n();
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
        aria-label={t("upload.remove_file", { name: file.name })}
        title={t("common.remove")}
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
  const { t } = useI18n();
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
      setError(t("upload.max_files", { max: MAX_FILES }));
      return;
    }
    if (next.some((file) => file.size > MAX_EACH)) {
      setError(t("upload.max_each_size", { size: 30 }));
      return;
    }
    if (total > MAX_TOTAL) {
      setError(t("upload.max_batch_size", { size: MAX_TOTAL_LABEL }));
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
        onInvalid={() => setError(t("upload.select_one_file"))}
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
          <strong>{t("upload.drop_here")}</strong>
          <span className="upload-hint">
            {t("upload.drop_limits")}
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
              <span>{t("upload.add_more")}</span>
            </button>
          ) : null}
        </div>
      )}

      {hasFiles ? (
        <p className="upload-cards-count">
          {t("upload.selected_count", { count: files.length })}
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
