// Basemap v2: replace CARTO raster tiles (which now require an API key)
// with standard OpenStreetMap raster tiles styled dark in the browser.
(function () {
    if (typeof mapMain === 'undefined' || typeof L === 'undefined') return;

    // Remove only the legacy CARTO tile layer. Keep every data/overlay layer intact.
    const legacyTileLayers = [];
    mapMain.eachLayer(layer => {
        if (!(layer instanceof L.TileLayer)) return;
        const url = String(layer._url || '');
        if (url.includes('cartocdn.com')) legacyTileLayers.push(layer);
    });
    legacyTileLayers.forEach(layer => mapMain.removeLayer(layer));

    const osmDarkLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        minZoom: 2,
        maxZoom: 19,
        crossOrigin: true
    });

    osmDarkLayer.addTo(mapMain);
    osmDarkLayer.bringToBack();

    // OSM's public raster style is light. Apply the dark treatment only to the
    // tile pane so markers, polygons, heatmaps and the journey route keep their colours.
    const tilePane = mapMain.getPane('tilePane');
    if (tilePane) {
        tilePane.style.filter = 'invert(1) hue-rotate(180deg) brightness(.72) contrast(1.12) saturate(.68)';
        tilePane.style.background = '#11151c';
    }

    // Keep the map header truthful after removing CARTO.
    document.querySelectorAll('#section-map span, .map-container span').forEach(node => {
        if ((node.textContent || '').trim() === 'OpenStreetMap · CartoDB Dark') {
            node.textContent = 'OpenStreetMap · Dark';
        }
    });
})();