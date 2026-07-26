"use client";

import { type FormEvent, useState } from "react";

import styles from "./saved-view-controls.module.css";

type SavedViewOption = {
  id: string;
  name: string;
};

type SavedViewControlsProps = {
  areaLabel: string;
  disabled?: boolean;
  selectedId: string;
  views: SavedViewOption[];
  onRemove: () => void;
  onSave: (name: string) => void;
  onSelect: (id: string) => void;
};

export function SavedViewControls({
  areaLabel,
  disabled = false,
  selectedId,
  views,
  onRemove,
  onSave,
  onSelect,
}: SavedViewControlsProps) {
  const [name, setName] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName || disabled) return;
    onSave(nextName);
    setName("");
  }

  return (
    <form className={styles.controls} onSubmit={submit}>
      <label>
        Private saved view
        <select
          value={selectedId}
          disabled={disabled}
          onChange={(event) => onSelect(event.target.value)}
          aria-label={`Choose a private ${areaLabel} view`}
        >
          <option value="">Current filters</option>
          {views.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Save current filters
        <input
          value={name}
          maxLength={80}
          disabled={disabled}
          placeholder={`Name this ${areaLabel} view`}
          onChange={(event) => setName(event.target.value)}
          aria-label={`Name this ${areaLabel} view`}
        />
      </label>
      <button type="submit" disabled={disabled || !name.trim()}>
        Save view
      </button>
      <button
        type="button"
        className={styles.remove}
        disabled={disabled || !selectedId}
        onClick={onRemove}
      >
        Remove
      </button>
    </form>
  );
}
