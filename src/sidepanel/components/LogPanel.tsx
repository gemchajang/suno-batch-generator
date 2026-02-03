import React, { useEffect, useRef } from 'react';
import type { LogItem } from '../hooks/useLogger';

interface Props {
  logs: LogItem[];
  onClear: () => void;
}

const LEVEL_COLORS: Record<string, string> = {
  info: 'text-gray-300',
  warn: 'text-yellow-400',
  error: 'text-red-400',
};

export default function LogPanel({ logs, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs.length]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-400">Log</span>
        <button
          onClick={onClear}
          className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
        >
          Clear
        </button>
      </div>
      <div className="bg-gray-950 border border-gray-700 rounded p-2 h-48 overflow-y-auto font-mono text-[11px] leading-relaxed select-text">
        {logs.length === 0 && (
          <span className="text-gray-600">Waiting for activity...</span>
        )}
        {logs.map((log, i) => (
          <div key={i} className={LEVEL_COLORS[log.level]}>
            <span className="text-gray-600">
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>{' '}
            {log.message}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
