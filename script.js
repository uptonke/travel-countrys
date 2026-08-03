// Loader wrapper for the full app script plus a client-side geocoding fallback.
// The full app code is pinned to the last known-good commit so this file can safely override
// only fetchRegionBoundary without replacing the whole app bundle through the GitHub API.

const APP_CORE_SCRIPT_URL = 'https://cdn.jsdelivr.net/gh/uptonke/travel-countrys@c0c4366a01a0c9cf71e7e425837438b56592a8f4/script.js';

document.write(`<script src="${APP_CORE_SCRIPT_URL}"><\/script>`);

document.write(`<script>
(function () {
    const CLIENT_COUNTRY_CODE_MAP = {
        china: 'cn', prc: 'cn', '中國': 'cn', '中国': 'cn',
        taiwan: 'tw', roc: 'tw', '台灣': 'tw', '臺灣': 'tw',
        japan: 'jp', thailand: 'th', singapore: 'sg', malaysia: 'my',
        'united states': 'us', 'united states of america': 'us', usa: 'us',
        uk: 'gb', 'united kingdom': 'gb', france: 'fr', germany: 'de',
        italy: 'it', spain: 'es', netherlands: 'nl', portugal: 'pt',
        'united arab emirates': 'ae', uae: 'ae'
    };

    function getClientCountryCode(country) {
        return CLIENT_COUNTRY_CODE_MAP[(country || '').trim().toLowerCase()] || '';
    }

    function normalizeGeocodeResult(item, fallbackCountry = '', fallbackRegion = '') {
        if (!item) return null;
        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

        return {
            lat,
            lng,
            geojson: item.geojson || null,
            country: item.address?.country || fallbackCountry || '',
            region: item.name || fallbackRegion || '',
            address: item.address || {},
            displayName: item.display_name || ''
        };
    }

    function rankGeocodeCandidate(item, region) {
        const regionLower = (region || '').trim().toLowerCase();
        const name = String((item?.name || '') + ' ' + (item?.display_name || '')).toLowerCase();
        const geoType = item?.geojson?.type;
        let score = 0;

        if (regionLower && name.includes(regionLower)) score += 4;
        if (geoType === 'Polygon' || geoType === 'MultiPolygon') score += 3;
        if (item?.class === 'boundary' || ['administrative', 'city', 'municipality'].includes(item?.type)) score += 2;
        if (item?.lat && item?.lon) score += 1;

        return score;
    }

    function sortGeocodeCandidates(data, region) {
        return [...(Array.isArray(data) ? data : [])]
            .sort((a, b) => rankGeocodeCandidate(b, region) - rankGeocodeCandidate(a, region));
    }

    async function directNominatimSearch(region, country = '') {
        const countryCode = getClientCountryCode(country);
        const baseParams = {
            format: 'json',
            addressdetails: '1',
            limit: '5',
            polygon_geojson: '1',
            polygon_threshold: '0.005',
            'accept-language': 'en'
        };

        const cleanRegion = (region || '').trim();
        const cleanCountry = (country || '').trim();
        const placeQuery = cleanCountry ? cleanRegion + ', ' + cleanCountry : cleanRegion;

        const variants = [
            { city: cleanRegion, country: cleanCountry, countrycodes: countryCode },
            { q: placeQuery, countrycodes: countryCode },
            { q: cleanCountry ? cleanRegion + ' city, ' + cleanCountry : cleanRegion + ' city', countrycodes: countryCode },
            { q: cleanRegion, countrycodes: countryCode },
            { q: placeQuery }
        ];

        const seen = new Set();

        for (const variant of variants) {
            const params = new URLSearchParams(baseParams);
            Object.entries(variant).forEach(([key, value]) => {
                if (value) params.set(key, value);
            });

            const url = 'https://nominatim.openstreetmap.org/search?' + params.toString();
            if (seen.has(url)) continue;
            seen.add(url);

            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);

            try {
                const response = await fetch(url, { signal: controller.signal });
                if (!response.ok) continue;
                const data = await response.json();
                if (Array.isArray(data) && data.length > 0) {
                    return sortGeocodeCandidates(data, cleanRegion)[0];
                }
            } catch (error) {
                console.warn('Direct Nominatim fallback failed:', error);
            } finally {
                clearTimeout(timer);
            }
        }

        return null;
    }

    const originalFetchRegionBoundary = typeof fetchRegionBoundary === 'function' ? fetchRegionBoundary : null;

    fetchRegionBoundary = async function fetchRegionBoundaryWithClientFallback(region, country = '') {
        const normalizedRegion = (region || '').trim();
        const normalizedCountry = (country || '').trim();
        if (!normalizedRegion) return null;

        if (originalFetchRegionBoundary) {
            try {
                const backendResult = await originalFetchRegionBoundary(normalizedRegion, normalizedCountry);
                if (backendResult) return backendResult;
            } catch (error) {
                console.warn('Backend geocode failed, using direct fallback:', error);
            }
        }

        const fallback = await directNominatimSearch(normalizedRegion, normalizedCountry);
        return normalizeGeocodeResult(fallback, normalizedCountry, normalizedRegion);
    };

    function normalizeCountryTextForMap(name) {
        return String(name || '')
            .trim()
            .toLowerCase()
            .replace(/^the\s+/, '')
            .replace(/[’'().,]/g, '')
            .replace(/\s+/g, ' ');
    }

    function getFeatureNameKeys(feature) {
        const props = feature && feature.properties ? feature.properties : {};
        return [
            props.name,
            props.ADMIN,
            props.NAME,
            props.NAME_EN
        ]
            .filter(Boolean)
            .map(normalizeCountryTextForMap)
            .filter(Boolean);
    }

    function getFeatureIndexByPoint(lat, lng) {
        if (!worldGeoJSON || !worldGeoJSON.features || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        if (typeof turf === 'undefined' || !turf.point || !turf.booleanPointInPolygon) return null;

        const point = turf.point([lng, lat]);

        for (let i = 0; i < worldGeoJSON.features.length; i++) {
            const feature = worldGeoJSON.features[i];
            try {
                if (feature && feature.geometry && turf.booleanPointInPolygon(point, feature)) {
                    return i;
                }
            } catch (error) {
                console.warn('Country point-in-polygon failed:', error);
            }
        }

        return null;
    }

    renderMapCountries = function renderMapCountriesByPoint(sourceLocations = locations) {
        if (!worldGeoJSON) return;

        countryLayerGroup.clearLayers();

        const countryDaysMap = {};
        let totalExploredAreaKm2 = 0;

        sourceLocations.forEach(loc => {
            const days = calculateDays(loc.dateStart, loc.dateEnd);
            const lat = parseFloat(loc.lat);
            const lng = parseFloat(loc.lng);
            const featureIndex = getFeatureIndexByPoint(lat, lng);

            if (featureIndex !== null) {
                const key = 'idx:' + featureIndex;
                countryDaysMap[key] = (countryDaysMap[key] || 0) + days;
                return;
            }

            const fallbackKey = 'name:' + normalizeCountryTextForMap(loc.country);
            countryDaysMap[fallbackKey] = (countryDaysMap[fallbackKey] || 0) + days;
        });

        function getFeatureDays(feature, index) {
            const keys = new Set(['idx:' + index]);

            getFeatureNameKeys(feature).forEach(nameKey => {
                keys.add('name:' + nameKey);
            });

            let days = 0;
            keys.forEach(key => {
                days += countryDaysMap[key] || 0;
            });

            return days;
        }

        const maxDays = Math.max(...Object.values(countryDaysMap), 1);

        L.geoJSON(worldGeoJSON, {
            style: (feature) => {
                const index = worldGeoJSON.features.indexOf(feature);
                const days = getFeatureDays(feature, index);
                const isVisited = days > 0;

                if (isVisited) totalExploredAreaKm2 += getCountryArea(feature);

                let fillColor = varCSS('--country-default');
                let fillOpacity = 0.2;

                if (isVisited) {
                    fillOpacity = 0.4 + (0.5 * (days / maxDays));
                    fillColor = days > 14 ? '#166534' : (days > 5 ? '#22c55e' : '#4ade80');
                }

                return {
                    fillColor,
                    weight: 1,
                    color: varCSS('--country-border'),
                    fillOpacity
                };
            }
        }).addTo(countryLayerGroup);

        const explorePercentEl = document.getElementById('explore-percent');
        const exploreAreaEl = document.getElementById('explore-area');

        if (explorePercentEl) {
            explorePercentEl.innerText =
                ((totalExploredAreaKm2 / EARTH_LAND_AREA_KM2) * 100).toFixed(4) + '%';
        }

        if (exploreAreaEl) {
            exploreAreaEl.innerText =
                Math.round(totalExploredAreaKm2).toLocaleString() + ' km² / 1.48億 km²';
        }
    };

})();
<\/script>`);
