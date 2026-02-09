import type { SongInput } from '../../types/job';

/**
 * Parse a CSV string into SongInput[].
 * Expects headers: title, style, lyrics, instrumental (optional)
 */
export function parseCsv(text: string): SongInput[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');

  const headers = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());

  const titleIdx = headers.indexOf('title');
  const styleIdx = headers.indexOf('style');
  const lyricsIdx = headers.indexOf('lyrics');
  const instrIdx = headers.indexOf('instrumental');
  const folderIdx = headers.indexOf('downloadfolder');

  if (titleIdx === -1 || styleIdx === -1) {
    throw new Error('CSV must at least have title and style columns');
  }

  const results: SongInput[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 2) continue;

    const instrumental = instrIdx !== -1 && instrIdx < cols.length
      ? cols[instrIdx]?.trim().toLowerCase() === 'true'
      : false;

    // Use empty string if lyrics column is missing or empty
    const lyrics = lyricsIdx !== -1 && lyricsIdx < cols.length
      ? cols[lyricsIdx]?.trim() ?? ''
      : '';

    const downloadFolder = folderIdx !== -1 && folderIdx < cols.length
      ? cols[folderIdx]?.trim()
      : undefined;

    results.push({
      title: cols[titleIdx]?.trim() ?? '',
      style: cols[styleIdx]?.trim() ?? '',
      lyrics,
      instrumental,
      downloadFolder,
    });
  }

  return results;
}

/** Simple CSV line parser that handles quoted fields */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }

  result.push(current);
  return result;
}
