import React, { useCallback, useRef, useState } from 'react';
import { parseFile } from '../utils/file-validator';
import type { SongInput } from '../../types/job';

interface Props {
  onSongsLoaded: (songs: SongInput[]) => void;
  disabled: boolean;
}

export default function FileUploader({ onSongsLoaded, disabled }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const handleFile = useCallback(
    (file: File) => {
      setErrors([]);
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        const { songs, errors: parseErrors } = parseFile(file.name, content);
        if (parseErrors.length > 0) {
          setErrors(parseErrors);
        }
        if (songs.length > 0) {
          onSongsLoaded(songs);
        }
      };
      reader.readAsText(file);
    },
    [onSongsLoaded],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  return (
    <div className="space-y-2">
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors
          ${disabled ? 'border-gray-700 text-gray-600 cursor-not-allowed' : 'border-gray-600 hover:border-blue-500 cursor-pointer text-gray-400 hover:text-gray-300'}`}
        onClick={() => !disabled && inputRef.current?.click()}
      >
        <p className="text-sm">Drop JSON/CSV file here or click to browse</p>
        <p className="text-xs mt-1 text-gray-500">Supports .json and .csv</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".json,.csv"
        className="hidden"
        onChange={handleChange}
        disabled={disabled}
      />
      {errors.length > 0 && (
        <div className="bg-red-900/30 border border-red-700 rounded p-2 text-xs text-red-300 space-y-1">
          {errors.map((err, i) => (
            <p key={i}>{err}</p>
          ))}
        </div>
      )}
    </div>
  );
}
