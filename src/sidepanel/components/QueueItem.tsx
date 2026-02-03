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
  return (
    <div
      className={`p-2 rounded border text-xs transition-colors ${
        isCurrent
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
    </div>
  );
}
