// Load the current stable app build, then add the upgraded journey playback module.
const APP_BUILD_URL = 'https://cdn.jsdelivr.net/gh/uptonke/travel-countrys@585e4cb42eb4b31e6eb939b149d6690a90cbb80b/script.js';

document.write(`<script src="${APP_BUILD_URL}"><\/script>`);
document.write('<script src="timeline-v2.js?v=84ff16fedff0a854c7c1ff1b7a6b48ee7a3e9bab"><\/script>');
