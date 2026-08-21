// Loader wrapper for the full app plus local reliability/UI overrides.
const APP_CORE_SCRIPT_URL = 'https://cdn.jsdelivr.net/gh/uptonke/travel-countrys@c0c4366a01a0c9cf71e7e425837438b56592a8f4/script.js';
document.write(`<script src="${APP_CORE_SCRIPT_URL}"><\/script>`);

document.write(`<script>
(function () {
    // ---------- Geocoding fallback ----------
    const COUNTRY_CODES = {
        china:'cn', prc:'cn', '中國':'cn', '中国':'cn', taiwan:'tw', roc:'tw', '台灣':'tw', '臺灣':'tw',
        japan:'jp', thailand:'th', singapore:'sg', malaysia:'my', italy:'it', france:'fr', germany:'de', spain:'es',
        portugal:'pt', netherlands:'nl', belgium:'be', austria:'at', switzerland:'ch', uk:'gb', 'united kingdom':'gb',
        usa:'us', 'united states':'us', 'united states of america':'us', uae:'ae', 'united arab emirates':'ae'
    };

    function normalizeGeo(item, fallbackCountry, fallbackRegion) {
        if (!item) return null;
        const lat = parseFloat(item.lat), lng = parseFloat(item.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
            lat, lng, geojson: item.geojson || null,
            country: item.address?.country || fallbackCountry || '',
            region: item.name || fallbackRegion || '',
            address: item.address || {}, displayName: item.display_name || ''
        };
    }

    function geoScore(item, region) {
        const name = String((item?.name || '') + ' ' + (item?.display_name || '')).toLowerCase();
        const target = String(region || '').toLowerCase();
        const polygon = ['Polygon','MultiPolygon'].includes(item?.geojson?.type);
        return (target && name.includes(target) ? 4 : 0) + (polygon ? 3 : 0) +
            (item?.class === 'boundary' || ['administrative','city','municipality'].includes(item?.type) ? 2 : 0) +
            (item?.lat && item?.lon ? 1 : 0);
    }

    async function directGeocode(region, country = '') {
        const cc = COUNTRY_CODES[String(country).trim().toLowerCase()] || '';
        const r = String(region).trim(), c = String(country).trim();
        const variants = [
            {city:r, country:c, countrycodes:cc},
            {q:c ? r + ', ' + c : r, countrycodes:cc},
            {q:c ? r + ' city, ' + c : r + ' city', countrycodes:cc},
            {q:r, countrycodes:cc}, {q:c ? r + ', ' + c : r}
        ];
        const seen = new Set();
        for (const variant of variants) {
            const p = new URLSearchParams({format:'json', addressdetails:'1', limit:'5', polygon_geojson:'1', polygon_threshold:'0.005', 'accept-language':'en'});
            Object.entries(variant).forEach(([k,v]) => { if (v) p.set(k,v); });
            const url = 'https://nominatim.openstreetmap.org/search?' + p;
            if (seen.has(url)) continue;
            seen.add(url);
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);
            try {
                const res = await fetch(url, {signal: controller.signal});
                if (!res.ok) continue;
                const data = await res.json();
                if (Array.isArray(data) && data.length) return [...data].sort((a,b) => geoScore(b,r) - geoScore(a,r))[0];
            } catch (e) { console.warn('Direct Nominatim fallback failed:', e); }
            finally { clearTimeout(timer); }
        }
        return null;
    }

    const backendBoundary = typeof fetchRegionBoundary === 'function' ? fetchRegionBoundary : null;
    fetchRegionBoundary = async function(region, country = '') {
        const r = String(region || '').trim(), c = String(country || '').trim();
        if (!r) return null;
        if (backendBoundary) {
            try {
                const result = await backendBoundary(r, c);
                if (result) return result;
            } catch (e) { console.warn('Backend geocode failed; using fallback:', e); }
        }
        return normalizeGeo(await directGeocode(r,c), c, r);
    };

    // ---------- Country map: coordinates first, names only as fallback ----------
    const cleanCountry = name => String(name || '').trim().toLowerCase().replace(/^the\\s+/,'').replace(/[’'().,]/g,'').replace(/\\s+/g,' ');
    function countryFeatureIndex(lat, lng) {
        if (!worldGeoJSON?.features || !Number.isFinite(lat) || !Number.isFinite(lng) || typeof turf === 'undefined') return null;
        const point = turf.point([lng, lat]);
        for (let i=0; i<worldGeoJSON.features.length; i++) {
            try { if (worldGeoJSON.features[i]?.geometry && turf.booleanPointInPolygon(point, worldGeoJSON.features[i])) return i; }
            catch (e) { console.warn('Country point-in-polygon failed:', e); }
        }
        return null;
    }

    renderMapCountries = function(sourceLocations = locations) {
        if (!worldGeoJSON?.features) return;
        countryLayerGroup.clearLayers();
        const byIndex = new Map(), byName = new Map();
        sourceLocations.forEach(loc => {
            const days = calculateDays(loc.dateStart, loc.dateEnd);
            const idx = countryFeatureIndex(parseFloat(loc.lat), parseFloat(loc.lng));
            if (idx !== null) byIndex.set(idx, (byIndex.get(idx) || 0) + days);
            else {
                const k = cleanCountry(loc.country);
                if (k) byName.set(k, (byName.get(k) || 0) + days);
            }
        });
        const maxDays = Math.max(...byIndex.values(), ...byName.values(), 1);
        let explored = 0;
        const idxMap = new WeakMap();
        worldGeoJSON.features.forEach((f,i) => idxMap.set(f,i));
        L.geoJSON(worldGeoJSON, {style: feature => {
            const idx = idxMap.get(feature);
            let days = byIndex.get(idx) || 0;
            if (!days) {
                const p = feature?.properties || {};
                for (const raw of [p.name,p.ADMIN,p.NAME,p.NAME_EN].filter(Boolean)) days += byName.get(cleanCountry(raw)) || 0;
            }
            const visited = days > 0;
            if (visited) explored += getCountryArea(feature);
            return {
                fillColor: visited ? (days > 14 ? '#166534' : days > 5 ? '#22c55e' : '#4ade80') : varCSS('--country-default'),
                weight:1, color:varCSS('--country-border'), fillOpacity: visited ? 0.4 + 0.5 * (days / maxDays) : 0.2
            };
        }}).addTo(countryLayerGroup);
        const pct = document.getElementById('explore-percent'), area = document.getElementById('explore-area');
        if (pct) pct.innerText = ((explored / EARTH_LAND_AREA_KM2) * 100).toFixed(4) + '%';
        if (area) area.innerText = Math.round(explored).toLocaleString() + ' km² / 1.48億 km²';
    };

    // ---------- Timeline vs city ranking ----------
    function installRankingUI() {
        document.querySelector('[data-filter-sort="rank"]')?.closest('.filter-shortcuts-grid')?.remove();
        const sort = document.getElementById('sort-by');
        if (sort) sort.closest('.settings-row')?.remove();
        document.querySelectorAll('[data-filter-sort]').forEach(el => el.remove());
        const logTitle = document.querySelector('#section-log .log-title');
        if (logTitle) logTitle.textContent = '旅遊時間軸';
        const filterBtn = document.querySelector('#section-log [data-open-sheet="filters"]');
        if (filterBtn) filterBtn.textContent = '篩選';
        const filterTitle = document.querySelector('#filters-sheet .panel-title');
        if (filterTitle) filterTitle.innerHTML = '<span class="panel-title-icon">⚙️</span> 篩選';

        const insights = document.getElementById('section-insights');
        if (insights) {
            const title = insights.querySelector('.section-title');
            if (title) title.textContent = '排名與洞察';
            if (!document.getElementById('city-ranking-list')) {
                const panel = document.createElement('details');
                panel.className = 'secondary-panel'; panel.open = true;
                panel.innerHTML = '<summary class="secondary-panel-summary"><span>Vibe 城市排名</span><span class="secondary-panel-hint">每座城市只出現一次</span></summary><div class="city-ranking-shell"><div class="city-ranking-intro">重複造訪會合併；排名採最新一次評價，並顯示造訪次數與累計天數。</div><div id="city-ranking-list" class="city-ranking-list"></div></div>';
                insights.querySelector('.secondary-panel')?.before(panel) || insights.appendChild(panel);
            }
        }
        if (!document.getElementById('city-ranking-style')) {
            const style = document.createElement('style'); style.id = 'city-ranking-style';
            style.textContent = '.city-ranking-shell{padding:6px 0 2px}.city-ranking-intro{color:var(--text-sub);font-size:12px;line-height:1.65;margin:0 2px 12px}.city-ranking-list{display:grid;gap:8px}.city-rank-card{width:100%;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.035);color:var(--text-main);border-radius:16px;padding:13px 14px;display:grid;grid-template-columns:48px 1fr 18px;align-items:center;gap:10px;text-align:left;cursor:pointer;font:inherit}.city-rank-card:hover{background:rgba(255,255,255,.06)}.city-rank-number{font-family:"JetBrains Mono",monospace;font-size:15px;font-weight:700;color:var(--gold,#f5c842)}.city-rank-main{min-width:0;display:grid;gap:4px}.city-rank-place{font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.city-rank-meta{color:var(--text-sub);font-size:11px;line-height:1.45}.city-rank-chevron{color:var(--text-sub);font-size:22px}.city-ranking-empty{padding:18px;color:var(--text-sub);text-align:center;border:1px dashed rgba(255,255,255,.08);border-radius:14px}@media(max-width:560px){.city-rank-card{grid-template-columns:42px 1fr 14px;padding:12px}.city-rank-meta{font-size:10px}}';
            document.head.appendChild(style);
        }
    }

    installRankingUI();

    buildLogItemHTML = function(loc, days) {
        return '<div class="log-item-main"><div class="log-item-info"><div class="log-item-place">' + getFlag(loc.country) + ' ' + formatPlaceName(loc.region) + '</div><div class="log-item-meta">' + formatPlaceName(loc.country) + ' · ' + days + ' 天</div><div class="log-date">' + UI_TEXT.popup.date + ' ' + (loc.dateRange || buildDateRangeLabel(loc)) + '</div></div><div class="log-item-side"><span class="log-chevron">›</span></div></div><div class="action-group"><button class="action-btn edit-btn" data-action="edit" data-id="' + loc.id + '">' + UI_TEXT.log.edit + '</button><button class="action-btn delete-btn" data-action="delete" data-id="' + loc.id + '">' + UI_TEXT.log.delete + '</button></div>';
    };

    function cityKey(loc) {
        const lat = parseFloat(loc?.lat), lng = parseFloat(loc?.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) return 'geo:' + lat.toFixed(2) + ',' + lng.toFixed(2);
        const norm = v => String(v || '').trim().toLowerCase().normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9\\u3400-\\u9fff]+/g,' ').trim();
        return 'text:' + norm(loc?.country) + '|' + norm(loc?.region);
    }
    function visitTime(loc) {
        const t = loc?.dateStart ? new Date(loc.dateStart).getTime() : NaN;
        return Number.isFinite(t) ? t : Number(loc?.id) || 0;
    }
    function cityRankingData(source = locations) {
        const map = new Map();
        source.forEach(loc => {
            const key = cityKey(loc), days = calculateDays(loc.dateStart, loc.dateEnd), t = visitTime(loc);
            const s = map.get(key) || {visits:0,totalDays:0,latest:null,latestTime:-Infinity,best:Infinity};
            s.visits++; s.totalDays += days;
            const rank = parseInt(loc.ranking,10); if (Number.isFinite(rank)) s.best = Math.min(s.best,rank);
            if (!s.latest || t >= s.latestTime) { s.latest = loc; s.latestTime = t; }
            map.set(key,s);
        });
        return [...map.values()].map(s => ({...s, rank:Number.isFinite(parseInt(s.latest?.ranking,10)) ? parseInt(s.latest.ranking,10) : s.best}))
            .filter(s => s.latest).sort((a,b) => (a.rank || 9999) - (b.rank || 9999) || b.totalDays - a.totalDays);
    }
    function renderCityRanking() {
        const root = document.getElementById('city-ranking-list'); if (!root) return;
        const cities = cityRankingData(locations);
        if (!cities.length) { root.innerHTML = '<div class="city-ranking-empty">目前沒有城市排名。</div>'; return; }
        root.innerHTML = cities.map(s => {
            const l = s.latest, rank = Number.isFinite(s.rank) ? '#' + s.rank : '—';
            return '<button type="button" class="city-rank-card" data-city-rank-log-id="' + l.id + '"><span class="city-rank-number">' + rank + '</span><span class="city-rank-main"><span class="city-rank-place">' + getFlag(l.country) + ' ' + formatPlaceName(l.region) + '</span><span class="city-rank-meta">' + formatPlaceName(l.country) + ' · ' + s.visits + ' 次造訪 · 累計 ' + s.totalDays + ' 天</span></span><span class="city-rank-chevron">›</span></button>';
        }).join('');
    }
    document.getElementById('city-ranking-list')?.addEventListener('click', e => {
        const card = e.target.closest('[data-city-rank-log-id]');
        if (card && typeof openLogDetail === 'function') openLogDetail(Number(card.dataset.cityRankLogId));
    });

    updateActiveFilterSummary = function(filtered = getFilteredLocations()) {
        const root = document.getElementById('active-filter-chips'); if (!root) return;
        const q = (document.getElementById('search-log')?.value || '').trim();
        const year = document.getElementById('filter-year')?.value || 'all';
        const cont = document.getElementById('filter-continent')?.value || 'all';
        const chips = ['<span class="filter-chip"><span>顯示</span><strong>' + filtered.length + '</strong><span>筆</span></span>'];
        if (q) chips.push('<span class="filter-chip"><span>搜尋</span><strong>' + q + '</strong></span>');
        if (cont !== 'all') chips.push('<span class="filter-chip"><span>洲別</span><strong>' + getContinentLabel(cont) + '</strong></span>');
        if (year !== 'all') chips.push('<span class="filter-chip"><span>年份</span><strong>' + year + '</strong></span>');
        root.innerHTML = chips.join('');
        if (typeof syncFilterShortcutState === 'function') syncFilterShortcutState();
    };

    const renderUIBase = renderUI;
    renderUI = function(filtered = getFilteredLocations()) {
        renderUIBase(filtered);
        renderCityRanking();
    };

    if (Array.isArray(locations) && locations.length && typeof renderAll === 'function') renderAll();
})();
<\/script>`);
