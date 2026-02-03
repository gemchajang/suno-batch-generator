import React from 'react';

interface Props {
  running: boolean;
  hasJobs: boolean;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
}

export default function ControlBar({ running, hasJobs, onStart, onStop, onClear }: Props) {
  return (
    <div className="flex gap-2">
      {running ? (
        <button
          onClick={onStop}
          className="flex-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium transition-colors"
        >
          Stop
        </button>
      ) : (
        <button
          onClick={onStart}
          disabled={!hasJobs}
          className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded text-sm font-medium transition-colors"
        >
          Start
        </button>
      )}
      <button
        onClick={onClear}
        disabled={running}
        className="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded text-sm transition-colors"
      >
        Clear
      </button>
    </div>
  );
}
