import React, { useCallback } from 'react';
import { useQueue } from './hooks/useQueue';
import { useLogger } from './hooks/useLogger';
import FileUploader from './components/FileUploader';
import ControlBar from './components/ControlBar';
import ProgressBar from './components/ProgressBar';
import QueueList from './components/QueueList';
import LogPanel from './components/LogPanel';
import SettingsPanel from './components/SettingsPanel';

import ApiLabs from './components/ApiLabs';

export default function App() {
  const [view, setView] = React.useState<'queue' | 'labs'>('queue');

  const {
    jobs,
    running,
    currentJobId,
    settings,
    addJobs,
    start,
    stop,
    clear,
    updateSettings,
    completed,
    failed,
    total,
    progress,
  } = useQueue();

  const { logs, clearLogs, addLog } = useLogger();

  const handleDiagnose = useCallback(() => {
    addLog('info', 'Requesting DOM dump from suno.com tab...');
    chrome.runtime.sendMessage({ type: 'DUMP_DOM' }, (response) => {
      if (chrome.runtime.lastError) {
        addLog('error', `Diagnose failed: ${chrome.runtime.lastError.message}`);
        return;
      }
      if (response?.error) {
        addLog('error', `Diagnose failed: ${response.error}`);
        return;
      }
      if (response?.payload) {
        const lines = response.payload as string[];
        lines.forEach((line: string) => {
          addLog('info', line);
        });
        addLog('info', '--- DOM dump complete ---');
      }
    });
  }, [addLog]);

  return (
    <div className="flex flex-col h-screen bg-gray-950">
      <div className="flex bg-gray-900 border-b border-gray-800">
        <button
          onClick={() => setView('queue')}
          className={`flex-1 py-2 text-sm font-medium ${view === 'queue' ? 'text-white border-b-2 border-indigo-500' : 'text-gray-400 hover:text-gray-200'}`}
        >
          Queue
        </button>
        <button
          onClick={() => setView('labs')}
          className={`flex-1 py-2 text-sm font-medium ${view === 'labs' ? 'text-white border-b-2 border-indigo-500' : 'text-gray-400 hover:text-gray-200'}`}
        >
          API Labs
        </button>
      </div>

      {view === 'queue' ? (
        <div className="flex flex-col gap-3 p-3 h-full overflow-hidden">
          {/* Existing Queue UI Content */}
          <h1 className="text-base font-bold text-gray-100 hidden">Suno Batch Generator</h1>

          <FileUploader onSongsLoaded={addJobs} disabled={running} />

          <ControlBar
            running={running}
            hasJobs={jobs.some((j) => j.status === 'pending')}
            onStart={start}
            onStop={stop}
            onClear={clear}
          />

          <ProgressBar
            completed={completed}
            failed={failed}
            total={total}
            progress={progress}
          />

          <QueueList jobs={jobs} currentJobId={currentJobId} />

          <div className="mt-auto space-y-3">
            <LogPanel logs={logs} onClear={clearLogs} />
            <div className="flex gap-2">
              <button
                onClick={handleDiagnose}
                disabled={running}
                className="flex-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-gray-300 rounded text-xs transition-colors"
              >
                Diagnose
              </button>
              <button
                onClick={() => {
                  addLog('info', 'Test Download requested...');
                  chrome.runtime.sendMessage({ type: 'TEST_DOWNLOAD' });
                }}
                disabled={running}
                className="flex-1 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:bg-gray-800 disabled:text-gray-600 text-gray-100 rounded text-xs transition-colors"
              >
                Test DL
              </button>
            </div>
            <SettingsPanel
              settings={settings}
              onUpdate={updateSettings}
              disabled={running}
            />
          </div>
        </div>
      ) : (
        <ApiLabs />
      )}
    </div>
  );
}
