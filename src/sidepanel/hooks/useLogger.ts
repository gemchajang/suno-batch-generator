import { useCallback, useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../../types/messages';

export interface LogItem {
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: number;
}

const MAX_LOGS = 500;

export function useLogger() {
  const [logs, setLogs] = useState<LogItem[]>([]);
  const logsRef = useRef(logs);
  logsRef.current = logs;

  useEffect(() => {
    const listener = (message: LogEntry) => {
      if (message.type === 'LOG') {
        setLogs((prev) => {
          const next = [...prev, message.payload];
          if (next.length > MAX_LOGS) next.splice(0, next.length - MAX_LOGS);
          return next;
        });
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const addLog = useCallback((level: 'info' | 'warn' | 'error', message: string) => {
    setLogs((prev) => {
      const next = [...prev, { level, message, timestamp: Date.now() }];
      if (next.length > MAX_LOGS) next.splice(0, next.length - MAX_LOGS);
      return next;
    });
  }, []);

  return { logs, clearLogs, addLog };
}
