/** Default delay between songs in ms */
export const DEFAULT_DELAY_BETWEEN_SONGS = 5_000;

/** Default generation timeout in ms (5 minutes) */
export const DEFAULT_GENERATION_TIMEOUT = 300_000;

/** Default max retries per job */
export const DEFAULT_MAX_RETRIES = 3;

/** Polling interval for generation completion check */
export const GENERATION_POLL_INTERVAL = 3_000;

/** Delay after typing each field to let React state settle */
export const INPUT_SETTLE_DELAY = 300;

/** Delay after clicking Create before starting to monitor */
export const POST_CREATE_DELAY = 2_000;

/** Max wait time when looking for a DOM element */
export const ELEMENT_WAIT_TIMEOUT = 10_000;

/** Interval for element wait polling */
export const ELEMENT_WAIT_INTERVAL = 500;

/** Storage key for queue state */
export const STORAGE_KEY_QUEUE = 'suno_batch_queue';

/** Storage key for settings */
export const STORAGE_KEY_SETTINGS = 'suno_batch_settings';
