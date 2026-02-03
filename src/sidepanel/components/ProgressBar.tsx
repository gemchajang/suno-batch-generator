import React from 'react';

interface Props {
  completed: number;
  failed: number;
  total: number;
  progress: number;
}

export default function ProgressBar({ completed, failed, total, progress }: Props) {
  if (total === 0) return null;

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-gray-400">
        <span>{completed + failed} / {total}</span>
        <span>
          {completed} done
          {failed > 0 && <span className="text-red-400"> / {failed} failed</span>}
        </span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
        <div
          className="bg-blue-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
