import React, { useCallback } from 'react';
import { useQueue } from './hooks/useQueue';
import { useLogger } from './hooks/useLogger';
import FileUploader from './components/FileUploader';
import ControlBar from './components/ControlBar';
import ProgressBar from './components/ProgressBar';
import QueueList from './components/QueueList';
import LogPanel from './components/LogPanel';
import SettingsPanel from './components/SettingsPanel';


import LibraryPanel from './components/LibraryPanel';

export default function App() {
  const [view, setView] = React.useState<'queue' | 'library'>('queue');

  const {
    jobs,
    running,
    activeJobIds,
    library,
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
          onClick={() => setView('library')}
          className={`flex-1 py-2 text-sm font-medium ${view === 'library' ? 'text-white border-b-2 border-indigo-500' : 'text-gray-400 hover:text-gray-200'}`}
        >
          Library
        </button>
      </div>

      {view === 'queue' ? (
        <div className="flex flex-col gap-3 p-3 h-full overflow-hidden">
          {/* Existing Queue UI Content */}
          <h1 className="text-base font-bold text-gray-100 hidden">Suno Batch Generator</h1>

          <div className="flex flex-col gap-2">
            <FileUploader onSongsLoaded={addJobs} disabled={running} />
            <button
              onClick={() => {
                addLog('info', 'Fetching jobs from Notion...');
                chrome.runtime.sendMessage({ type: 'FETCH_NOTION_JOBS' });
              }}
              disabled={running}
              className="w-full px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 text-white rounded text-sm font-medium transition-colors shadow-sm flex items-center justify-center gap-2"
            >
              <span>📋</span> Fetch from Notion
            </button>
          </div>

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

          <QueueList jobs={jobs} activeJobIds={activeJobIds} />

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
        <div className="flex-1 p-3 overflow-hidden">
          <LibraryPanel
            disabled={running}
            activeJobIds={activeJobIds}
            jobs={jobs}
            library={library}
            onDownload={(songId, title) => {
              addLog('info', `Requested manual download for: ${songId}`);
              // Sends to background to trigger the download logic
              chrome.runtime.sendMessage({
                type: 'MANUAL_DOWNLOAD_JOB',
                payload: { jobId: songId, title }
              });
            }}
          />
        </div>
      )}
    </div>
  );
}
