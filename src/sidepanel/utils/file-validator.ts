import type { SongInput } from '../../types/job';
import { parseCsv } from './csv-parser';

export interface ParseResult {
  songs: SongInput[];
  errors: string[];
}

export function parseFile(fileName: string, content: string): ParseResult {
  const ext = fileName.split('.').pop()?.toLowerCase();
  const errors: string[] = [];

  let songs: SongInput[] = [];

  try {
    if (ext === 'json') {
      songs = parseJson(content);
    } else if (ext === 'csv') {
      songs = parseCsv(content);
    } else {
      return { songs: [], errors: ['Unsupported file type. Use .json or .csv'] };
    }
  } catch (e) {
    return { songs: [], errors: [(e as Error).message] };
  }

  // Validate each song
  const valid: SongInput[] = [];
  songs.forEach((song, i) => {
    const row = i + 1;
    if (!song.title?.trim()) {
      errors.push(`Row ${row}: missing title`);
      return;
    }
    if (!song.style?.trim()) {
      errors.push(`Row ${row}: missing style`);
      return;
    }
    if (!song.instrumental && !song.lyrics?.trim()) {
      errors.push(`Row ${row}: missing lyrics (set instrumental=true for instrumental tracks)`);
      return;
    }
    valid.push({
      title: song.title.trim(),
      style: song.style.trim(),
      lyrics: song.lyrics?.trim() ?? '',
      instrumental: !!song.instrumental,
      downloadFolder: song.downloadFolder?.trim(),
    });
  });

  return { songs: valid, errors };
}

function parseJson(content: string): SongInput[] {
  const parsed = JSON.parse(content);

  if (!Array.isArray(parsed)) {
    throw new Error('JSON must be an array of song objects');
  }

  return parsed as SongInput[];
}
