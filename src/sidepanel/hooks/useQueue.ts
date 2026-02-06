import { useCallback, useEffect, useState } from 'react';
import type { Job, QueueState } from '../../types/job';
import type { SongInput } from '../../types/job';
import type { QueueStateUpdate, Settings } from '../../types/messages';

const defaultState: QueueState = {
  jobs: [],
  running: false,
  currentJobId: null,
};

export function useQueue() {
  const [state, setState] = useState<QueueState>(defaultState);
  const [settings, setSettingsLocal] = useState<Settings>({
    delayBetweenSongs: 5000,
    generationTimeout: 180_000,
    maxRetries: 3,
    downloadPath: 'SunoMusic',
  });

  // Listen for state updates from background
  useEffect(() => {
    const listener = (message: QueueStateUpdate) => {
      if (message.type === 'QUEUE_STATE_UPDATE') {
        setState(message.payload);
      }
    };

    chrome.runtime.onMessage.addListener(listener);

    // Request initial state
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
      if (response?.payload) {
        setState(response.payload);
      }
      if (response?.settings) {
        setSettingsLocal(response.settings);
      }
    });

    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  const addJobs = useCallback((inputs: SongInput[]) => {
    chrome.runtime.sendMessage({ type: 'ADD_JOBS', payload: inputs });
  }, []);

  const start = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'START_QUEUE' });
  }, []);

  const stop = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'STOP_QUEUE' });
  }, []);

  const clear = useCallback(() => {
    chrome.runtime.sendMessage({ type: 'CLEAR_QUEUE' });
  }, []);

  const updateSettings = useCallback((partial: Partial<Settings>) => {
    const next = { ...settings, ...partial };
    setSettingsLocal(next);
    chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', payload: partial });
  }, [settings]);

  const completed = state.jobs.filter((j) => j.status === 'completed').length;
  const failed = state.jobs.filter((j) => j.status === 'failed').length;
  const total = state.jobs.length;
  const progress = total > 0 ? ((completed + failed) / total) * 100 : 0;

  return {
    jobs: state.jobs,
    running: state.running,
    currentJobId: state.currentJobId,
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
  };
}
