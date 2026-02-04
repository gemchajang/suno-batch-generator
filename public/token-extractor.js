/**
 * Token Extractor Script
 * Injected into the MAIN world to access window.Clerk
 */
(async () => {
    const eventName = document.currentScript?.getAttribute('data-event-name') || 'SBG_CLERK_TOKEN';

    try {
        // Wait a moment for Clerk to be ready if needed
        if (!window.Clerk) {
            // Simple poll
            for (let i = 0; i < 10; i++) {
                if (window.Clerk) break;
                await new Promise(r => setTimeout(r, 200));
            }
        }

        if (!window.Clerk || !window.Clerk.session) {
            console.warn('[SBG] Clerk not found in page context');
            window.dispatchEvent(new CustomEvent(eventName, { detail: null }));
            return;
        }

        const token = await window.Clerk.session.getToken();
        console.log('[SBG] Token extracted successfully');
        window.dispatchEvent(new CustomEvent(eventName, { detail: token }));
    } catch (e) {
        console.error('[SBG] Token extraction error', e);
        window.dispatchEvent(new CustomEvent(eventName, { detail: null }));
    }
})();
