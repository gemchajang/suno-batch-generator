/**
 * All DOM selectors for suno.com automation.
 * Derived from actual DOM dump of suno.com/create (2025).
 * When Suno's UI changes, use "Diagnose Page" to re-dump and update here.
 */

export interface SelectorEntry {
  primary: string;
  fallbacks: string[];
  textMatch?: string;
  description: string;
}

export const SELECTORS = {
  // Custom mode toggle — button with class "eeegztw0", text "Custom"
  customModeToggle: {
    primary: 'button.eeegztw0',
    fallbacks: [],
    textMatch: 'Custom',
    description: 'Custom mode toggle button',
  },

  // Lyrics textarea — placeholder starts with "Write some lyrics"
  // grandparent class "eehpn5n1"
  lyricsInput: {
    primary: 'div.eehpn5n1 textarea',
    fallbacks: [
      'textarea[placeholder*="lyrics" i]',
      'textarea[placeholder*="Write some" i]',
    ],
    description: 'Lyrics textarea input',
  },

  // Style textarea — grandparent class "eg9z14i1"
  // Adjacent to buttons with aria-label="Add style: ..."
  // Also near button with aria-label="Upsample styles"
  styleInput: {
    primary: 'div.eg9z14i1 textarea',
    fallbacks: [
      'textarea[maxlength="1000"]', // High confidence attribute
      'textarea[placeholder*="Style" i]',
      'textarea[placeholder*="genre" i]',
      'textarea[aria-label*="Style" i]',
    ],
    description: 'Style of music textarea',
  },

  // Title input — placeholder "Song Title (Optional)"
  titleInput: {
    primary: 'input[placeholder="Song Title (Optional)"]',
    fallbacks: [
      'input[placeholder*="Song Title" i]',
      'input[placeholder*="Title" i]',
    ],
    description: 'Song title input',
  },

  // Instrumental toggle — does NOT exist as a separate toggle in current UI.
  // Instrumental is achieved by leaving lyrics blank.
  instrumentalToggle: {
    primary: 'button[aria-label*="Instrumental" i]',
    fallbacks: [],
    textMatch: 'Instrumental',
    description: 'Instrumental toggle (may not exist)',
  },

  // Create button — aria-label="Create song", text="Create"
  createButton: {
    primary: 'button[aria-label="Create song"]',
    fallbacks: [
      'button[aria-label="Create"]',
    ],
    textMatch: 'Create',
    description: 'Create song button',
  },

  // Song clip action button — the three-dot/more menu per clip.
  // From live diagnostics: aria-label="More menu contents", empty text, no haspopup.
  // NOTE: textMatch removed — the old "More" text match was hitting wrong buttons
  // (e.g. page layout "More" button with haspopup="dialog").
  songMenuButton: {
    primary: 'button[aria-label="More menu contents"]',
    fallbacks: [
      'button[aria-label="More"]',
      'button[aria-label="Actions"]',
      'button[aria-label="Song options"]',
      'button[aria-label="More options"]',
      'button[data-testid="more-actions"]',
    ],
    description: 'Song three-dot/more menu button',
  },

  // Download option in menu — will appear after clicking the song menu
  downloadMenuItem: {
    primary: '[role="menuitem"]',
    fallbacks: [
      'button:not([aria-label="Close"])', // Generic button in menu
      'div[role="menuitem"]',
      'a[role="menuitem"]',
    ],
    textMatch: 'Download',
    description: 'Download menu item',
  },

  // WAV download option
  downloadWavOption: {
    primary: '[role="menuitem"]',
    fallbacks: [
      'button',
      'div',
    ],
    textMatch: 'WAV',
    description: 'Download as WAV option',
  },

  // Song creation area / feed
  songFeed: {
    primary: 'main',
    fallbacks: [
      '[role="main"]',
      '#__next main',
    ],
    description: 'Song feed / creation area for observing new songs',
  },
} as const satisfies Record<string, SelectorEntry>;

export type SelectorKey = keyof typeof SELECTORS;
