import React, { useState } from 'react';
import type { Settings } from '../../types/messages';

interface Props {
  settings: Settings;
  onUpdate: (partial: Partial<Settings>) => void;
  disabled: boolean;
}

export default function SettingsPanel({ settings, onUpdate, disabled }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-gray-700 rounded">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-gray-400 hover:text-gray-200 transition-colors"
      >
        <span>Settings</span>
        <span>{open ? '\u25B2' : '\u25BC'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3">
          <SettingRow
            label="Delay between songs (sec)"
            value={settings.delayBetweenSongs / 1000}
            onChange={(v) => onUpdate({ delayBetweenSongs: v * 1000 })}
            min={1}
            max={60}
            disabled={disabled}
          />
          <SettingRow
            label="Generation timeout (sec)"
            value={settings.generationTimeout / 1000}
            onChange={(v) => onUpdate({ generationTimeout: v * 1000 })}
            min={60}
            max={600}
            disabled={disabled}
          />
          <SettingRow
            label="Max retries"
            value={settings.maxRetries}
            onChange={(v) => onUpdate({ maxRetries: v })}
            min={0}
            max={10}
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}

function SettingRow({
  label,
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-xs text-gray-400 flex-1">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs text-gray-200 disabled:opacity-50"
      />
    </div>
  );
}
