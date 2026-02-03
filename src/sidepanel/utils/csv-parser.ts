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

  if (titleIdx === -1 || styleIdx === -1 || lyricsIdx === -1) {
    throw new Error('CSV must have title, style, and lyrics columns');
  }

  const results: SongInput[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 3) continue;

    const instrumental = instrIdx !== -1
      ? cols[instrIdx]?.trim().toLowerCase() === 'true'
      : false;

    results.push({
      title: cols[titleIdx]?.trim() ?? '',
      style: cols[styleIdx]?.trim() ?? '',
      lyrics: cols[lyricsIdx]?.trim() ?? '',
      instrumental,
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
