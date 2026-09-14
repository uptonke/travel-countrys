// Load the original full app core, then local overrides/modules in sequence.
// The core itself contains no document.write, so this avoids async document.write failures.
(() => {
    const coreUrl = 'https://cdn.jsdelivr.net/gh/uptonke/travel-countrys@c0c4366a01a0c9cf71e7e425837438b56592a8f4/script.js';
    const overridesUrl = 'app-overrides-v2.js?v=210a85c0f9db0c9f9c1174b4773212d039874f86';
    const basemapUrl = 'basemap-v2.js?v=395bf212604c461ca081ed4a673b75ddeeece627';
    const timelineUrl = 'timeline-v3.js?v=ed213a4056b3cfe9bd66b4e528645cc515147e44';

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
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load ' + src));
            document.head.appendChild(script);
        });
    }

    (async () => {
        try {
            await loadScript(coreUrl);
            await loadScript(overridesUrl);
            await loadScript(basemapUrl);
            await loadScript(timelineUrl);

            // The original core normally starts on DOMContentLoaded. If it finished loading
            // after that event already fired, start it once after all overrides are ready.
            if (domContentLoadedFired && typeof checkAuth === 'function') {
                await checkAuth();
            }
        } catch (error) {
            console.error('App module loader failed:', error);
        }
    })();
})();
