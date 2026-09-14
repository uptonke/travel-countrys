// Basemap v3: OpenFreeMap vector tiles via MapLibre GL + Leaflet bridge.
// Provides an in-map Dark / Positron switcher for side-by-side testing without an API key.
(async function () {
    if (typeof mapMain === 'undefined' || typeof L === 'undefined') return;

    const MAPLIBRE_JS = 'https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.js';
    const MAPLIBRE_CSS = 'https://unpkg.com/maplibre-gl@5/dist/maplibre-gl.css';
    const LEAFLET_BRIDGE_JS = 'https://unpkg.com/@maplibre/maplibre-gl-leaflet/leaflet-maplibre-gl.js';
    const STYLE_URLS = {
        dark: 'https://tiles.openfreemap.org/styles/dark',
        positron: 'https://tiles.openfreemap.org/styles/positron'
    };

    const DEFAULT_STYLE = 'dark';
    const STORAGE_KEY = 'travel-basemap-style';

    function ensureStylesheet(href) {
        if ([...document.styleSheets].some(sheet => sheet.href === href)) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        document.head.appendChild(link);
    }

    function ensureScript(src, readyCheck) {
        if (readyCheck()) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const existing = [...document.scripts].find(script => script.src === src);
            if (existing) {
                existing.addEventListener('load', resolve, { once: true });
                existing.addEventListener('error', () => reject(new Error('Failed to load ' + src)), { once: true });
                return;
            }
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load ' + src));
            document.head.appendChild(script);
        });
    }

    function removeRasterBasemaps() {
        const layersToRemove = [];
        mapMain.eachLayer(layer => {
            if (!(layer instanceof L.TileLayer)) return;
            const url = String(layer._url || '');
            if (url.includes('cartocdn.com') || url.includes('tile.openstreetmap.org')) {
                layersToRemove.push(layer);
            }
        });
        layersToRemove.forEach(layer => mapMain.removeLayer(layer));

        const tilePane = mapMain.getPane('tilePane');
        if (tilePane) {
            tilePane.style.filter = '';
            tilePane.style.background = '#10151d';
        }
    }

    function normalizeStyle(value) {
        return Object.prototype.hasOwnProperty.call(STYLE_URLS, value) ? value : DEFAULT_STYLE;
    }

    function getSavedStyle() {
        try {
            return normalizeStyle(localStorage.getItem(STORAGE_KEY) || DEFAULT_STYLE);
        } catch (_) {
            return DEFAULT_STYLE;
        }
    }

    function saveStyle(styleName) {
        try { localStorage.setItem(STORAGE_KEY, styleName); } catch (_) {}
    }

    function updateHeader(styleName) {
        const label = styleName === 'positron' ? 'Positron' : 'Dark';
        document.querySelectorAll('#section-map span, .map-container span').forEach(node => {
            const text = (node.textContent || '').trim();
            if (
                text === 'OpenStreetMap · CartoDB Dark' ||
                text === 'OpenStreetMap · Dark' ||
                text.startsWith('OpenFreeMap ·')
            ) {
                node.textContent = 'OpenFreeMap · ' + label;
            }
        });
    }

    function injectControlStyle() {
        if (document.getElementById('openfreemap-switcher-style')) return;
        const style = document.createElement('style');
        style.id = 'openfreemap-switcher-style';
        style.textContent = `
            .openfreemap-switcher.leaflet-control {
                display:flex;
                overflow:hidden;
                padding:3px;
                border:1px solid rgba(255,255,255,.12);
                border-radius:12px;
                background:rgba(16,21,29,.88);
                -webkit-backdrop-filter:blur(12px);
                backdrop-filter:blur(12px);
                box-shadow:0 8px 24px rgba(0,0,0,.26);
            }
            .openfreemap-switcher button {
                appearance:none;
                border:0;
                border-radius:9px;
                background:transparent;
                color:#9aa6b8;
                min-width:64px;
                min-height:34px;
                padding:7px 10px;
                font:700 11px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
                cursor:pointer;
            }
            .openfreemap-switcher button.is-active {
                color:#f7f9fc;
                background:rgba(105,200,255,.16);
                box-shadow:inset 0 0 0 1px rgba(105,200,255,.24);
            }
            @media (max-width:560px) {
                .openfreemap-switcher button { min-width:56px; padding:7px 8px; }
            }
        `;
        document.head.appendChild(style);
    }

    ensureStylesheet(MAPLIBRE_CSS);

    try {
        await ensureScript(MAPLIBRE_JS, () => typeof window.maplibregl !== 'undefined');
        await ensureScript(LEAFLET_BRIDGE_JS, () => typeof L.maplibreGL === 'function');
    } catch (error) {
        console.error('OpenFreeMap/MapLibre failed to load:', error);
        return;
    }

    removeRasterBasemaps();
    injectControlStyle();

    let currentStyle = getSavedStyle();
    let vectorLayer = L.maplibreGL({
        style: STYLE_URLS[currentStyle]
    }).addTo(mapMain);

    updateHeader(currentStyle);

    function setBasemap(styleName) {
        const nextStyle = normalizeStyle(styleName);
        currentStyle = nextStyle;
        saveStyle(nextStyle);
        updateHeader(nextStyle);

        const glMap = vectorLayer?.getMaplibreMap?.();
        if (glMap && typeof glMap.setStyle === 'function') {
            glMap.setStyle(STYLE_URLS[nextStyle]);
        } else {
            if (vectorLayer && mapMain.hasLayer(vectorLayer)) mapMain.removeLayer(vectorLayer);
            vectorLayer = L.maplibreGL({ style: STYLE_URLS[nextStyle] }).addTo(mapMain);
        }

        document.querySelectorAll('.openfreemap-switcher [data-basemap-style]').forEach(button => {
            button.classList.toggle('is-active', button.dataset.basemapStyle === nextStyle);
        });
    }

    const BasemapSwitcher = L.Control.extend({
        options: { position: 'topleft' },
        onAdd() {
            const root = L.DomUtil.create('div', 'openfreemap-switcher');
            root.setAttribute('aria-label', '底圖樣式');

            const options = [
                ['dark', 'Dark'],
                ['positron', 'Positron']
            ];

            options.forEach(([value, label]) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.dataset.basemapStyle = value;
                button.textContent = label;
                button.classList.toggle('is-active', value === currentStyle);
                button.addEventListener('click', event => {
                    event.preventDefault();
                    setBasemap(value);
                });
                root.appendChild(button);
            });

            L.DomEvent.disableClickPropagation(root);
            L.DomEvent.disableScrollPropagation(root);
            return root;
        }
    });

    new BasemapSwitcher().addTo(mapMain);
})();