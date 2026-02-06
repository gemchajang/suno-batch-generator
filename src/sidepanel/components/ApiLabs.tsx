import React, { useState } from 'react';
import { useLogger } from '../hooks/useLogger';

interface SongGenParams {
    prompt: string;
    tags?: string;
    title?: string;
    mv?: string;
    make_instrumental?: boolean;
}

export default function ApiLabs() {
    const { addLog } = useLogger();
    const [jsonInput, setJsonInput] = useState<string>('');
    const [parsedData, setParsedData] = useState<SongGenParams[] | null>(null);
    const [status, setStatus] = useState<string>('Ready');
    const [generatedIds, setGeneratedIds] = useState<string[]>([]);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const text = ev.target?.result as string;
                const json = JSON.parse(text);
                // Normalize to array
                const data = Array.isArray(json) ? json : [json];
                setParsedData(data);
                setJsonInput(JSON.stringify(data, null, 2));
                addLog('info', `Loaded ${data.length} jobs from JSON.`);
            } catch (err) {
                addLog('error', 'Invalid JSON file');
            }
        };
        reader.readAsText(file);
    };

    const handleGenerate = () => {
        if (!parsedData || parsedData.length === 0) {
            addLog('warn', 'No data to generate.');
            return;
        }

        setStatus('Initializing API Generation...');
        addLog('info', 'Starting API Generation sequence...');

        // We'll process one by one for testing
        // Send message to background -> content to execute fetch
        chrome.runtime.sendMessage({
            type: 'GENERATE_VIA_API',
            payload: {
                jobs: parsedData
            }
        }, (response) => {
            if (chrome.runtime.lastError) {
                addLog('error', `Message failed: ${chrome.runtime.lastError.message}`);
                setStatus('Error');
                return;
            }
            if (response && response.started) {
                setStatus('Request sent to content script...');
                addLog('info', 'Generation request forwarded to content script.');
            }
        });
    };

    return (
        <div className="flex flex-col h-full bg-gray-900 text-gray-200 text-xs p-3 gap-3">
            <div className="flex justify-between items-center border-b border-gray-700 pb-2">
                <h2 className="font-bold text-sm text-indigo-400">API Generation Labs</h2>
                <span className="bg-gray-800 px-2 py-1 rounded text-gray-400">{status}</span>
            </div>

            <div className="flex flex-col gap-2">
                <label className="text-gray-400 font-bold">1. Upload JSON</label>
                <input
                    type="file"
                    accept=".json"
                    onChange={handleFileUpload}
                    className="block w-full text-xs text-gray-400
            file:mr-2 file:py-1 file:px-2
            file:rounded file:border-0
            file:text-xs file:font-semibold
            file:bg-gray-700 file:text-indigo-300
            hover:file:bg-gray-600"
                />
            </div>

            <div className="flex-1 flex flex-col gap-2 overflow-hidden">
                <label className="text-gray-400 font-bold">Preview Payload</label>
                <textarea
                    value={jsonInput}
                    readOnly
                    className="flex-1 bg-black p-2 rounded text-green-300 font-mono text-[10px] resize-none focus:outline-none border border-gray-800"
                />
            </div>

            <button
                onClick={handleGenerate}
                disabled={!parsedData}
                className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-800 disabled:text-gray-600 rounded font-bold text-white transition-colors"
            >
                Generate & Download (API)
            </button>

            <div className="text-gray-500 italic text-[10px]">
                * This will trigger `fetch` in the page context, waiting for response, and then download the resulting IDs.
            </div>
        </div>
    );
}
