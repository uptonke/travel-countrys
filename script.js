// Load the current stable app build, then add the upgraded journey playback module.
// Keep loader variables function-scoped so nested legacy wrappers cannot redeclare them.
(() => {
    const stableAppScriptUrl = 'https://cdn.jsdelivr.net/gh/uptonke/travel-countrys@585e4cb42eb4b31e6eb939b149d6690a90cbb80b/script.js';
    const timelineModuleUrl = 'timeline-v2.js?v=84ff16fedff0a854c7c1ff1b7a6b48ee7a3e9bab';

    document.write(`<script src="${stableAppScriptUrl}"><\/script>`);
    document.write(`<script src="${timelineModuleUrl}"><\/script>`);
})();
