import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/shared/i18n/index.jsx";

function optionLabel(node) {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(optionLabel).join("");
  if (React.isValidElement(node)) return optionLabel(node.props.children);
  return "";
}

function parseOptions(children) {
  const options = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child) || child.type !== "option") return;
    const raw = child.props.value;
    const value =
      raw === undefined || raw === null
        ? optionLabel(child.props.children)
        : String(raw);
    options.push({
      value,
      label: optionLabel(child.props.children) || value,
      disabled: Boolean(child.props.disabled),
    });
  });
  return options;
}

function Chevron({ open }) {
  return (
    <svg
      className={`ql-select-chevron${open ? " is-open" : ""}`}
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
    >
      <path
        d="M4 6l4 4 4-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * 自定义下拉：外观与表单序列化兼容（隐藏 native select）。
 * 支持受控 value / 非受控 defaultValue，以及 name + required。
 */
export function Select({
  label,
  className = "",
  children,
  value,
  defaultValue,
  onChange,
  name,
  disabled = false,
  required = false,
  title,
  id,
  "aria-label": ariaLabel,
  ...rest
}) {
  const { t } = useI18n();
  const options = useMemo(() => parseOptions(children), [children]);
  const isControlled = value !== undefined;
  const firstValue = options[0]?.value ?? "";
  const [internal, setInternal] = useState(() => {
    if (defaultValue !== undefined && defaultValue !== null) {
      return String(defaultValue);
    }
    return firstValue;
  });
  const current = String(isControlled ? value : internal);
  const selected =
    options.find((item) => item.value === current) || options[0] || null;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [menuStyle, setMenuStyle] = useState(null);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const nativeRef = useRef(null);
  const listId = useId();

  function commit(next, { close = true } = {}) {
    if (!isControlled) setInternal(next);
    if (onChange) {
      const event = {
        target: { value: next, name: name || "" },
        currentTarget: { value: next, name: name || "" },
      };
      onChange(event);
    }
    if (nativeRef.current) nativeRef.current.value = next;
    if (close) {
      setOpen(false);
      buttonRef.current?.focus();
    }
  }

  function updateMenuPosition() {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const preferUp = spaceBelow < 220 && rect.top > spaceBelow;
    const width = Math.max(rect.width, 128);
    setMenuStyle({
      position: "fixed",
      left: Math.min(rect.left, window.innerWidth - width - 8),
      width,
      top: preferUp ? undefined : rect.bottom + 4,
      bottom: preferUp ? window.innerHeight - rect.top + 4 : undefined,
      maxHeight: Math.min(280, preferUp ? rect.top - 12 : spaceBelow - 12),
      zIndex: 100,
    });
  }

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const onScroll = () => updateMenuPosition();
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const enabled = options
      .map((item, index) => ({ item, index }))
      .filter((entry) => !entry.item.disabled);
    const currentIndex = enabled.find(
      (entry) => entry.item.value === current,
    )?.index;
    setActiveIndex(currentIndex ?? enabled[0]?.index ?? -1);

    function onPointerDown(event) {
      if (rootRef.current?.contains(event.target)) return;
      if (listRef.current?.contains(event.target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open, options, current]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const node = listRef.current?.querySelector(
      `[data-select-index="${activeIndex}"]`,
    );
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function moveActive(delta) {
    if (!options.length) return;
    let index = activeIndex;
    for (let step = 0; step < options.length; step += 1) {
      index = (index + delta + options.length) % options.length;
      if (!options[index].disabled) {
        setActiveIndex(index);
        return;
      }
    }
  }

  function onButtonKeyDown(event) {
    if (disabled) return;
    if (
      event.key === "ArrowDown" ||
      event.key === "ArrowUp" ||
      event.key === "Enter" ||
      event.key === " "
    ) {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (event.key === "ArrowDown") moveActive(1);
      if (event.key === "ArrowUp") moveActive(-1);
      if (event.key === "Enter" || event.key === " ") {
        const item = options[activeIndex];
        if (item && !item.disabled) commit(item.value);
      }
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  function onListKeyDown(event) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActive(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      const first = options.findIndex((item) => !item.disabled);
      if (first >= 0) setActiveIndex(first);
    } else if (event.key === "End") {
      event.preventDefault();
      for (let index = options.length - 1; index >= 0; index -= 1) {
        if (!options[index].disabled) {
          setActiveIndex(index);
          break;
        }
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const item = options[activeIndex];
      if (item && !item.disabled) commit(item.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
  }

  const display = selected?.label || t("common.select_placeholder");

  return (
    <div
      className={`ql-select ql-select-wrap${className ? ` ${className}` : ""}${open ? " is-open" : ""}${disabled ? " is-disabled" : ""}`}
      ref={rootRef}
      title={title}
      {...rest}
    >
      {/* 按钮在前：外层 <label> 点按会聚焦到触发器，而不是隐藏 native select */}
      <button
        type="button"
        id={id}
        ref={buttonRef}
        className="ql-select-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel || label}
        onClick={() => {
          if (!disabled) setOpen((value) => !value);
        }}
        onKeyDown={onButtonKeyDown}
      >
        <span className={`ql-select-value${selected ? "" : " is-placeholder"}`}>
          {display}
        </span>
        <Chevron open={open} />
      </button>

      <select
        ref={nativeRef}
        className="ql-select-native"
        tabIndex={-1}
        aria-hidden="true"
        name={name}
        value={current}
        required={required}
        disabled={disabled}
        onChange={(event) => commit(event.target.value)}
        onInvalid={() => {
          buttonRef.current?.focus();
        }}
      >
        {options.map((item) => (
          <option key={item.value} value={item.value} disabled={item.disabled}>
            {item.label}
          </option>
        ))}
      </select>

      {open && menuStyle
        ? createPortal(
            <ul
              ref={listRef}
              id={listId}
              className="ql-select-menu"
              role="listbox"
              tabIndex={-1}
              style={menuStyle}
              aria-label={ariaLabel || label}
              onKeyDown={onListKeyDown}
            >
              {options.map((item, index) => {
                const active = index === activeIndex;
                const checked = item.value === current;
                return (
                  <li
                    key={`${item.value}-${index}`}
                    role="option"
                    data-select-index={index}
                    aria-selected={checked}
                    aria-disabled={item.disabled || undefined}
                    className={`ql-select-option${checked ? " is-selected" : ""}${active ? " is-active" : ""}${item.disabled ? " is-disabled" : ""}`}
                    onMouseEnter={() => {
                      if (!item.disabled) setActiveIndex(index);
                    }}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (!item.disabled) commit(item.value);
                    }}
                  >
                    <span>{item.label}</span>
                    {checked ? (
                      <span className="ql-select-check" aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
