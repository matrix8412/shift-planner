"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

import { useI18n } from "@/i18n/context";

type Option = {
  value: string;
  label: string;
  description?: string;
};

type Props = {
  name: string;
  options: Option[];
  defaultValue?: string | string[];
  value?: string | string[];
  onChange?: (v: string | string[]) => void;
  className?: string;
  required?: boolean;
  allowEmpty?: boolean;
  emptyLabel?: string;
  noOptionsLabel?: string;
  multiple?: boolean;
};

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();
}

export default function SearchableSelect({
  name,
  options,
  defaultValue,
  value: controlledValue,
  onChange,
  className,
  required,
  allowEmpty,
  emptyLabel,
  noOptionsLabel,
  multiple,
}: Props) {
  const { t } = useI18n();
  const isControlled = controlledValue !== undefined;
  const initial = useMemo(() => {
    if (isControlled) return controlledValue as string | string[];
    return defaultValue ?? (multiple ? [] : "");
  }, [controlledValue, defaultValue, isControlled, multiple]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | string[]>(initial ?? (multiple ? [] : ""));
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (isControlled) setSelected(controlledValue as string | string[]);
  }, [controlledValue, isControlled]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, []);

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return options;
    return options.filter((o) => normalize(o.label).includes(q) || normalize(o.description ?? "").includes(q));
  }, [options, query]);

  function toggleValue(val: string) {
    if (multiple) {
      const arr = Array.isArray(selected) ? [...selected] : [];
      const index = arr.indexOf(val);
      if (index >= 0) arr.splice(index, 1);
      else arr.push(val);
      setSelected(arr);
      onChange?.(arr);
    } else {
      setSelected(val);
      onChange?.(val);
      setOpen(false);
    }
  }

  // expose hidden inputs for form submission
  const hiddenInputRef = useRef<HTMLInputElement | null>(null);

  const hiddenInputs = useMemo(() => {
    if (multiple) {
      const arr = Array.isArray(selected) ? selected : [];
      return arr.map((v, i) => <input key={i} type="hidden" name={name} value={v} />);
    }
    return <input ref={hiddenInputRef} type="hidden" name={name} value={(selected as string) ?? ""} />;
  }, [name, selected, multiple]);

  useEffect(() => {
    if (multiple || !hiddenInputRef.current) {
      return;
    }

    hiddenInputRef.current.dispatchEvent(new Event("input", { bubbles: true }));
    hiddenInputRef.current.dispatchEvent(new Event("change", { bubbles: true }));
  }, [multiple, selected]);

  const displayLabel = useMemo(() => {
    if (multiple) {
      const arr = Array.isArray(selected) ? selected : [];
      return arr.map((v) => options.find((o) => o.value === v)?.label ?? v).join(", ");
    }
    return options.find((o) => o.value === (selected as string))?.label ?? (allowEmpty ? emptyLabel ?? "" : "");
  }, [selected, options, allowEmpty, emptyLabel, multiple]);

  return (
    <div ref={rootRef} className={`searchable-select ${className ?? ""}`}>
      {hiddenInputs}
      <button type="button" className="searchable-select__control" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}>
        <span className="searchable-select__value">{displayLabel}</span>
        <ChevronDown size={16} />
      </button>

      {open ? (
        <div className="searchable-select__dropdown" role="listbox">
          <div className="searchable-select__search">
            <Search size={16} className="search-icon" />
            <input
              autoFocus
              placeholder={t("select.searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="searchable-select__input"
            />
          </div>
          <div className="searchable-select__list">
            {filtered.length === 0 ? <div className="searchable-select__empty">{noOptionsLabel ?? t("select.noOptions")}</div> : null}
            {filtered.map((opt) => {
              const isSelected = multiple ? (Array.isArray(selected) && selected.includes(opt.value)) : selected === opt.value;
              return (
                <button type="button" key={opt.value} className={`searchable-select__item${isSelected ? " selected" : ""}`} onClick={() => toggleValue(opt.value)}>
                  {multiple ? <input type="checkbox" readOnly checked={!!isSelected} /> : null}
                  <div className="searchable-select__item-label">{opt.label}</div>
                  {opt.description ? <div className="searchable-select__item-desc">{opt.description}</div> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
