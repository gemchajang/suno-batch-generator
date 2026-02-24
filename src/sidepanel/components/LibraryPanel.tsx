import React, { useState, useCallback } from 'react';
import type { LibrarySong, Job } from '../../types/job';

interface Props {
    onDownload: (songId: string, title: string) => void;
    disabled: boolean;
    activeJobIds: string[];
    jobs: Job[];
    library: LibrarySong[];
}

export default function LibraryPanel({ onDownload, disabled, activeJobIds, jobs, library }: Props) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleFetch = useCallback(() => {
        setLoading(true);
        setError(null);

        // First, ask background to check and inject the content script if necessary
        chrome.runtime.sendMessage({ type: 'CHECK_AND_INJECT' }, (injectRes) => {
            if (!injectRes?.ok) {
                setError('Could not connect to or inject into Suno page. Please navigate to suno.com and refresh.');
                setLoading(false);
                return;
            }

            // Now we know the content script is there, find the active tab and fetch
            chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                const activeTab = tabs[0];
                if (!activeTab?.id) {
                    setError('No active tab found.');
                    setLoading(false);
                    return;
                }

                chrome.tabs.sendMessage(activeTab.id, { type: 'FETCH_LIBRARY' }, (response) => {
                    setLoading(false);
                    if (chrome.runtime.lastError) {
                        setError(`Error connecting to page: ${chrome.runtime.lastError.message}. Make sure you are on Suno.`);
                        return;
                    }

                    if (response?.ok && response.songs) {
                        chrome.runtime.sendMessage({ type: 'ADD_LIBRARY_SONGS', payload: response.songs });
                    } else {
                        setError(response?.error || 'Failed to fetch songs. Make sure you are logged in on Suno.');
                    }
                });
            });
        });
    }, []);

    return (
        <div className="flex flex-col h-full bg-gray-900 text-gray-100 rounded-lg border border-gray-800 p-4 overflow-hidden">
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h2 className="text-lg font-bold">Library / Generated</h2>
                    <p className="text-xs text-gray-400 mt-1">
                        Fetch songs currently visible on the page to download them.
                    </p>
                </div>
                <button
                    onClick={handleFetch}
                    disabled={loading || disabled}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 rounded text-sm font-medium transition-colors whitespace-nowrap"
                >
                    {loading ? 'Fetching...' : 'Fetch from Page'}
                </button>
            </div>

            {error ? (
                <div className="bg-red-900/40 text-red-300 p-3 rounded text-sm mb-4">
                    {error}
                </div>
            ) : null}

            <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-1 custom-scrollbar">
                {library.length === 0 && !loading && !error && (
                    <div className="text-center text-gray-500 py-10 text-sm border-2 border-dashed border-gray-800 rounded-lg">
                        Click "Fetch from Page" while viewing your Suno generated list.
                    </div>
                )}

                {library.map((song) => {
                    const isDownloading = activeJobIds.includes(song.id);
                    const job = jobs.find(j => j.id === song.id);
                    const isCompleted = job?.status === 'completed';

                    return (
                        <div key={song.id} className="flex items-center gap-3 p-3 bg-gray-800/50 rounded-lg border border-gray-700/50 hover:border-gray-600 transition-colors">
                            {song.imageUrl ? (
                                <img src={song.imageUrl} alt="" className="w-12 h-12 rounded bg-gray-800 object-cover" />
                            ) : (
                                <div className="w-12 h-12 rounded bg-gray-800 flex items-center justify-center text-gray-600">
                                    🎵
                                </div>
                            )}
                            <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm truncate" title={song.title}>
                                    {song.title}
                                </div>
                                <div className="text-xs text-gray-500 mt-0.5 truncate font-mono flex items-center gap-2">
                                    {song.id}
                                    {isCompleted && (
                                        <span className="bg-green-900/40 text-green-400 text-[10px] px-1.5 py-0.5 rounded border border-green-800/50">
                                            Downloaded
                                        </span>
                                    )}
                                </div>
                            </div>
                            <button
                                onClick={() => onDownload(song.id, song.title)}
                                disabled={disabled || isDownloading}
                                className={`p-2 rounded transition-colors ${isDownloading
                                    ? 'bg-blue-900/20 text-blue-500 cursor-not-allowed'
                                    : isCompleted
                                        ? 'bg-green-600/20 hover:bg-green-600/40 text-green-500 hover:text-green-400'
                                        : 'bg-blue-600/20 hover:bg-blue-600/40 text-blue-400 hover:text-blue-300'
                                    }`}
                                title={isDownloading ? "Downloading..." : isCompleted ? "Download again" : "Download this song"}
                            >
                                {isDownloading ? (
                                    <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                ) : (
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
