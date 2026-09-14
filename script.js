// Load the stable app build first, then local compatibility modules in sequence.
// Avoid document.write so Chrome does not treat the cross-site core script as parser-blocking.
(() => {
    const stableAppScriptUrl = 'https://cdn.jsdelivr.net/gh/uptonke/travel-countrys@585e4cb42eb4b31e6eb939b149d6690a90cbb80b/script.js';
    const basemapModuleUrl = 'basemap-v2.js?v=a688d5aad26f80c6f87327b58cfe79fd15417a87';
    const timelineModuleUrl = 'timeline-v2.js?v=84ff16fedff0a854c7c1ff1b7a6b48ee7a3e9bab';

    let domContentLoadedFired = document.readyState !== 'loading';
    if (!domContentLoadedFired) {
        document.addEventListener('DOMContentLoaded', () => {
            domContentLoadedFired = true;
        }, { once: true });
    }

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = false;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load ' + src));
            document.head.appendChild(script);
        });
    }

    (async () => {
        try {
            await loadScript(stableAppScriptUrl);

            // If the dynamically loaded legacy core arrived after DOMContentLoaded,
            // its own listener could not fire. Start auth/app initialization once here.
            if (domContentLoadedFired && typeof checkAuth === 'function') {
                await checkAuth();
            }

            await loadScript(basemapModuleUrl);
            await loadScript(timelineModuleUrl);
        } catch (error) {
            console.error('App module loader failed:', error);
        }
    })();
})();
