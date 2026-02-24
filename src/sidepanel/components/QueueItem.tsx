import React from 'react';
import type { Job } from '../../types/job';

interface Props {
  job: Job;
  isCurrent: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-gray-400',
  filling: 'text-yellow-400',
  creating: 'text-yellow-400',
  waiting: 'text-blue-400',
  downloading: 'text-purple-400',
  completed: 'text-green-400',
  failed: 'text-red-400',
  skipped: 'text-gray-500',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  filling: 'Filling form...',
  creating: 'Creating...',
  waiting: 'Generating...',
  downloading: 'Downloading...',
  completed: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
};

export default function QueueItem({ job, isCurrent }: Props) {
  const handleRun = () => {
    chrome.runtime.sendMessage({
      type: 'MANUAL_RUN_JOB',
      payload: { jobId: job.id }
    });
  };

  const handleDownload = () => {
    chrome.runtime.sendMessage({
      type: 'MANUAL_DOWNLOAD_JOB',
      payload: { jobId: job.id }
    });
  };

  const canRun = ['pending', 'failed', 'skipped', 'completed'].includes(job.status);
  const canDownload = ['completed', 'failed'].includes(job.status); // Allow forcing download even on fail

  return (
    <div
      className={`p-2 rounded border text-xs transition-colors ${isCurrent
        ? 'border-blue-500 bg-blue-900/20'
        : 'border-gray-700 bg-gray-800/50'
        }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-medium text-gray-200 truncate flex-1 mr-2">
          {job.input.title}
        </span>
        <span className={`text-xs whitespace-nowrap ${STATUS_COLORS[job.status]}`}>
          {STATUS_LABELS[job.status]}
        </span>
      </div>
      <div className="text-gray-500 truncate mt-0.5">
        {job.input.style}
        {job.input.instrumental && ' (Instrumental)'}
      </div>
      {job.error && (
        <div className="text-red-400 mt-1 break-words">{job.error}</div>
      )}
      <div className="flex gap-2 mt-2 pt-2 border-t border-gray-700/50">
        <button
          onClick={handleRun}
          disabled={!canRun}
          className="flex-1 px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-gray-300 rounded text-xs transition-colors flex items-center justify-center gap-1"
          title="Run this job immediately"
        >
          <span>▶️</span> Run Now
        </button>
        <button
          onClick={handleDownload}
          disabled={!canDownload}
          className="flex-1 px-2 py-1 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-600 text-gray-300 rounded text-xs transition-colors flex items-center justify-center gap-1"
          title="Trigger download attempt"
        >
          <span>⬇️</span> Download
        </button>
      </div>
    </div>
  );
}
