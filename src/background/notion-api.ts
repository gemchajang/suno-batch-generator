import { JobStatus, SongInput } from '../types/job';
import { Settings } from '../types/messages';

// Notion API version
const NOTION_VERSION = '2022-06-28';

/**
 * Fetch pending jobs from the associated Notion database.
 */
export async function fetchPendingNotionJobs(settings: Settings): Promise<SongInput[]> {
    if (!settings.notionApiKey || !settings.notionDatabaseId) {
        throw new Error('Notion API Key or Database ID is missing in settings.');
    }

    const url = `https://api.notion.com/v1/databases/${settings.notionDatabaseId}/query`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${settings.notionApiKey}`,
            'Notion-Version': NOTION_VERSION,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            filter: {
                or: [
                    {
                        property: 'Status',
                        status: {
                            equals: 'Not started',
                        },
                    },
                    {
                        property: 'Status',
                        status: {
                            equals: 'Pending',
                        }
                    },
                    {
                        property: 'Status',
                        select: {
                            equals: 'Pending',
                        }
                    },
                    {
                        property: 'Status',
                        select: {
                            is_empty: true,
                        }
                    }
                ],
            },
            page_size: 50
        }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Notion API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const jobs: SongInput[] = [];

    for (const page of data.results) {
        const props = page.properties;

        // Loosely extract properties by name or type
        const titleObj = Object.values(props).find((p: any) => p.type === 'title') || props['Title'] || props['Name'];
        const lyricsObj = props['Lyrics'] || props['lyrics'];
        const styleObj = props['Style'] || props['style'];

        const title = extractText(titleObj);
        const lyrics = extractText(lyricsObj);
        const style = extractText(styleObj);

        if (title || lyrics || style) {
            jobs.push({
                title: title || 'Untitled Notion Job',
                lyrics: lyrics || '',
                style: style || '',
                instrumental: false,
                notionPageId: page.id,
            });
        }
    }

    return jobs;
}

/**
 * Helper to extract text from a Notion property structure.
 */
function extractText(prop: any): string {
    if (!prop) return '';
    if (prop.type === 'title' && prop.title) {
        return prop.title.map((t: any) => t.plain_text).join('');
    }
    if (prop.type === 'rich_text' && prop.rich_text) {
        return prop.rich_text.map((t: any) => t.plain_text).join('');
    }
    return '';
}

/**
 * Update the Status property of a Notion page when a job finishes.
 */
export async function updateNotionJobStatus(
    settings: Settings,
    pageId: string,
    status: JobStatus,
): Promise<void> {
    if (!settings.notionApiKey || !pageId) return;

    const url = `https://api.notion.com/v1/pages/${pageId}`;

    // Choose value based on job status
    let notionStatusValue = '';
    switch (status) {
        case 'completed': notionStatusValue = 'Done'; break;
        case 'failed': notionStatusValue = 'Error'; break;
        case 'skipped': notionStatusValue = 'Skipped'; break;
        default: return;
    }

    // Try `select` format first
    const selectPayload = {
        properties: {
            'Status': {
                select: {
                    name: notionStatusValue,
                }
            }
        }
    };

    try {
        const response = await fetch(url, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${settings.notionApiKey}`,
                'Notion-Version': NOTION_VERSION,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(selectPayload),
        });

        if (!response.ok && response.status === 400) {
            // Fallback: try `status` property format
            const statusPayload = {
                properties: {
                    'Status': {
                        status: {
                            name: notionStatusValue,
                        }
                    }
                }
            };
            const fbResponse = await fetch(url, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${settings.notionApiKey}`,
                    'Notion-Version': NOTION_VERSION,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(statusPayload),
            });

            if (!fbResponse.ok) {
                console.warn('[SBG] Failed to update Notion status (fallback):', await fbResponse.text());
            } else {
                console.log('[SBG] Updated Notion status successfully via fallback');
            }
        } else {
            console.log('[SBG] Updated Notion status successfully');
        }
    } catch (e) {
        console.error('[SBG] Exception during Notion status update:', e);
    }
}
