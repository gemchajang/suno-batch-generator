import React from 'react';
import type { Job } from '../../types/job';
import QueueItem from './QueueItem';

interface Props {
  jobs: Job[];
  currentJobId: string | null;
}

export default function QueueList({ jobs, currentJobId }: Props) {
  if (jobs.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8 text-sm">
        No songs in queue. Upload a JSON or CSV file to get started.
      </div>
    );
  }

  return (
    <div className="space-y-1.5 overflow-y-auto max-h-[40vh]">
      {jobs.map((job) => (
        <QueueItem key={job.id} job={job} isCurrent={job.id === currentJobId} />
      ))}
    </div>
  );
}
