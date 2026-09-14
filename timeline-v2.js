// Timeline playback v2: great-circle route animation, leg-aware camera framing, and day-trip returns.
(function () {
    let activeTimelineRun = null;

    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const toRad = deg => deg * Math.PI / 180;
    const toDeg = rad => rad * 180 / Math.PI;

    function dateValue(value) {
        if (!value) return NaN;
        const time = new Date(value + 'T12:00:00').getTime();
        return Number.isFinite(time) ? time : NaN;
    }

    function samePlace(a, b) {
        const norm = value => String(value || '').trim().toLowerCase();
        return norm(a?.country) === norm(b?.country) && norm(a?.region) === norm(b?.region);
    }

    function buildTimelineStops(source) {
        const valid = [...source]
            .filter(loc => Number.isFinite(parseFloat(loc.lat)) && Number.isFinite(parseFloat(loc.lng)) && dateValue(loc.dateStart))
            .sort((a, b) => dateValue(a.dateStart) - dateValue(b.dateStart) || dateValue(a.dateEnd) - dateValue(b.dateEnd));

        const stops = [];
        valid.forEach(loc => {
            stops.push(loc);

            // One-day excursions nested inside a longer base stay return to that base.
            // Example: A 7/1–7/5 + B 7/3 becomes A → B → A without duplicating data.
            if (loc.dateStart && loc.dateStart === loc.dateEnd) {
                const day = dateValue(loc.dateStart);
                const base = valid
                    .filter(candidate => candidate !== loc && !samePlace(candidate, loc))
                    .filter(candidate => {
                        const start = dateValue(candidate.dateStart);
                        const end = dateValue(candidate.dateEnd || candidate.dateStart);
                        return Number.isFinite(start) && Number.isFinite(end) && start < day && end >= day;
                    })
                    .sort((a, b) => dateValue(b.dateStart) - dateValue(a.dateStart))[0];

                if (base) {
                    stops.push({
                        ...base,
                        id: 'return-' + String(loc.id) + '-' + String(base.id),
                        dateStart: loc.dateEnd,
                        dateEnd: loc.dateEnd,
                        syntheticReturn: true,
                        returnFrom: loc.region
                    });
                }
            }
        });

        return stops.filter((stop, index, all) => index === 0 || !samePlace(stop, all[index - 1]) || stop.syntheticReturn);
    }

    function haversineKm(a, b) {
        if (typeof turf !== 'undefined' && turf.distance && turf.point) {
            try {
                return turf.distance(turf.point([a[1], a[0]]), turf.point([b[1], b[0]]));
            } catch (_) {}
        }
        const R = 6371;
        const lat1 = toRad(a[0]), lat2 = toRad(b[0]);
        const dLat = lat2 - lat1;
        const dLng = toRad(b[1] - a[1]);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    function greatCirclePoint(start, end, fraction) {
        const lat1 = toRad(start[0]);
        const lon1 = toRad(start[1]);
        const lat2 = toRad(end[0]);
        const lon2 = toRad(end[1]);
        const cosD = clamp(
            Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1),
            -1,
            1
        );
        const d = Math.acos(cosD);
        if (d < 1e-8) return [start[0], start[1]];
        const sinD = Math.sin(d);
        const a = Math.sin((1 - fraction) * d) / sinD;
        const b = Math.sin(fraction * d) / sinD;
        const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
        const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
        const z = a * Math.sin(lat1) + b * Math.sin(lat2);
        return [toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))];
    }

    function unwrapLng(lng, reference) {
        let result = lng;
        while (result - reference > 180) result -= 360;
        while (result - reference < -180) result += 360;
        return result;
    }

    function cameraZoomForDistance(distanceKm) {
        if (distanceKm < 35) return 9;
        if (distanceKm < 120) return 8;
        if (distanceKm < 350) return 7;
        if (distanceKm < 900) return 6;
        if (distanceKm < 2200) return 5;
        if (distanceKm < 5000) return 4;
        return 3;
    }

    function segmentDuration(distanceKm, reducedMotion) {
        if (reducedMotion) return 90;
        return clamp(900 + Math.log1p(Math.max(0, distanceKm)) * 235, 1050, 3000);
    }

    const wait = (ms, run) => new Promise(resolve => {
        const started = performance.now();
        const tick = () => {
            if (run.cancelled || performance.now() - started >= ms) resolve();
            else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
    });

    function timelineDateLabel(loc) {
        const start = String(loc.dateStart || '').replaceAll('-', '/');
        const end = String(loc.dateEnd || loc.dateStart || '').replaceAll('-', '/');
        const range = start && end && start !== end ? start + ' – ' + end : start;
        return loc.syntheticReturn ? range + ' · 返回據點' : range;
    }

    function ensureTimelineUI() {
        if (!document.getElementById('timeline-v2-style')) {
            const style = document.createElement('style');
            style.id = 'timeline-v2-style';
            style.textContent = [
                '.map-container{position:relative}',
                '#timeline-playback-hud{position:absolute;z-index:1100;left:50%;bottom:24px;transform:translateX(-50%);width:min(390px,calc(100% - 28px));padding:12px 14px;border:1px solid rgba(255,255,255,.13);border-radius:17px;background:rgba(14,18,27,.88);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);box-shadow:0 16px 45px rgba(0,0,0,.36);color:var(--text-main,#fff);pointer-events:none;opacity:0;translate:0 10px;transition:opacity .22s ease,translate .22s ease}',
                '#timeline-playback-hud.is-visible{opacity:1;translate:0 0}',
                ".timeline-hud-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.timeline-hud-kicker{font-family:'JetBrains Mono',monospace;font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--text-sub,#8f98a8);margin-bottom:3px}.timeline-hud-place{font-size:16px;font-weight:800;line-height:1.25}.timeline-hud-date{font-size:11px;color:var(--text-sub,#9aa3b2);margin-top:3px}.timeline-hud-count{font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--cyan,#69c8ff);white-space:nowrap;padding-top:2px}.timeline-hud-progress{height:3px;border-radius:999px;background:rgba(255,255,255,.09);overflow:hidden;margin-top:10px}.timeline-hud-progress>span{display:block;height:100%;width:0;background:linear-gradient(90deg,#69c8ff,#f5c842);border-radius:inherit;transition:width .12s linear}",
                ".timeline-moving-marker{width:22px;height:22px;border-radius:50%;background:#f5c842;border:3px solid rgba(255,255,255,.95);box-shadow:0 0 0 7px rgba(245,200,66,.19),0 5px 18px rgba(0,0,0,.45);position:relative}.timeline-moving-marker:after{content:'';position:absolute;inset:-10px;border:1px solid rgba(245,200,66,.38);border-radius:50%;animation:timelinePulse 1.15s ease-out infinite}@keyframes timelinePulse{0%{transform:scale(.72);opacity:.8}100%{transform:scale(1.45);opacity:0}}",
                '.timeline-arrival-label{color:#fff;background:rgba(14,18,27,.88);border:1px solid rgba(105,200,255,.35);border-radius:10px;padding:4px 7px;font-size:10px;font-weight:750;white-space:nowrap;box-shadow:0 5px 16px rgba(0,0,0,.28)}',
                '#btn-timeline.timeline-is-running{background:linear-gradient(135deg,#3b4658,#202734);color:#fff}',
                '@media (max-width:560px){#timeline-playback-hud{bottom:18px}.timeline-hud-place{font-size:15px}}',
                '@media (prefers-reduced-motion:reduce){.timeline-moving-marker:after{animation:none}#timeline-playback-hud{transition:none}}'
            ].join('');
            document.head.appendChild(style);
        }

        let hud = document.getElementById('timeline-playback-hud');
        if (!hud) {
            hud = document.createElement('div');
            hud.id = 'timeline-playback-hud';
            hud.innerHTML = '<div class="timeline-hud-top"><div><div class="timeline-hud-kicker">Journey playback</div><div class="timeline-hud-place"></div><div class="timeline-hud-date"></div></div><div class="timeline-hud-count"></div></div><div class="timeline-hud-progress"><span></span></div>';
            document.querySelector('.map-container')?.appendChild(hud);
        }
        return hud;
    }

    function updateHud(hud, loc, index, total, fraction = 0) {
        if (!hud || !loc) return;
        const flag = typeof getFlagText === 'function' ? getFlagText(loc.country) : '📍';
        const place = loc.syntheticReturn ? '返回 ' + formatPlaceName(loc.region) : formatPlaceName(loc.region);
        hud.querySelector('.timeline-hud-place').textContent = flag + ' ' + place;
        hud.querySelector('.timeline-hud-date').textContent = timelineDateLabel(loc) + ' · ' + formatPlaceName(loc.country);
        hud.querySelector('.timeline-hud-count').textContent = (index + 1) + ' / ' + total;
        const overall = total <= 1 ? 1 : clamp((index + fraction) / (total - 1), 0, 1);
        hud.querySelector('.timeline-hud-progress > span').style.width = (overall * 100).toFixed(1) + '%';
    }

    function addArrivalMarker(loc, latLng) {
        const marker = L.circleMarker(latLng, {
            radius: loc.syntheticReturn ? 5 : 6,
            weight: 2,
            color: loc.syntheticReturn ? '#aeb8c8' : '#69c8ff',
            fillColor: loc.syntheticReturn ? '#aeb8c8' : '#69c8ff',
            fillOpacity: 0.95
        }).addTo(regionLayerGroup);

        if (!loc.syntheticReturn) {
            marker.bindTooltip(formatPlaceName(loc.region), {
                permanent: false,
                direction: 'top',
                offset: [0, -6],
                className: 'timeline-arrival-label'
            });
            if (typeof buildTimelinePopup === 'function') marker.bindPopup(buildTimelinePopup(loc));
        }
        return marker;
    }

    async function animateLeg({ from, to, movingMarker, routeGlow, routeLine, routePoints, run, hud, stopIndex, totalStops, reducedMotion }) {
        const start = [parseFloat(from.lat), parseFloat(from.lng)];
        const end = [parseFloat(to.lat), parseFloat(to.lng)];
        const distanceKm = haversineKm(start, end);
        const duration = segmentDuration(distanceKm, reducedMotion);
        const legBounds = L.latLngBounds([start, end]);
        const maxZoom = cameraZoomForDistance(distanceKm);

        if (!reducedMotion) {
            mapMain.flyToBounds(legBounds.pad(distanceKm > 1600 ? 0.40 : 0.62), {
                animate: true,
                duration: Math.min(1.15, duration / 1800),
                maxZoom
            });
        } else {
            mapMain.fitBounds(legBounds.pad(0.55), { animate: false, maxZoom });
        }

        return new Promise(resolve => {
            const started = performance.now();
            let lastRouteSample = 0;
            let continuousLng = routePoints.length ? routePoints[routePoints.length - 1][1] : start[1];

            function frame(now) {
                if (run.cancelled) { resolve(false); return; }
                const raw = clamp((now - started) / duration, 0, 1);
                const eased = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
                const point = greatCirclePoint(start, end, eased);
                continuousLng = unwrapLng(point[1], continuousLng);
                const latLng = [point[0], continuousLng];
                movingMarker.setLatLng(latLng);

                if (now - lastRouteSample > 28 || raw >= 1) {
                    routePoints.push(latLng);
                    routeGlow.setLatLngs(routePoints);
                    routeLine.setLatLngs(routePoints);
                    lastRouteSample = now;
                }

                updateHud(hud, to, stopIndex, totalStops, raw);
                if (raw < 1) requestAnimationFrame(frame);
                else resolve(true);
            }
            requestAnimationFrame(frame);
        });
    }

    async function playTimelineV2() {
        const button = document.getElementById('btn-timeline');
        if (activeTimelineRun) {
            activeTimelineRun.cancelled = true;
            return;
        }

        const stops = buildTimelineStops(locations);
        if (!stops.length) {
            showToast('沒有可播放的日期與座標資料。', 'warning', 3000);
            return;
        }

        const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
        const run = { cancelled: false };
        activeTimelineRun = run;
        button?.classList.add('timeline-is-running');
        if (button) button.innerHTML = '■ 停止推演';

        switchMode('region');
        regionLayerGroup.clearLayers();
        const hud = ensureTimelineUI();
        hud?.classList.add('is-visible');

        const routePoints = [];
        const routeGlow = L.polyline([], { color: '#69c8ff', weight: 10, opacity: 0.12, lineCap: 'round', lineJoin: 'round' }).addTo(regionLayerGroup);
        const routeLine = L.polyline([], { color: '#f5c842', weight: 4, opacity: 0.88, lineCap: 'round', lineJoin: 'round' }).addTo(regionLayerGroup);
        const movingIcon = L.divIcon({ html: '<div class="timeline-moving-marker"></div>', className: '', iconSize: [22,22], iconAnchor: [11,11] });

        let movingMarker = null;

        try {
            const first = stops[0];
            const firstPoint = [parseFloat(first.lat), parseFloat(first.lng)];
            routePoints.push(firstPoint);
            routeGlow.setLatLngs(routePoints);
            routeLine.setLatLngs(routePoints);
            movingMarker = L.marker(firstPoint, { icon: movingIcon, interactive: false, zIndexOffset: 900 }).addTo(regionLayerGroup);
            addArrivalMarker(first, firstPoint);
            updateHud(hud, first, 0, stops.length, 0);
            mapMain.flyTo(firstPoint, 7, { animate: !reducedMotion, duration: reducedMotion ? 0 : 1.0 });
            await wait(reducedMotion ? 40 : 700, run);

            for (let index = 1; index < stops.length && !run.cancelled; index += 1) {
                const from = stops[index - 1];
                const to = stops[index];
                const completed = await animateLeg({
                    from, to, movingMarker, routeGlow, routeLine, routePoints,
                    run, hud, stopIndex: index, totalStops: stops.length, reducedMotion
                });
                if (!completed || run.cancelled) break;

                const arrived = routePoints[routePoints.length - 1];
                addArrivalMarker(to, arrived);

                if (!reducedMotion) {
                    const legDistance = haversineKm([parseFloat(from.lat), parseFloat(from.lng)], [parseFloat(to.lat), parseFloat(to.lng)]);
                    mapMain.flyTo(arrived, Math.min(8, cameraZoomForDistance(legDistance) + 1), { animate: true, duration: 0.55 });
                }
                updateHud(hud, to, index, stops.length, 1);
                await wait(reducedMotion ? 35 : (to.syntheticReturn ? 350 : 650), run);
            }

            if (!run.cancelled && routePoints.length > 1) {
                const bounds = L.latLngBounds(routePoints);
                mapMain.fitBounds(bounds.pad(0.22), { animate: !reducedMotion, duration: reducedMotion ? 0 : 1.25, maxZoom: 6 });
                if (hud) {
                    hud.querySelector('.timeline-hud-kicker').textContent = 'Journey complete';
                    hud.querySelector('.timeline-hud-count').textContent = stops.length + ' stops';
                    hud.querySelector('.timeline-hud-progress > span').style.width = '100%';
                }
                await wait(reducedMotion ? 60 : 1200, run);
                showToast('軌跡推演完成。', 'success', 2600);
            } else if (run.cancelled) {
                showToast('已停止軌跡推演。', 'info', 2200);
                regionLayerGroup.clearLayers();
                renderMapRegions();
            }
        } catch (error) {
            console.error('軌跡推演失敗:', error);
            showToast('軌跡推演失敗，請重新整理後再試。', 'error', 3400);
            regionLayerGroup.clearLayers();
            renderMapRegions();
        } finally {
            activeTimelineRun = null;
            if (button) {
                button.classList.remove('timeline-is-running');
                button.innerHTML = '▶ 軌跡推演';
            }
            setTimeout(() => hud?.classList.remove('is-visible'), run.cancelled ? 80 : 850);
        }
    }

    // The original app registered playTimeline by function reference, so simply
    // redefining the function would not replace that listener. Clone the button
    // to drop the old listener, then attach the upgraded playback.
    const oldButton = document.getElementById('btn-timeline');
    if (oldButton) {
        const upgradedButton = oldButton.cloneNode(true);
        oldButton.replaceWith(upgradedButton);
        upgradedButton.addEventListener('click', playTimelineV2);
    }
})();