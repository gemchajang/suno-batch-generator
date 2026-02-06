// Intercept fetch requests to capture generation API calls
(function () {
    const originalFetch = window.fetch;

    window.fetch = async function (...args) {
        const [resource, config] = args;
        const url = typeof resource === 'string' ? resource : (resource instanceof Request ? resource.url : '');

        // Check if this is the target API
        if (url.includes('/api/generate/') || url.includes('/api/gen/')) {
            try {
                // Clone the response so we can read it without consuming the original stream
                const responseCallback = async (response) => {
                    try {
                        const clone = response.clone();
                        const data = await clone.json();

                        // Send to content script via custom event
                        window.dispatchEvent(new CustomEvent('SBG_API_INTERCEPT', {
                            detail: {
                                url,
                                method: config?.method || 'GET',
                                requestBody: config?.body,
                                responseBody: data,
                                timestamp: Date.now()
                            }
                        }));
                    } catch (e) {
                        console.error('[SBG-Interceptor] Failed to parse response:', e);
                    }
                };

                // Execute original fetch and hook into the promise
                const promise = originalFetch.apply(this, args);
                promise.then(responseCallback).catch(() => { });
                return promise;

            } catch (e) {
                console.error('[SBG-Interceptor] Error:', e);
            }
        }

        return originalFetch.apply(this, args);
    };

    console.log('[SBG] Network Interceptor Injected');
})();
