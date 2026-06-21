// ==========================================
// 1. SUPABASE 初始化設定
// ==========================================
const supabaseUrl = 'https://yrccanqxzrcoknzabifz.supabase.co';
const supabaseKey = 'sb_publishable_lDfwRDxgMhzRwVk0-Qu3vg_9HTmTFZy';
const supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);

// ==========================================
// 2. 核心變數
// ==========================================
const EARTH_LAND_AREA_KM2 = 148940000;
let currentMode = 'country';
let worldGeoJSON = null;
let countryAreaCache = {};
let locations = [];
let editingId = null;

const REMOTE_API_BASE = 'https://travel-command-api.onrender.com';
const LOCAL_API_CANDIDATES = ['http://127.0.0.1:8000', 'http://localhost:8000'];

function getSameOriginApiBase() {
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
        return window.location.origin;
    }
    return null;
}

function getApiBaseCandidates() {
    const candidates = [];
    const sameOrigin = getSameOriginApiBase();
    if (sameOrigin) candidates.push(sameOrigin);
    LOCAL_API_CANDIDATES.forEach(url => { if (!candidates.includes(url)) candidates.push(url); });
    if (!candidates.includes(REMOTE_API_BASE)) candidates.push(REMOTE_API_BASE);
    return candidates;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function apiFetch(path, options = {}, { timeoutMs = 12000, expectJson = true } = {}) {
    let lastError = null;
    for (const base of getApiBaseCandidates()) {
        try {
            const response = await fetchWithTimeout(`${base}${path}`, options, timeoutMs);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return expectJson ? await response.json() : response;
        } catch (error) {
            lastError = error;
            console.warn(`API request failed via ${base}${path}:`, error);
        }
    }
    throw lastError || new Error('API unavailable');
}

async function initApp() {
    // 1. 從 Supabase 撈取歷史戰報
    const { data, error } = await supabaseClient.from('travel_logs').select('*');
    if (error) { 
        console.error("Supabase 讀取失敗:", error); 
    } else if (data) {
        locations = data.map(d => ({
            id: d.id, dateStart: d.date_start, dateEnd: d.date_end, dateRange: d.date_range,
            country: d.country, region: d.region, ranking: d.ranking,
            lat: d.lat, lng: d.lng, geojson: d.geojson
        }));
    }

    // 2. 載入世界地圖 GeoJSON (這是固定資源，不帶參數)
    try {
        const res = await fetch('https://raw.githubusercontent.com/datasets/geo-boundaries-world-110m/master/countries.geojson');
        worldGeoJSON = await res.json();
        renderAll(); // 渲染地圖與 UI
    } catch(e) { 
        console.error("世界地圖載入失敗:", e); 
    }
}
// ==========================================
// 3. 輔助函數
// ==========================================
function extractYear(loc) {
    if (loc.dateStart && loc.dateStart.length >= 4) return loc.dateStart.substring(0, 4);
    if (loc.dateRange) { const match = loc.dateRange.match(/\d{4}/); if (match) return match[0]; }
    return null;
}
function calculateDays(start, end) {
    if (!start || !end) return 1;
    const s = new Date(start), e = new Date(end);
    if (isNaN(s) || isNaN(e)) return 1;
    return Math.ceil(Math.abs(e - s) / 86400000) + 1;
}
const continentMapping = {
    "Asia": ["japan","taiwan","thailand","malaysia","china","south korea","united arab emirates","singapore","vietnam","indonesia","philippines","india","hong kong","macau"],
    "Europe": ["united kingdom","france","germany","italy","spain","ukraine","netherlands","switzerland","sweden","austria","belgium","portugal","greece","russia"],
    "Americas": ["united states of america","united states","canada","mexico","brazil","argentina","peru","chile"],
    "Oceania": ["australia","new zealand","fiji"],
    "Africa": ["egypt","south africa","morocco","kenya","nigeria"]
};
const countryAliasMap = { "us":"United States of America","usa":"United States of America","uk":"United Kingdom","prc":"China","roc":"Taiwan","ua":"Ukraine" };
const continentLabelMap = {
    Asia: '亞洲',
    Europe: '歐洲',
    Americas: '美洲',
    Oceania: '大洋洲',
    Africa: '非洲',
    Other: '其他'
};
function getContinentLabel(continent) {
    return continentLabelMap[continent] || continent || '全部';
}
const flagCodeMap = {
    "japan":"jp","taiwan":"tw","united kingdom":"gb","united states of america":"us","united states":"us",
    "thailand":"th","malaysia":"my","china":"cn","south korea":"kr","france":"fr","germany":"de","italy":"it",
    "spain":"es","indonesia":"id","vietnam":"vn","singapore":"sg","australia":"au","switzerland":"ch",
    "hong kong":"hk","macau":"mo","philippines":"ph","india":"in","united arab emirates":"ae","ukraine":"ua",
    "netherlands":"nl","sweden":"se","austria":"at","belgium":"be","portugal":"pt","greece":"gr","russia":"ru",
    "canada":"ca","mexico":"mx","brazil":"br","argentina":"ar","peru":"pe","chile":"cl","new zealand":"nz",
    "fiji":"fj","egypt":"eg","south africa":"za","morocco":"ma","kenya":"ke","nigeria":"ng","colombia":"co"
};
function standardizeCountry(input) { return countryAliasMap[(input||'').trim().toLowerCase()] || (input||'').trim(); }
function formatPlaceName(text) {
    const raw = (text || '').trim();
    if (!raw) return '';

    const lower = raw.toLowerCase();

    const specialMap = {
        'uk': 'UK',
        'usa': 'USA',
        'uae': 'UAE',
        'hong kong': 'Hong Kong',
        'hong kong sar': 'Hong Kong SAR',
        'macau': 'Macau',
        'new york': 'New York',
        'los angeles': 'Los Angeles',
        'las vegas': 'Las Vegas',
        'united kingdom': 'United Kingdom',
        'united states of america': 'United States of America',
        'south korea': 'South Korea',
        'taipei': 'Taipei',
        'tokyo': 'Tokyo',
        'osaka': 'Osaka',
        'kyoto': 'Kyoto',
        'london': 'London',
        'paris': 'Paris',
        'bangkok': 'Bangkok',
        'beijing': 'Beijing',
        'tianjin': 'Tianjin'
    };

    if (specialMap[lower]) return specialMap[lower];

    return lower.replace(/\b\w/g, c => c.toUpperCase());
}
function buildRegionPopup(loc, days) {
    return `<strong>${getFlag(loc.country)} ${formatPlaceName(loc.region)}</strong><br>${formatPlaceName(loc.country)}<br>${UI_TEXT.popup.vibeRank}: No.${loc.ranking}<br>${UI_TEXT.popup.stayDays}: ${days} 天`;
}

function buildTimelinePopup(loc) {
    return `<strong>${getFlag(loc.country)} ${formatPlaceName(loc.region)}</strong><br>${formatPlaceName(loc.country)}<br>${UI_TEXT.popup.date} ${loc.dateRange || loc.dateStart}`;
}

function buildLogItemHTML(loc, days) {
    return `
        <div class="log-item-main">
            <div class="log-item-info">
                <div class="log-item-place">${getFlag(loc.country)} ${formatPlaceName(loc.region)}</div>
                <div class="log-item-meta">${formatPlaceName(loc.country)} · ${days} 天</div>
                <div class="log-date">${UI_TEXT.popup.date} ${loc.dateRange || UI_TEXT.log.noRecord}</div>
            </div>
            <div class="log-item-side">
                <span class="log-rank-pill">#${loc.ranking}</span>
                <span class="log-chevron">›</span>
            </div>
        </div>
        <div class="action-group">
            <button class="action-btn edit-btn" data-action="edit" data-id="${loc.id}">${UI_TEXT.log.edit}</button>
            <button class="action-btn delete-btn" data-action="delete" data-id="${loc.id}">${UI_TEXT.log.delete}</button>
        </div>
    `;
}
const UI_TEXT = {
    popup: {
        vibeRank: '🏆 Vibe 排名',
        stayDays: '⏱️ 停留',
        date: '📅'
    },
    log: {
        noRecord: '未紀錄',
        edit: '編輯',
        delete: '刪除'
    },
    summary: {
        stay: '停留',
        avgRank: '排名均值',
        cityCountSuffix: '座城市'
    },
    buttons: {
        submitCreate: '🚀 空降新領地',
        submitEdit: '💾 儲存變更',
        submitLoading: '🛰️ 衛星掃描中...',
        importIdle: '📂 匯入舊版 JSON',
        importLoading: '☁️ 上傳中...',
        timelineIdle: '▶ 軌跡推演',
        timelineLoading: '推演中... ⏳',
        aiLoading: '🧠 神經網絡演算中...'
    },
    modal: {
        aiTitle: 'AI 戰略預測分析',
        aiClose: '關閉',
        confirmDeleteTitle: '刪除這筆旅遊紀錄？',
        confirmDeleteMessage: '刪除後不會自動復原。',
        confirmDeleteYes: '確認刪除',
        confirmDeleteNo: '先不要'
    },
    toast: {
        geoNotFound: '找不到地理資料，請確認拼寫是否正確。',
        noExportData: '尚未有任何旅遊紀錄可匯出。',
        noTimelineData: '沒有包含日期的旅遊紀錄可推演。',
        timelineDone: '戰略推演完畢。',
        aiNoData: '請先輸入旅遊紀錄，AI 才能進行偏好分析。',
        aiUnavailable: '無法連線到 AI 服務，伺服器可能正在喚醒中，稍後再試。',
        importFormatError: 'JSON 格式有誤，必須是陣列格式。',
        importParseError: '檔案解析失敗。',
        deleteDone: '已刪除這筆旅遊紀錄。'
    },
    ai: {
        header: '🤖 [AI 戰略預測分析]',
        analysis: '🔍 偏好解析：',
        target: '🎯 建議空降座標：',
        reason: '📝 戰略理由：'
    }
};
function formatDisplayDate(dateStr) {
    if (!dateStr) return '未紀錄';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return dateStr;
    return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
}

function buildDateRangeLabel(loc) {
    if (loc?.dateStart && loc?.dateEnd) {
        return `${formatDisplayDate(loc.dateStart)} – ${formatDisplayDate(loc.dateEnd)}`;
    }
    if (loc?.dateRange) return loc.dateRange;
    if (loc?.dateStart) return formatDisplayDate(loc.dateStart);
    return '未紀錄';
}

function buildSummaryCardHTML(countryName, stat, cityCnt) {
    const avgRank = (stat.totalRank / stat.visits).toFixed(1);

    return `
        <article class="summary-card" data-open-country-detail="${countryName}" tabindex="0" role="button" aria-label="查看 ${formatPlaceName(countryName)} 詳情">
            <div class="summary-card-top">
                <div class="summary-card-name">${getFlag(countryName)} ${formatPlaceName(countryName)}</div>
                <div class="summary-card-pill">${stat.totalDays} 天</div>
            </div>
            <div class="summary-card-meta">${cityCnt} ${UI_TEXT.summary.cityCountSuffix} · ${UI_TEXT.summary.avgRank} ${avgRank}</div>
        </article>
    `;
}

function buildCountrySummaryHeroHTML(countryName, stat, cityCount, totalDaysAll) {
    const avgRank = (stat.totalRank / stat.visits).toFixed(1);
    const share = totalDaysAll > 0 ? ((stat.totalDays / totalDaysAll) * 100).toFixed(0) : '0';

    return `
        <article class="country-hero-card" data-open-country-detail="${countryName}" tabindex="0" role="button" aria-label="查看 ${formatPlaceName(countryName)} 國家摘要">
            <div class="country-hero-copy">
                <div class="country-hero-kicker">Primary Destination</div>
                <div class="country-hero-name">${getFlag(countryName)} ${formatPlaceName(countryName)}</div>
                <div class="country-hero-meta">${cityCount} ${UI_TEXT.summary.cityCountSuffix} · 平均排名 ${avgRank}</div>
            </div>
            <div class="country-hero-stats">
                <div class="country-hero-stat">
                    <span>停留</span>
                    <strong>${stat.totalDays} 天</strong>
                </div>
                <div class="country-hero-stat">
                    <span>占比</span>
                    <strong>${share}%</strong>
                </div>
                <div class="country-hero-stat">
                    <span>造訪</span>
                    <strong>${stat.visits} 次</strong>
                </div>
            </div>
        </article>
    `;
}


function getCountryLocations(countryName) {
    return locations.filter(loc => formatPlaceName(loc.country || '') === formatPlaceName(countryName || ''));
}

function focusMapOnLocation(loc) {
    if (!loc || !loc.lat || !loc.lng) return;
    switchMode('region');
    mapMain.addLayer(regionLayerGroup);
    mapMain.flyTo([loc.lat, loc.lng], 6, { duration: 1.1 });
}

function focusMapOnCountry(countryName) {
    const matching = getCountryLocations(countryName).filter(loc => loc.lat && loc.lng);
    if (!matching.length) return;

    switchMode('region');
    mapMain.addLayer(regionLayerGroup);

    if (matching.length === 1) {
        mapMain.flyTo([matching[0].lat, matching[0].lng], 5, { duration: 1.1 });
        return;
    }

    const bounds = L.latLngBounds(matching.map(loc => [loc.lat, loc.lng]));
    mapMain.fitBounds(bounds.pad(0.32), { animate: true, duration: 1.1 });
}

function buildLogDetailHTML(loc) {
    const days = calculateDays(loc.dateStart, loc.dateEnd);
    const continent = getContinentLabel(getContinent(loc.country));
    const hasBoundary = Boolean(loc.geojson && (loc.geojson.type === 'Polygon' || loc.geojson.type === 'MultiPolygon'));

    return `
        <section class="detail-hero">
            <div class="detail-hero-topline">
                <div>
                    <div class="detail-hero-kicker">Travel Record</div>
                    <div class="detail-hero-title">${getFlag(loc.country)} ${formatPlaceName(loc.region)}</div>
                    <div class="detail-hero-subtitle">${formatPlaceName(loc.country)} · ${buildDateRangeLabel(loc)}</div>
                </div>
                <div class="detail-rank-badge">Vibe #${loc.ranking || '—'}</div>
            </div>
            <div class="detail-chip-row">
                <span class="detail-chip">停留 ${days} 天</span>
                <span class="detail-chip">${continent}</span>
                <span class="detail-chip">${hasBoundary ? '有邊界資料' : '點位模式'}</span>
            </div>
            <div class="detail-actions">
                <button type="button" class="drawer-action-btn drawer-action-btn--primary" data-detail-action="focus-log" data-id="${loc.id}">在地圖查看</button>
                <button type="button" class="drawer-action-btn" data-detail-action="edit-log" data-id="${loc.id}">編輯這筆</button>
                <button type="button" class="drawer-action-btn drawer-action-btn--danger" data-detail-action="delete-log" data-id="${loc.id}">刪除</button>
            </div>
        </section>

        <section class="detail-section">
            <div class="detail-section-head">
                <div class="detail-section-title">旅程資訊</div>
                <div class="detail-section-note">Maps 式快速摘要</div>
            </div>
            <div class="detail-meta-list">
                <div class="detail-meta-row"><span class="detail-meta-label">日期</span><span class="detail-meta-value">${buildDateRangeLabel(loc)}</span></div>
                <div class="detail-meta-row"><span class="detail-meta-label">國家 / 城市</span><span class="detail-meta-value">${formatPlaceName(loc.country)} · ${formatPlaceName(loc.region)}</span></div>
                <div class="detail-meta-row"><span class="detail-meta-label">座標</span><span class="detail-meta-value">${loc.lat ? Number(loc.lat).toFixed(4) : '—'}, ${loc.lng ? Number(loc.lng).toFixed(4) : '—'}</span></div>
                <div class="detail-meta-row"><span class="detail-meta-label">資料型態</span><span class="detail-meta-value">${hasBoundary ? 'Region polygon / MultiPolygon' : 'Marker point only'}</span></div>
            </div>
        </section>
    `;
}

function buildCountryDetailHTML(countryName) {
    const countryLocs = getCountryLocations(countryName);
    const sortedByDate = [...countryLocs].sort((a, b) => {
        const ta = a.dateStart ? new Date(a.dateStart).getTime() : a.id;
        const tb = b.dateStart ? new Date(b.dateStart).getTime() : b.id;
        return tb - ta;
    });

    if (!countryLocs.length) {
        return '<div class="drawer-empty-state">找不到這個國家的旅程資料。</div>';
    }

    const totalDays = countryLocs.reduce((sum, loc) => sum + calculateDays(loc.dateStart, loc.dateEnd), 0);
    const avgRank = (countryLocs.reduce((sum, loc) => sum + (parseInt(loc.ranking) || 0), 0) / countryLocs.length).toFixed(1);
    const uniqueCities = new Map();
    const yearSet = new Set();

    countryLocs.forEach(loc => {
        const key = formatPlaceName(loc.region || '未知地點');
        const days = calculateDays(loc.dateStart, loc.dateEnd);
        const prev = uniqueCities.get(key) || { visits: 0, days: 0, bestRank: Infinity };
        uniqueCities.set(key, {
            visits: prev.visits + 1,
            days: prev.days + days,
            bestRank: Math.min(prev.bestRank, parseInt(loc.ranking) || Infinity)
        });
        const year = extractYear(loc);
        if (year) yearSet.add(year);
    });

    const cityEntries = [...uniqueCities.entries()]
        .sort((a, b) => b[1].days - a[1].days || a[1].bestRank - b[1].bestRank)
        .slice(0, 6);

    const years = [...yearSet].sort();
    const yearsLabel = years.length ? `${years[0]}${years.length > 1 ? ` – ${years[years.length - 1]}` : ''}` : '未紀錄';

    const tripRows = sortedByDate.map(loc => {
        const days = calculateDays(loc.dateStart, loc.dateEnd);
        return `
            <button type="button" class="drawer-trip-row" data-detail-action="open-log" data-id="${loc.id}">
                <div class="drawer-trip-main">
                    <div class="drawer-trip-place">${formatPlaceName(loc.region)}</div>
                    <div class="drawer-trip-date">${buildDateRangeLabel(loc)}</div>
                    <div class="drawer-trip-meta">停留 ${days} 天 · 排名 #${loc.ranking || '—'}</div>
                </div>
                <div class="drawer-trip-pills">
                    <span class="detail-micro-pill">${days} 天</span>
                    <span class="detail-micro-pill">#${loc.ranking || '—'}</span>
                </div>
            </button>
        `;
    }).join('');

    const cityRows = cityEntries.map(([cityName, stat]) => `
        <div class="city-breakdown-item">
            <div class="city-breakdown-top">
                <div>
                    <div class="city-breakdown-name">${cityName}</div>
                    <div class="city-breakdown-meta">${stat.visits} 次造訪 · 最佳排名 #${Number.isFinite(stat.bestRank) ? stat.bestRank : '—'}</div>
                </div>
                <div class="city-pill-row">
                    <span class="detail-micro-pill">${stat.days} 天</span>
                </div>
            </div>
        </div>
    `).join('');

    return `
        <section class="detail-hero detail-hero--country">
            <div class="detail-hero-topline">
                <div>
                    <div class="detail-hero-kicker">Country Detail</div>
                    <div class="detail-hero-title">${getFlag(countryName)} ${formatPlaceName(countryName)}</div>
                    <div class="detail-hero-subtitle">${countryLocs.length} 筆旅程 · ${uniqueCities.size} 座城市 · 活動年份 ${yearsLabel}</div>
                </div>
                <div class="detail-rank-badge">平均 #${avgRank}</div>
            </div>
            <div class="detail-stat-grid">
                <div class="detail-stat-card"><span class="detail-stat-label">停留總天數</span><span class="detail-stat-value">${totalDays}</span></div>
                <div class="detail-stat-card"><span class="detail-stat-label">造訪次數</span><span class="detail-stat-value">${countryLocs.length}</span></div>
                <div class="detail-stat-card"><span class="detail-stat-label">城市數</span><span class="detail-stat-value">${uniqueCities.size}</span></div>
                <div class="detail-stat-card"><span class="detail-stat-label">平均排名</span><span class="detail-stat-value">#${avgRank}</span></div>
            </div>
            <div class="detail-actions">
                <button type="button" class="drawer-action-btn drawer-action-btn--primary" data-detail-action="focus-country" data-country="${countryName}">在地圖查看</button>
                <button type="button" class="drawer-action-btn" data-detail-action="filter-country" data-country="${countryName}">篩選這個國家</button>
            </div>
        </section>

        <section class="detail-section">
            <div class="detail-section-head">
                <div class="detail-section-title">城市分布</div>
                <div class="detail-section-note">Health 式關鍵 breakdown</div>
            </div>
            <div class="city-breakdown-list">${cityRows || '<div class="drawer-empty-state">沒有城市資料。</div>'}</div>
        </section>

        <section class="detail-section">
            <div class="detail-section-head">
                <div class="detail-section-title">旅程列表</div>
                <div class="detail-section-note">點擊可切到單筆旅程 drawer</div>
            </div>
            <div class="detail-trip-list">${tripRows}</div>
        </section>
    `;
}

function getContinent(cName) {
    const c = standardizeCountry(cName).toLowerCase();
    for (const [continent, countries] of Object.entries(continentMapping)) { if (countries.includes(c)) return continent; }
    return "Other";
}
function getFlag(c) {
    const code = flagCodeMap[(c||'').toLowerCase()];
    return code ? `<img src="https://flagcdn.com/w20/${code}.png" style="width:17px;vertical-align:middle;border-radius:2px;margin-right:3px;box-shadow:0 0 3px rgba(0,0,0,0.5);">` : "📍";
}
function getFlagText(c) {
    const code = flagCodeMap[(c||'').toLowerCase()];
    if (!code) return "📍";
    return String.fromCodePoint(...code.toUpperCase().split('').map(char => 127397 + char.charCodeAt(0)));
}
function getCountryArea(feature) {
    const name = (feature.properties?.name || feature.properties?.ADMIN || '').toLowerCase();
    if (!name) return 0;
    if (!countryAreaCache[name]) countryAreaCache[name] = turf.area(feature) / 1_000_000;
    return countryAreaCache[name];
}
const varCSS = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const toastRoot = document.getElementById('toast-root');
const appModal = document.getElementById('app-modal');
const appModalTitle = document.getElementById('app-modal-title');
const appModalBody = document.getElementById('app-modal-body');
const appModalActions = document.getElementById('app-modal-actions');
const appModalClose = document.getElementById('app-modal-close');
const appModalBackdrop = appModal?.querySelector('[data-close-modal]');

function showToast(message, type = 'info', duration = 2600) {
    if (!toastRoot) return;

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.textContent = message;

    toastRoot.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 220);
    }, duration);
}

function closeAppModal() {
    if (!appModal) return;
    appModal.classList.remove('is-open');
    appModal.setAttribute('aria-hidden', 'true');
    appModalActions.innerHTML = '';
}

function openAppModal({ title = '提示', message = '', actions = [] }) {
    if (!appModal) return;

    appModalTitle.textContent = title;
    appModalBody.textContent = message;
    appModalActions.innerHTML = '';

    actions.forEach(action => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = action.className || 'app-modal-btn';
        btn.textContent = action.label;
        btn.addEventListener('click', action.onClick);
        appModalActions.appendChild(btn);
    });

    appModal.classList.add('is-open');
    appModal.setAttribute('aria-hidden', 'false');
}

function showMessageModal({ title = '提示', message = '', confirmText = '知道了' }) {
    return new Promise(resolve => {
        openAppModal({
            title,
            message,
            actions: [
                {
                    label: confirmText,
                    className: 'app-modal-btn app-modal-btn--primary',
                    onClick: () => {
                        closeAppModal();
                        resolve(true);
                    }
                }
            ]
        });
    });
}

function showConfirmModal({
    title = '請確認',
    message = '',
    confirmText = '確認',
    cancelText = '取消',
    danger = false
}) {
    return new Promise(resolve => {
        openAppModal({
            title,
            message,
            actions: [
                {
                    label: cancelText,
                    className: 'app-modal-btn',
                    onClick: () => {
                        closeAppModal();
                        resolve(false);
                    }
                },
                {
                    label: confirmText,
                    className: danger
                        ? 'app-modal-btn app-modal-btn--danger'
                        : 'app-modal-btn app-modal-btn--primary',
                    onClick: () => {
                        closeAppModal();
                        resolve(true);
                    }
                }
            ]
        });
    });
}

appModalClose?.addEventListener('click', closeAppModal);
appModalBackdrop?.addEventListener('click', closeAppModal);

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && appModal?.classList.contains('is-open')) {
        closeAppModal();
    }
});

function getFilteredLocations() {
    const searchKeyword = (document.getElementById('search-log')?.value || '').toLowerCase();
    const filterYear = document.getElementById('filter-year')?.value || 'all';
    const filterContinent = document.getElementById('filter-continent')?.value || 'all';

    return locations.filter(loc => {
        const c = (loc.country || '').toLowerCase();
        const r = (loc.region || '').toLowerCase();
        const locCont = getContinent(loc.country);
        const locYear = extractYear(loc) || 'none';

        return (c.includes(searchKeyword) || r.includes(searchKeyword))
            && (filterYear === 'all' || locYear === filterYear)
            && (filterContinent === 'all' || locCont === filterContinent);
    });
}

function updateHeatLayer(sourceLocations = locations) {
    if (heatLayerGroup) {
        mapMain.removeLayer(heatLayerGroup);
        heatLayerGroup = null;
    }

    const heatPoints = sourceLocations
        .filter(l => l.lat && l.lng)
        .map(l => {
            const days = calculateDays(l.dateStart, l.dateEnd);
            const rank = parseInt(l.ranking) || 10;
            return [l.lat, l.lng, days * (1 / rank)];
        });

    heatLayerGroup = L.heatLayer(heatPoints, {
        radius: 35,
        blur: 20,
        max: 15,
        maxZoom: 6,
        gradient: {
            0.2: 'blue',
            0.4: 'cyan',
            0.6: 'lime',
            0.8: 'yellow',
            1.0: 'red'
        }
    }).addTo(mapMain);
}
const chartRegistry = {
    annual: null,
    continent: null
};

function destroyChart(name) {
    if (chartRegistry[name]) {
        chartRegistry[name].destroy();
        chartRegistry[name] = null;
    }
}

function getLegendOptions(position = 'top') {
    return {
        position,
        align: position === 'right' ? 'center' : 'start',
        labels: {
            color: '#98a4b8',
            usePointStyle: true,
            pointStyle: 'circle',
            boxWidth: 8,
            boxHeight: 8,
            padding: 16,
            font: { family: 'Inter', size: 11, weight: '600' }
        }
    };
}

function getMonoTicks({ size = 10, stepSize } = {}) {
    return {
        color: '#7f8a9f',
        padding: 6,
        maxTicksLimit: 6,
        ...(stepSize !== undefined ? { stepSize } : {}),
        font: { family: 'JetBrains Mono', size }
    };
}

function getTooltipOptions() {
    return {
        backgroundColor: 'rgba(28, 31, 39, 0.96)',
        titleColor: '#f5f7fb',
        bodyColor: '#d9e0ec',
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        titleFont: { family: 'Inter', size: 12, weight: '700' },
        bodyFont: { family: 'Inter', size: 12, weight: '500' },
        cornerRadius: 14,
        displayColors: true,
        boxPadding: 4,
        padding: 12
    };
}

function getAnnualChartConfig(labels, dataCounts, dataDays, cumulativeCountries) {
    return {
        type: 'bar',
        data: {
            labels,
            datasets: [
                {
                    type: 'bar',
                    label: '出征次數',
                    data: dataCounts,
                    backgroundColor: 'rgba(86, 184, 255, 0.78)',
                    hoverBackgroundColor: 'rgba(106, 198, 255, 0.92)',
                    borderRadius: 10,
                    borderSkipped: false,
                    maxBarThickness: 28,
                    yAxisID: 'y'
                },
                {
                    type: 'line',
                    label: '停留天數',
                    data: dataDays,
                    borderColor: '#ffd37a',
                    backgroundColor: '#ffd37a',
                    borderWidth: 2.5,
                    tension: 0.34,
                    pointRadius: 3.5,
                    pointHoverRadius: 5,
                    pointBackgroundColor: '#ffd37a',
                    pointBorderWidth: 0,
                    fill: false,
                    yAxisID: 'y1'
                },
                {
                    type: 'line',
                    label: '累積國家數',
                    data: cumulativeCountries,
                    borderColor: '#8fe3c0',
                    backgroundColor: '#8fe3c0',
                    borderWidth: 2,
                    tension: 0.28,
                    borderDash: [6, 6],
                    pointRadius: 2.5,
                    pointHoverRadius: 4,
                    pointBackgroundColor: '#8fe3c0',
                    pointBorderWidth: 0,
                    fill: false,
                    yAxisID: 'y'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: getLegendOptions(),
                tooltip: getTooltipOptions()
            },
            scales: {
                y: {
                    type: 'linear',
                    position: 'left',
                    beginAtZero: true,
                    ticks: getMonoTicks({ size: 10, stepSize: 1 }),
                    grid: { color: 'rgba(255,255,255,0.06)', drawBorder: false }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    beginAtZero: true,
                    ticks: getMonoTicks({ size: 10 }),
                    grid: { display: false },
                    border: { display: false }
                },
                x: {
                    ticks: getMonoTicks({ size: 10 }),
                    grid: { display: false },
                    border: { display: false }
                }
            }
        }
    };
}

function getContinentChartConfig(continentCounts) {
    const labels = Object.keys(continentCounts).map(c => continentLabelMap[c] || c);

    return {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data: Object.values(continentCounts),
                backgroundColor: ['#77c8ff', '#8fe3c0', '#ffd37a', '#ff8f8f', '#bca7ff', '#8e96a3'],
                borderWidth: 0,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
                legend: getLegendOptions('right'),
                tooltip: getTooltipOptions()
            }
        }
    };
}
function setButtonLoading(btn, label, { useHtml = false, opacity = '0.72', background } = {}) {
    if (!btn) return;

    if (useHtml) btn.innerHTML = label;
    else btn.innerText = label;

    btn.disabled = true;
    btn.style.opacity = opacity;

    if (background !== undefined) {
        btn.style.background = background;
    }
}

function setButtonIdle(btn, label, { useHtml = false, opacity = '1', background = '' } = {}) {
    if (!btn) return;

    if (useHtml) btn.innerHTML = label;
    else btn.innerText = label;

    btn.disabled = false;
    btn.style.opacity = opacity;
    btn.style.background = background;
}

function syncSubmitButtonUI() {
    const submitBtn = document.getElementById('submit-btn');
    const cancelBtn = document.getElementById('cancel-edit-btn');

    if (!submitBtn || !cancelBtn) return;

    if (editingId) {
        setButtonIdle(submitBtn, UI_TEXT.buttons.submitEdit, {
            background: 'linear-gradient(135deg,#f5c842,#d97706)'
        });
        cancelBtn.style.display = 'block';
    } else {
        setButtonIdle(submitBtn, UI_TEXT.buttons.submitCreate, {
            background: ''
        });
        cancelBtn.style.display = 'none';
    }
}

// ==========================================
// 4. 地圖初始化
// ==========================================
const mapMain = L.map('map-main', { zoomControl: true }).setView([25, 0], 2);
mapMain.zoomControl.setPosition('topright');
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution:'&copy; OSM', minZoom:2, maxZoom:18 }).addTo(mapMain);
const countryLayerGroup = L.layerGroup().addTo(mapMain);
const regionLayerGroup = L.layerGroup();
let heatLayerGroup = null;


function updateMapModeLabel(mode = currentMode) {
    const modeLabel = document.getElementById('map-mode-label');
    if (!modeLabel) return;
    const mapModeText = {
        country: '國家檢視',
        region: '據點檢視',
        heat: '熱區檢視'
    };
    modeLabel.textContent = mapModeText[mode] || '地圖檢視';
}

function switchMode(mode) {
    currentMode = mode;

    ['country', 'region', 'heat'].forEach(m => {
        document.getElementById(`btn-mode-${m}`)?.classList.remove('active');
    });
    document.getElementById(`btn-mode-${mode}`)?.classList.add('active');
    updateMapModeLabel(mode);

    mapMain.removeLayer(countryLayerGroup);
    mapMain.removeLayer(regionLayerGroup);

    if (heatLayerGroup) {
        mapMain.removeLayer(heatLayerGroup);
        heatLayerGroup = null;
    }

    const filtered = getFilteredLocations();

    if (mode === 'country') {
        renderMapCountries(filtered);
        mapMain.addLayer(countryLayerGroup);
    } else if (mode === 'region') {
        renderMapRegions(filtered);
        mapMain.addLayer(regionLayerGroup);
    } else if (mode === 'heat') {
        updateHeatLayer(filtered);
    }
}

// ==========================================
// 5. 地圖國家渲染
// ==========================================
function renderMapCountries(sourceLocations = locations) {
    if (!worldGeoJSON) return;

    countryLayerGroup.clearLayers();

    const countryDaysMap = {};
    sourceLocations.forEach(loc => {
        const cName = (loc.country || '').toLowerCase();
        countryDaysMap[cName] = (countryDaysMap[cName] || 0) + calculateDays(loc.dateStart, loc.dateEnd);
    });

    const maxDays = Math.max(...Object.values(countryDaysMap), 1);
    let totalExploredAreaKm2 = 0;

    L.geoJSON(worldGeoJSON, {
        style: (feature) => {
            const countryName = (feature.properties?.name || feature.properties?.ADMIN || '').toLowerCase();
            const days = countryDaysMap[countryName] || 0;
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

    document.getElementById('explore-percent').innerText =
        `${((totalExploredAreaKm2 / EARTH_LAND_AREA_KM2) * 100).toFixed(4)}%`;

    document.getElementById('explore-area').innerText =
        `${Math.round(totalExploredAreaKm2).toLocaleString()} km² / 1.48億 km²`;
}

function renderMapRegions(sourceLocations = locations) {
    regionLayerGroup.clearLayers();

    sourceLocations.forEach(loc => {
        const days = calculateDays(loc.dateStart, loc.dateEnd);
        const popupContent = buildRegionPopup(loc, days);

        if (loc.geojson && (loc.geojson.type === 'Polygon' || loc.geojson.type === 'MultiPolygon')) {
            L.geoJSON(loc.geojson, {
                style: {
                    fillColor: varCSS('--cyan'),
                    weight: 2,
                    color: varCSS('--cyan'),
                    fillOpacity: 0.4
                }
            }).bindPopup(popupContent).addTo(regionLayerGroup);
        } else if (loc.lat && loc.lng) {
            L.circleMarker([loc.lat, loc.lng], {
                color: varCSS('--cyan'),
                fillColor: varCSS('--cyan'),
                fillOpacity: 0.85,
                radius: 7
            }).bindPopup(popupContent).addTo(regionLayerGroup);
        }
    });
}

// ==========================================
// 6. Charts
// ==========================================
function renderChart(filteredLocs = locations) {
    const barCanvas = document.getElementById('annualChart');
    const pieCanvas = document.getElementById('continentPieChart');
    if (!barCanvas || !pieCanvas) return;
    if (typeof Chart === 'undefined') {
        console.warn('Chart.js 未載入，略過圖表渲染。');
        return;
    }

    const yearCounts = {};
    const yearDays = {};
    const continentCounts = {};

    filteredLocs.forEach(loc => {
        const days = calculateDays(loc.dateStart, loc.dateEnd);
        const y = extractYear(loc) || '未知';

        yearCounts[y] = (yearCounts[y] || 0) + 1;
        yearDays[y] = (yearDays[y] || 0) + days;

        const cont = getContinent(loc.country);
        continentCounts[cont] = (continentCounts[cont] || 0) + 1;
    });

    const labels = Object.keys(yearCounts).filter(y => y !== '未知').sort();
    const dataCounts = labels.map(y => yearCounts[y]);
    const dataDays = labels.map(y => yearDays[y]);

    const cumulativeCountries = labels.map(year => {
        const locsUp = filteredLocs.filter(l => {
            const ly = extractYear(l);
            return ly && ly <= year;
        });
        return new Set(locsUp.map(l => (l.country || '').toLowerCase())).size;
    });

    try {
        destroyChart('annual');
        chartRegistry.annual = new Chart(
            barCanvas.getContext('2d'),
            getAnnualChartConfig(labels, dataCounts, dataDays, cumulativeCountries)
        );

        destroyChart('continent');
        chartRegistry.continent = new Chart(
            pieCanvas.getContext('2d'),
            getContinentChartConfig(continentCounts)
        );
    } catch (error) {
        console.error('圖表渲染失敗:', error);
    }
}

// ==========================================
// 7. UI 渲染
// ==========================================
function renderUI(filteredLocations = getFilteredLocations()) {
    const list = document.getElementById('log-list');
    const summaryList = document.getElementById('country-summary-list');
    const summaryHero = document.getElementById('country-summary-hero');
    if (!list || !summaryList || !summaryHero) return;

    list.innerHTML = '';
    summaryList.innerHTML = '';
    summaryHero.innerHTML = '';

    const sortBy = document.getElementById('sort-by')?.value || 'date';

    const years = new Set(locations.map(l => extractYear(l)).filter(y => y !== null));
    const yearSelect = document.getElementById('filter-year');

    if (yearSelect) {
        const cur = yearSelect.value;
        yearSelect.innerHTML = '<option value="all">所有年份</option>';

        [...years].sort().reverse().forEach(year => {
            const o = document.createElement('option');
            o.value = year;
            o.text = `${year} 年`;
            yearSelect.appendChild(o);
        });

        if (Array.from(yearSelect.options).some(o => o.value === cur)) {
            yearSelect.value = cur;
        }
    }

    const countriesData = {};
    const uniqueCities = new Set();
    let totalDaysAll = 0;

    filteredLocations.forEach(loc => {
        const days = calculateDays(loc.dateStart, loc.dateEnd);
        const cName = formatPlaceName(loc.country || '未知國家');
        const rank = parseInt(loc.ranking) || 10;

        if (!countriesData[cName]) {
            countriesData[cName] = { totalDays: 0, visits: 0, totalRank: 0 };
        }

        countriesData[cName].totalDays += days;
        countriesData[cName].visits += 1;
        countriesData[cName].totalRank += rank;
        totalDaysAll += days;

        uniqueCities.add(`${cName}_${(loc.region || '').toLowerCase()}`);
    });

    const sortedCountryKeys = Object.keys(countriesData)
    .sort((a, b) => countriesData[b].totalDays - countriesData[a].totalDays);

    if (sortedCountryKeys.length) {
        const topCountry = sortedCountryKeys[0];
        const topStat = countriesData[topCountry];
        const topCityCnt = Array.from(uniqueCities).filter(city => city.startsWith(`${topCountry}_`)).length;
        summaryHero.innerHTML = buildCountrySummaryHeroHTML(topCountry, topStat, topCityCnt, totalDaysAll);
    } else {
        summaryHero.innerHTML = `
            <article class="country-hero-card country-hero-card--empty">
                <div class="country-hero-kicker">Primary Destination</div>
                <div class="country-hero-name">尚未建立旅遊摘要</div>
                <div class="country-hero-meta">新增幾筆旅程後，這裡會自動顯示你的主戰區。</div>
            </article>
        `;
    }

    sortedCountryKeys.slice(0, 4).forEach(c => {
        const stat = countriesData[c];
        const cityCnt = Array.from(uniqueCities).filter(city => city.startsWith(`${c}_`)).length;

        summaryList.innerHTML += buildSummaryCardHTML(c, stat, cityCnt);
    });

    let hhi = 0;
    let entropy = 0;

    Object.values(countriesData).forEach(c => {
        if (totalDaysAll > 0) {
            const p = c.totalDays / totalDaysAll;
            hhi += Math.pow(p, 2);
            entropy -= p * Math.log2(p);
        }
    });

    const concentrationText =
        hhi >= 0.25 ? '高度集中' :
        hhi >= 0.15 ? '中度集中' :
        '高度分散';

    document.getElementById('exposure-continent').innerText = hhi > 0 ? hhi.toFixed(2) : '0.00';
    document.getElementById('exposure-country').innerText =
        totalDaysAll > 0 ? `${concentrationText} (H: ${entropy.toFixed(2)})` : '無資料';

    const sorted = [...filteredLocations].sort((a, b) => {
        if (sortBy === 'rank') {
            return parseInt(a.ranking || 999) - parseInt(b.ranking || 999);
        }

        const ta = a.dateStart ? new Date(a.dateStart).getTime() : a.id;
        const tb = b.dateStart ? new Date(b.dateStart).getTime() : b.id;
        return tb - ta;
    });

    if (!sorted.length) {
        list.innerHTML = `
            <div class="log-empty-state">
                <div class="log-empty-icon">🧭</div>
                <div class="log-empty-title">沒有符合的旅遊紀錄</div>
                <div class="log-empty-copy">試著清掉篩選，或直接新增一筆新的旅程。</div>
            </div>
        `;
    } else {
        let groupedLogs = {};
        let orderedGroupKeys = [];

        if (sortBy === 'rank') {
            const rankBuckets = [
                { key: 'Top 3', label: 'Top 3', test: rank => rank <= 3 },
                { key: '4-6', label: '4–6 名', test: rank => rank >= 4 && rank <= 6 },
                { key: '7+', label: '7 名之後', test: rank => rank >= 7 }
            ];

            rankBuckets.forEach(bucket => {
                groupedLogs[bucket.label] = sorted.filter(loc => bucket.test(parseInt(loc.ranking || 999)));
            });
            orderedGroupKeys = rankBuckets.map(bucket => bucket.label).filter(label => groupedLogs[label].length);
        } else {
            groupedLogs = sorted.reduce((acc, loc) => {
                const year = extractYear(loc) || '未分類';
                if (!acc[year]) acc[year] = [];
                acc[year].push(loc);
                return acc;
            }, {});

            orderedGroupKeys = Object.keys(groupedLogs).sort((a, b) => {
                if (a === '未分類') return 1;
                if (b === '未分類') return -1;
                return Number(b) - Number(a);
            });
        }

        list.innerHTML = orderedGroupKeys.map(groupKey => {
            const entries = groupedLogs[groupKey];
            const totalDays = entries.reduce((sum, loc) => sum + calculateDays(loc.dateStart, loc.dateEnd), 0);
            const rows = entries.map(loc => {
                const days = calculateDays(loc.dateStart, loc.dateEnd);
                return `
                    <article class="log-item ${editingId === loc.id ? 'editing' : ''}" data-open-log-detail="${loc.id}" tabindex="0" role="button" aria-label="查看 ${formatPlaceName(loc.region)} 詳情">
                        ${buildLogItemHTML(loc, days)}
                    </article>
                `;
            }).join('');

            return `
                <section class="log-year-group">
                    <div class="log-year-header">
                        <div>
                            <div class="log-year-title">${groupKey}</div>
                            <div class="log-year-meta">${entries.length} 筆旅程 · ${totalDays} 天</div>
                        </div>
                    </div>
                    <div class="log-year-card">${rows}</div>
                </section>
            `;
        }).join('');
    }

    document.getElementById('count-country').innerText = Object.keys(countriesData).length;
    document.getElementById('count-region').innerText = uniqueCities.size;

    renderChart(filteredLocations);
}

['search-log','filter-year','filter-continent','sort-by'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderAll);
    document.getElementById(id)?.addEventListener('change', renderAll);
});

document.getElementById('log-list')?.addEventListener('click', async function(e) {
    const btn = e.target.closest('[data-action]');
    if (btn) {
        const id = Number(btn.dataset.id);
        const action = btn.dataset.action;

        if (action === 'edit') {
            editLocation(id);
        } else if (action === 'delete') {
            await deleteLocation(id);
        }
        return;
    }

    const logCard = e.target.closest('[data-open-log-detail]');
    if (logCard) {
        openLogDetail(Number(logCard.dataset.openLogDetail));
    }
});

function renderAll() {
    const filtered = getFilteredLocations();

    renderUI(filtered);
    renderMapCountries(filtered);
    renderMapRegions(filtered);

    if (currentMode === 'heat') {
        updateHeatLayer(filtered);
    } else if (currentMode === 'country') {
        mapMain.addLayer(countryLayerGroup);
    } else if (currentMode === 'region') {
        mapMain.addLayer(regionLayerGroup);
    }
}

// ==========================================
// 8. 互動邏輯
// ==========================================
const regionInput = document.getElementById('input-region');
const countryInput = document.getElementById('input-country');
const autocompleteList = document.getElementById('autocomplete-list');
let debounceTimer;

regionInput.addEventListener('input', function() {
    clearTimeout(debounceTimer); const val=this.value.trim();
    if(val.length<2){ autocompleteList.style.display='none'; return; }
    debounceTimer=setTimeout(async()=>{
        try {
            // 已更新：加上你的 ngrok 網址與繞過警告的 header
            const data = await apiFetch(`/api/search?q=${encodeURIComponent(val)}`, {}, { timeoutMs: 10000 }); 
            autocompleteList.innerHTML='';
            if(data.length===0){ autocompleteList.style.display='none'; return; }
            data.forEach(item=>{
                const div=document.createElement('div'); div.className='autocomplete-item';
                const dc=item.address?.country||'';
                div.innerHTML=`<strong>${item.name}</strong> <span style="color:var(--text-dim);font-size:11px;">${dc?', '+dc:''}</span>`;
                div.addEventListener('click',()=>{
                    regionInput.value=item.name; if(dc) countryInput.value=dc;
                    autocompleteList.style.display='none';
                });
                autocompleteList.appendChild(div);
            });
            autocompleteList.style.display='block';
        } catch(e){}
    },400);
});
document.addEventListener('click', e=>{ if(e.target!==regionInput&&e.target!==autocompleteList) autocompleteList.style.display='none'; });

const dateStartEl=document.getElementById('input-date-start');
const dateEndEl=document.getElementById('input-date-end');
dateStartEl?.addEventListener('change',function(){
    dateEndEl.min=this.value;
    if(dateEndEl.value&&dateEndEl.value<this.value) dateEndEl.value=this.value;
});

async function fetchRegionBoundary(region, country = '') {
    try {
        const data = await apiFetch(`/api/boundary?region=${encodeURIComponent(region)}&country=${encodeURIComponent(country || '')}`, {}, { timeoutMs: 25000 });
        if (data && data.length > 0) {
            const item = data[0];
            return {
                lat: parseFloat(item.lat),
                lng: parseFloat(item.lon),
                geojson: item.geojson,
                country: item.address?.country || country || '',
                region: item.name || region,
                address: item.address || {},
                displayName: item.display_name || ''
            };
        }
    } catch(e){ 
        console.error("邊界抓取失敗:", e); 
    } 
    return null;
}

document.getElementById('tracker-form')?.addEventListener('submit', async function(e) {
    e.preventDefault();

    const formatDateLocal = (dateStr) => {
        if (!dateStr) return '';
        const d = new Date(dateStr);
        return `${d.getFullYear()}年${String(d.getMonth() + 1).padStart(2, '0')}月${String(d.getDate()).padStart(2, '0')}日`;
    };

    const submitBtn = document.getElementById('submit-btn');
    setButtonLoading(submitBtn, UI_TEXT.buttons.submitLoading);

    const dStart = dateStartEl.value;
    const dEnd = dateEndEl.value;
    const dateRangeStr = `${formatDateLocal(dStart)} 到 ${formatDateLocal(dEnd)}`;
    const geoData = await fetchRegionBoundary(regionInput.value.trim(), standardizeCountry(countryInput.value));
    if (!geoData) {
    showToast(UI_TEXT.toast.geoNotFound, 'error', 3200);
    syncSubmitButtonUI();
    return;
}
    const inferredCountry = geoData.country || countryInput.value;
    if (!countryInput.value.trim() && inferredCountry) countryInput.value = inferredCountry;
    const normalizedCountry = formatPlaceName(standardizeCountry(inferredCountry));
const normalizedRegion = formatPlaceName(regionInput.value.trim());

const newLog = {
    id: editingId || (new Date(dStart).getTime() + Math.floor(Math.random() * 1000)),
    date_start: dStart,
    date_end: dEnd,
    date_range: dateRangeStr,
    country: normalizedCountry,
    region: normalizedRegion,
    ranking: document.getElementById('input-ranking').value,
    lat: geoData.lat,
    lng: geoData.lng,
    geojson: geoData.geojson
};
    const { error }=await supabaseClient.from('travel_logs').upsert([newLog]);
    if (error) {
    showToast(`寫入失敗：${error.message}`, 'error', 3600);
}
    else {
    const locObj = { ...newLog, dateStart: dStart, dateEnd: dEnd, dateRange: dateRangeStr };

    if (editingId) {
        const idx = locations.findIndex(l => l.id === editingId);
        if (idx !== -1) locations[idx] = locObj;
        cancelEdit();
    } else {
        locations.push(locObj);
        this.reset();
        editingId = null;
        syncSubmitButtonUI();
    }

    renderAll();
    mapMain.flyTo([geoData.lat, geoData.lng], currentMode === 'country' ? 4 : 6);
    closeSheet('compose');
}

syncSubmitButtonUI();
});

function editLocation(id) {
    const loc=locations.find(l=>l.id===id); if(!loc) return;
    countryInput.value=loc.country; regionInput.value=loc.region;
    dateStartEl.value=loc.dateStart||''; dateEndEl.value=loc.dateEnd||'';
    document.getElementById('input-ranking').value=loc.ranking||'';
    editingId=id;
    syncSubmitButtonUI();
    renderUI();
    openComposeSheet();
}

function cancelEdit() {
    editingId = null;
    document.getElementById('tracker-form').reset();
    syncSubmitButtonUI();
    renderUI();
}
async function deleteLocation(id) {
    const confirmed = await showConfirmModal({
        title: UI_TEXT.modal.confirmDeleteTitle,
message: UI_TEXT.modal.confirmDeleteMessage,
confirmText: UI_TEXT.modal.confirmDeleteYes,
cancelText: UI_TEXT.modal.confirmDeleteNo,
        danger: true
    });

    if (!confirmed) return;

    const { error } = await supabaseClient.from('travel_logs').delete().eq('id', id);

    if (error) {
        showToast(`刪除失敗：${error.message}`, 'error', 3600);
    } else {
        locations = locations.filter(l => l.id !== id);
        if (editingId === id) cancelEdit();
        renderAll();
        showToast(UI_TEXT.toast.deleteDone, 'success');
    }
}

function importData(event) {
    const file=event.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=async function(e){
        try {
            const importedData=JSON.parse(e.target.result);
            if(Array.isArray(importedData)){
                const btn = document.getElementById('btn-import-open');
                setButtonLoading(btn, UI_TEXT.buttons.importLoading);
                const payload=importedData.map(l=>({ id:l.id, date_start:l.dateStart||'', date_end:l.dateEnd||'', date_range:l.dateRange||'', country:l.country, region:l.region, ranking:l.ranking||l.rating||10, lat:l.lat, lng:l.lng, geojson:l.geojson }));
                const { error }=await supabaseClient.from('travel_logs').upsert(payload);
                if (error) {
    showToast(`匯入失敗：${error.message}`, 'error', 3600);
} else {
    locations = importedData;
    renderAll();
    showToast(`成功匯入 ${importedData.length} 筆戰報。`, 'success', 3000);
}
setButtonIdle(btn, UI_TEXT.buttons.importIdle);
} else {
    showToast(UI_TEXT.toast.importFormatError, 'warning', 3200);
}
} catch(err) {
    showToast(UI_TEXT.toast.importParseError, 'error', 3200);
}
    };
    reader.readAsText(file); event.target.value='';
}

function exportData(type) {
    if (locations.length === 0) {
    showToast(UI_TEXT.toast.noExportData, 'warning', 2800);
    return;
}
    let dataStr, mimeType, extension;
    if(type==='json'){ dataStr=JSON.stringify(locations,null,2); mimeType="application/json"; extension="json"; }
    else if(type==='csv'){
        const headers=["id","dateStart","dateEnd","country","region","ranking","lat","lng"];
        const rows=[headers.join(",")];
        locations.forEach(l=>rows.push(headers.map(h=>`"${l[h]||''}"`).join(",")));
        dataStr=rows.join("\n"); mimeType="text/csv;charset=utf-8;"; extension="csv";
    }
    const blob=new Blob([dataStr],{type:mimeType}), url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=`travel_log.${extension}`; a.click(); URL.revokeObjectURL(url);
}

async function playTimeline() {
    const validLocs=[...locations].filter(l=>l.lat&&l.lng&&extractYear(l)).sort((a,b)=>{
        const ta=a.dateStart?new Date(a.dateStart).getTime():a.id;
        const tb=b.dateStart?new Date(b.dateStart).getTime():b.id;
        return ta-tb;
    });
    if (validLocs.length === 0) {
    showToast(UI_TEXT.toast.noTimelineData, 'warning', 3000);
    return;
}
    switchMode('region'); regionLayerGroup.clearLayers();
    const btn = document.getElementById('btn-timeline');
    setButtonLoading(btn, UI_TEXT.buttons.timelineLoading, { opacity: '1' });
    const finalPathLine=L.polyline([],{color:'#f5c842',weight:3,opacity:0.8}).addTo(regionLayerGroup);
    const animatingPathLine=L.polyline([],{color:'#f5c842',weight:3,dashArray:'5,8',opacity:0.9}).addTo(regionLayerGroup);
    const personIcon=L.divIcon({ html:'<div style="font-size:28px;text-shadow:2px 2px 4px rgba(0,0,0,0.6);transform:scaleX(-1);">🚶‍♂️</div>', className:'', iconSize:[28,28], iconAnchor:[14,28] });
    let movingMarker=null, completedPath=[], currentContinuousLng=null;
    function animateMovement(start,end,duration){
        return new Promise(resolve=>{
            const t0=performance.now();
            function step(t){
                let p=Math.min((t-t0)/duration,1), e=p*(2-p);
                movingMarker.setLatLng([start[0]+(end[0]-start[0])*e, start[1]+(end[1]-start[1])*e]);
                animatingPathLine.setLatLngs([start,[start[0]+(end[0]-start[0])*e,start[1]+(end[1]-start[1])*e]]);
                if(p<1) requestAnimationFrame(step); else { animatingPathLine.setLatLngs([]); resolve(); }
            }
            requestAnimationFrame(step);
        });
    }
    for(let i=0;i<validLocs.length;i++){
        const loc=validLocs[i]; let targetLat=loc.lat, targetLng=loc.lng;
        if(i===0){
            currentContinuousLng=targetLng;
            const sc=[targetLat,currentContinuousLng];
            mapMain.flyTo(sc,5,{duration:1.5});
            movingMarker=L.marker(sc,{icon:personIcon}).addTo(regionLayerGroup);
            completedPath.push(sc);
            await new Promise(r=>setTimeout(r,1500));
        } else {
            const prev=completedPath[completedPath.length-1];
            let diff=targetLng-(currentContinuousLng%360);
            if(diff>180) diff-=360; else if(diff<-180) diff+=360;
            currentContinuousLng+=diff;
            const next=[targetLat,currentContinuousLng];
            const distKm=turf.distance(turf.point([prev[1],prev[0]]),turf.point([targetLng,targetLat]));
            let dur=Math.max(1200,Math.min((distKm/2000)*1000,4000));
            mapMain.flyTo([targetLat,currentContinuousLng],4,{duration:dur/1000});
            await animateMovement(prev,next,dur);
            completedPath.push(next); finalPathLine.setLatLngs(completedPath);
        }
        L.circleMarker([targetLat,currentContinuousLng],{color:'#f5c842',fillColor:'#f5c842',fillOpacity:0.9,radius:8})
         .bindPopup(buildTimelinePopup(loc))
         .addTo(regionLayerGroup).openPopup();
        await new Promise(r=>setTimeout(r,1000));
    }
    showToast(UI_TEXT.toast.timelineDone, 'success', 2600);
    setButtonIdle(btn, UI_TEXT.buttons.timelineIdle);
    renderMapRegions();
}

// ==========================================
// 🚀 真 AI 戰略預測引擎 (對接 Render 雲端後端)
// ==========================================
async function recommendNext() {
    if (locations.length === 0) {
    showToast(UI_TEXT.toast.aiNoData, 'warning', 3200);
    return;
}

    const btn = document.getElementById('btn-ai');
const originalText = btn.innerHTML;

setButtonLoading(btn, UI_TEXT.buttons.aiLoading, {
    useHtml: true
});

    // 1. 整理戰報數據，精簡傳給後端的 payload
    const payload = locations.map(l => ({
        country: l.country,
        region: l.region,
        ranking: parseInt(l.ranking) || 10,
        days: calculateDays(l.dateStart, l.dateEnd)
    }));

    try {
        // 2. 呼叫 Render 雲端 Python FastAPI (已換成正式網址，並移除 ngrok header)
        const aiResult = await apiFetch('/api/recommend', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ logs: payload })
        }, { timeoutMs: 18000 });

        // 3. 展示 AI 運算結果
        const msg = `${UI_TEXT.ai.header}

${UI_TEXT.ai.analysis}
${aiResult.analysis}

${UI_TEXT.ai.target}
【 ${getFlagText(aiResult.recommend_country)} ${aiResult.recommend_country} - ${aiResult.recommend_city} 】

${UI_TEXT.ai.reason}
${aiResult.reason}`;

        await showMessageModal({
    title: UI_TEXT.modal.aiTitle,
    message: msg,
    confirmText: UI_TEXT.modal.aiClose
});

    } catch (error) {
        console.error('AI 請求失敗:', error);
        const detail = window.location.protocol === 'file:'
            ? `你目前像是直接開 zip 內的 HTML。前端會先嘗試本機 8000，再退回雲端備援；若還是失敗，代表 API 端沒醒或沒啟動。`
            : `前端按鈕本身正常，失敗的是 API 端連線。系統已先嘗試同網域 / 本機 8000，再退回雲端備援。`;
        await showMessageModal({
            title: 'AI 服務暫時不可用',
            message: `${UI_TEXT.toast.aiUnavailable}

${detail}`,
            confirmText: '知道了'
        });
        showToast(UI_TEXT.toast.aiUnavailable, 'error', 4200);
    } finally {
        // 恢復 UI 狀態
       setButtonIdle(btn, originalText, {
    useHtml: true
});
    }
}

// ==========================================
// 🔒 Auth & Session Management (登入閘門)
// ==========================================
async function checkAuth() {
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (session) {
        hideLoginOverlay();
        initApp(); // 有鑰匙，才啟動主程式拉資料
    } else {
        // 沒鑰匙，顯示登入畫面並擋住
        document.getElementById('login-overlay').style.display = 'flex';
    }
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');
    const errorDiv = document.getElementById('login-error');

    btn.innerText = 'AUTHENTICATING...';
    errorDiv.style.display = 'none';

    const { data, error } = await supabaseClient.auth.signInWithPassword({
        email: email,
        password: password,
    });

    if (error) {
        errorDiv.innerText = 'Access Denied: ' + error.message;
        errorDiv.style.display = 'block';
        btn.innerText = 'LOGIN 系統登入';
    } else {
        hideLoginOverlay();
        initApp();
    }
}

async function handleLogout() {
    await supabaseClient.auth.signOut();
    window.location.reload(); // 刷新重置
}

function hideLoginOverlay() {
    const overlay = document.getElementById('login-overlay');
    overlay.style.opacity = '0';
    setTimeout(() => { overlay.style.display = 'none'; }, 300);
}
document.getElementById('loginForm')?.addEventListener('submit', handleLogin);

document.getElementById('cancel-edit-btn')?.addEventListener('click', cancelEdit);

document.getElementById('btn-mode-country')?.addEventListener('click', () => switchMode('country'));
document.getElementById('btn-mode-region')?.addEventListener('click', () => switchMode('region'));
document.getElementById('btn-mode-heat')?.addEventListener('click', () => switchMode('heat'));

document.getElementById('btn-timeline')?.addEventListener('click', playTimeline);
document.getElementById('btn-ai')?.addEventListener('click', recommendNext);

document.getElementById('btn-export-json')?.addEventListener('click', () => exportData('json'));
document.getElementById('btn-export-csv')?.addEventListener('click', () => exportData('csv'));

document.getElementById('btn-import-open')?.addEventListener('click', () => {
    document.getElementById('import-file')?.click();
});

document.getElementById('import-file')?.addEventListener('change', importData);

document.getElementById('btn-logout')?.addEventListener('click', handleLogout);

// 🚀 網頁載入後的第一個動作：從檢查權限開始！
document.addEventListener('DOMContentLoaded', checkAuth);


// ==========================================
// iOS-style interaction layer
// ==========================================
const sheetBackdrop = document.getElementById('sheet-backdrop');
const composeSheet = document.getElementById('compose-sheet');
const filtersSheet = document.getElementById('filters-sheet');
const detailDrawer = document.getElementById('detail-drawer');
const composeSheetTitle = document.getElementById('compose-sheet-title');
const detailDrawerKicker = document.getElementById('detail-drawer-kicker');
const detailDrawerTitle = document.getElementById('detail-drawer-title');
const detailDrawerSubtitle = document.getElementById('detail-drawer-subtitle');
const detailDrawerContent = document.getElementById('detail-drawer-content');
const bottomTabs = Array.from(document.querySelectorAll('.tabbar-btn[data-target]'));
const scrollSections = ['section-map', 'section-log', 'section-insights', 'section-settings']
    .map(id => document.getElementById(id))
    .filter(Boolean);

function hoistOverlayNodes() {
    [composeSheet, filtersSheet, detailDrawer, sheetBackdrop].forEach(node => {
        if (node && node.parentElement !== document.body) {
            document.body.appendChild(node);
        }
    });
}

const sheetRegistry = {
    compose: composeSheet,
    filters: filtersSheet,
    detail: detailDrawer
};

const appShellState = {
    openSheet: null,
    activeSection: 'section-map',
    detailContext: null
};

hoistOverlayNodes();

function applyAccessibilityPreferences() {
    const mediaQueries = [
        ['reduced-motion', '(prefers-reduced-motion: reduce)'],
        ['reduced-transparency', '(prefers-reduced-transparency: reduce)'],
        ['high-contrast', '(prefers-contrast: more)']
    ];

    mediaQueries.forEach(([className, query]) => {
        try {
            const mq = window.matchMedia(query);
            const sync = () => document.body.classList.toggle(className, mq.matches);
            sync();
            if (mq.addEventListener) mq.addEventListener('change', sync);
            else if (mq.addListener) mq.addListener(sync);
        } catch (_) {
            // Some media queries are not supported in all browsers.
        }
    });
}

function updateComposeHeader() {
    if (!composeSheetTitle) return;
    composeSheetTitle.innerHTML = editingId
        ? '<span class="panel-title-icon">✏️</span> 編輯旅程'
        : '<span class="panel-title-icon">✈️</span> 新增旅程';
}

function syncFilterShortcutState() {
    const currentContinent = document.getElementById('filter-continent')?.value || 'all';
    const currentSort = document.getElementById('sort-by')?.value || 'date';

    document.querySelectorAll('[data-filter-continent]').forEach(btn => {
        btn.classList.toggle('is-active', btn.getAttribute('data-filter-continent') === currentContinent);
    });
    document.querySelectorAll('[data-filter-sort]').forEach(btn => {
        btn.classList.toggle('is-active', btn.getAttribute('data-filter-sort') === currentSort);
    });
}

function resetFilters() {
    const searchInput = document.getElementById('search-log');
    const continentSelect = document.getElementById('filter-continent');
    const yearSelect = document.getElementById('filter-year');
    const sortSelect = document.getElementById('sort-by');

    if (searchInput) searchInput.value = '';
    if (continentSelect) continentSelect.value = 'all';
    if (yearSelect) yearSelect.value = 'all';
    if (sortSelect) sortSelect.value = 'date';

    syncFilterShortcutState();
    renderAll();
}

function openSheet(name) {
    const targetSheet = sheetRegistry[name];
    if (!targetSheet) return;

    Object.entries(sheetRegistry).forEach(([key, sheet]) => {
        const shouldOpen = key === name;
        sheet.classList.toggle('is-open', shouldOpen);
        sheet.setAttribute('aria-hidden', String(!shouldOpen));
    });

    appShellState.openSheet = name;
    document.body.classList.add('has-sheet');
    sheetBackdrop?.classList.add('is-visible');
    sheetBackdrop?.setAttribute('aria-hidden', 'false');
}

function closeSheet(name = appShellState.openSheet) {
    if (name && sheetRegistry[name]) {
        sheetRegistry[name].classList.remove('is-open');
        sheetRegistry[name].setAttribute('aria-hidden', 'true');
        if (name === 'detail') appShellState.detailContext = null;
    } else {
        Object.values(sheetRegistry).forEach(sheet => {
            sheet?.classList.remove('is-open');
            sheet?.setAttribute('aria-hidden', 'true');
        });
        appShellState.detailContext = null;
    }

    appShellState.openSheet = null;
    document.body.classList.remove('has-sheet');
    sheetBackdrop?.classList.remove('is-visible');
    sheetBackdrop?.setAttribute('aria-hidden', 'true');
}

function openComposeSheet() {
    updateComposeHeader();
    openSheet('compose');
    setTimeout(() => regionInput?.focus(), 180);
}

function openFilterSheet() {
    openSheet('filters');
    setTimeout(() => document.getElementById('search-log')?.focus(), 180);
}

function openDetailDrawer({ kicker, title, subtitle, html, context }) {
    if (detailDrawerKicker) detailDrawerKicker.textContent = kicker || 'Detail';
    if (detailDrawerTitle) detailDrawerTitle.innerHTML = title || '<span class="panel-title-icon">🧭</span> 詳情';
    if (detailDrawerSubtitle) detailDrawerSubtitle.textContent = subtitle || '';
    if (detailDrawerContent) detailDrawerContent.innerHTML = html || '<div class="drawer-empty-state">沒有更多內容。</div>';
    appShellState.detailContext = context || null;
    openSheet('detail');
}

function refreshDetailDrawer() {
    const context = appShellState.detailContext;
    if (!context || appShellState.openSheet !== 'detail') return;

    if (context.type === 'log') {
        const loc = locations.find(item => item.id === context.id);
        if (!loc) { closeSheet('detail'); return; }
        openDetailDrawer({
            kicker: 'Travel Record',
            title: '<span class="panel-title-icon">🧭</span> 旅程詳情',
            subtitle: '像 Apple Maps 一樣，先看單筆紀錄的核心資訊，再決定下一步。',
            html: buildLogDetailHTML(loc),
            context
        });
    }

    if (context.type === 'country') {
        const locs = getCountryLocations(context.country);
        if (!locs.length) { closeSheet('detail'); return; }
        openDetailDrawer({
            kicker: 'Country Detail',
            title: '<span class="panel-title-icon">🌐</span> 國家摘要',
            subtitle: '把國家摘要做成第二層 drawer：先看總覽，再點單筆旅程。',
            html: buildCountryDetailHTML(context.country),
            context
        });
    }
}

function openLogDetail(id) {
    const loc = locations.find(item => item.id === id);
    if (!loc) return;
    openDetailDrawer({
        kicker: 'Travel Record',
        title: '<span class="panel-title-icon">🧭</span> 旅程詳情',
        subtitle: '像 Apple Maps 一樣，先看單筆紀錄的核心資訊，再決定下一步。',
        html: buildLogDetailHTML(loc),
        context: { type: 'log', id }
    });
}

function openCountryDetail(countryName) {
    if (!countryName) return;
    openDetailDrawer({
        kicker: 'Country Detail',
        title: '<span class="panel-title-icon">🌐</span> 國家摘要',
        subtitle: '把國家摘要做成第二層 drawer：先看總覽，再點單筆旅程。',
        html: buildCountryDetailHTML(countryName),
        context: { type: 'country', country: formatPlaceName(countryName) }
    });
}

function handleSheetTriggers() {
    document.querySelectorAll('[data-open-sheet]').forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.getAttribute('data-open-sheet');
            if (target === 'compose') openComposeSheet();
            if (target === 'filters') openFilterSheet();
        });
    });

    document.querySelectorAll('[data-close-sheet]').forEach(btn => {
        btn.addEventListener('click', () => closeSheet(btn.getAttribute('data-close-sheet')));
    });

    document.getElementById('topbar-open-compose')?.addEventListener('click', openComposeSheet);
    document.getElementById('topbar-open-filters')?.addEventListener('click', openFilterSheet);

    document.getElementById('country-summary-hero')?.addEventListener('click', (e) => {
        const card = e.target.closest('[data-open-country-detail]');
        if (card) openCountryDetail(card.getAttribute('data-open-country-detail'));
    });

    document.getElementById('country-summary-list')?.addEventListener('click', (e) => {
        const card = e.target.closest('[data-open-country-detail]');
        if (card) openCountryDetail(card.getAttribute('data-open-country-detail'));
    });

    document.getElementById('detail-drawer-content')?.addEventListener('click', async (e) => {
        const actionEl = e.target.closest('[data-detail-action]');
        if (!actionEl) return;

        const action = actionEl.getAttribute('data-detail-action');
        const id = Number(actionEl.getAttribute('data-id'));
        const country = actionEl.getAttribute('data-country');

        if (action === 'focus-log') {
            const loc = locations.find(item => item.id === id);
            if (loc) { focusMapOnLocation(loc); closeSheet('detail'); scrollToSection('section-map'); }
            return;
        }
        if (action === 'edit-log') {
            closeSheet('detail');
            editLocation(id);
            return;
        }
        if (action === 'delete-log') {
            await deleteLocation(id);
            return;
        }
        if (action === 'focus-country') {
            focusMapOnCountry(country);
            closeSheet('detail');
            scrollToSection('section-map');
            return;
        }
        if (action === 'filter-country') {
            const searchInput = document.getElementById('search-log');
            if (searchInput) searchInput.value = country || '';
            renderAll();
            closeSheet('detail');
            scrollToSection('section-log');
            return;
        }
        if (action === 'open-log') {
            openLogDetail(id);
        }
    });

    const bindEnterToDetail = (selector, opener) => {
        document.querySelector(selector)?.addEventListener('keydown', (e) => {
            if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-open-country-detail], [data-open-log-detail]')) {
                e.preventDefault();
                const target = e.target.closest('[data-open-country-detail], [data-open-log-detail]');
                if (target?.dataset.openCountryDetail) opener('country', target.dataset.openCountryDetail);
                if (target?.dataset.openLogDetail) opener('log', Number(target.dataset.openLogDetail));
            }
        });
    };

    bindEnterToDetail('#country-summary-hero', (type, payload) => type === 'country' && openCountryDetail(payload));
    bindEnterToDetail('#country-summary-list', (type, payload) => type === 'country' && openCountryDetail(payload));
    bindEnterToDetail('#log-list', (type, payload) => type === 'log' && openLogDetail(payload));

    document.querySelectorAll('[data-filter-continent]').forEach(btn => {
        btn.addEventListener('click', () => {
            const select = document.getElementById('filter-continent');
            if (select) select.value = btn.getAttribute('data-filter-continent') || 'all';
            syncFilterShortcutState();
            renderAll();
        });
    });

    document.querySelectorAll('[data-filter-sort]').forEach(btn => {
        btn.addEventListener('click', () => {
            const select = document.getElementById('sort-by');
            if (select) select.value = btn.getAttribute('data-filter-sort') || 'date';
            syncFilterShortcutState();
            renderAll();
        });
    });

    document.getElementById('reset-filters-btn')?.addEventListener('click', resetFilters);

    sheetBackdrop?.addEventListener('click', () => closeSheet());
    document.getElementById('cancel-edit-btn')?.addEventListener('click', () => closeSheet('compose'));
}

function scrollToSection(targetId) {
    const section = document.getElementById(targetId);
    if (!section) return;

    const topOffset = window.innerWidth <= 720 ? 72 : 88;
    const top = section.getBoundingClientRect().top + window.scrollY - topOffset;
    window.scrollTo({ top, behavior: document.body.classList.contains('reduced-motion') ? 'auto' : 'smooth' });
}

function setActiveTab(targetId) {
    bottomTabs.forEach(btn => btn.classList.toggle('is-active', btn.dataset.target === targetId));
    appShellState.activeSection = targetId;
}

function initBottomTabs() {
    bottomTabs.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            setActiveTab(targetId);
            scrollToSection(targetId);
        });
    });

    if (!('IntersectionObserver' in window) || scrollSections.length === 0) return;

    const observer = new IntersectionObserver((entries) => {
        const visible = entries
            .filter(entry => entry.isIntersecting)
            .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

        if (visible?.target?.id) {
            setActiveTab(visible.target.id);
        }
    }, {
        rootMargin: '-18% 0px -45% 0px',
        threshold: [0.2, 0.4, 0.6]
    });

    scrollSections.forEach(section => observer.observe(section));
}

function updateHeroMetrics(filteredLocations = getFilteredLocations()) {
    const totalDays = filteredLocations.reduce((sum, loc) => sum + calculateDays(loc.dateStart, loc.dateEnd), 0);
    const countryCount = new Set(filteredLocations.map(loc => (loc.country || '').toLowerCase()).filter(Boolean)).size;
    const regionCount = new Set(filteredLocations.map(loc => `${(loc.country || '').toLowerCase()}__${(loc.region || '').toLowerCase()}`)).size;

    const countryEl = document.getElementById('hero-stat-countries');
    const regionEl = document.getElementById('hero-stat-regions');
    const daysEl = document.getElementById('hero-stat-days');

    if (countryEl) countryEl.textContent = String(countryCount);
    if (regionEl) regionEl.textContent = String(regionCount);
    if (daysEl) daysEl.textContent = String(totalDays);
}

function updateActiveFilterSummary(filteredLocations = getFilteredLocations()) {
    const chipsRoot = document.getElementById('active-filter-chips');
    if (!chipsRoot) return;

    const searchKeyword = (document.getElementById('search-log')?.value || '').trim();
    const filterYear = document.getElementById('filter-year')?.value || 'all';
    const filterContinent = document.getElementById('filter-continent')?.value || 'all';
    const sortBy = document.getElementById('sort-by')?.value || 'date';

    const chips = [
        `<span class="filter-chip"><span>顯示</span><strong>${filteredLocations.length}</strong><span>筆</span></span>`,
        `<span class="filter-chip"><span>排序</span><strong>${sortBy === 'rank' ? 'Vibe 排名' : '出征日期'}</strong></span>`
    ];

    if (searchKeyword) {
        chips.push(`<span class="filter-chip"><span>搜尋</span><strong>${searchKeyword}</strong></span>`);
    }
    if (filterContinent !== 'all') {
        chips.push(`<span class="filter-chip"><span>洲別</span><strong>${getContinentLabel(filterContinent)}</strong></span>`);
    }
    if (filterYear !== 'all') {
        chips.push(`<span class="filter-chip"><span>年份</span><strong>${filterYear}</strong></span>`);
    }

    chipsRoot.innerHTML = chips.join('');
    syncFilterShortcutState();
}

function updateChartInsights(filteredLocs = locations) {
    const annualEl = document.getElementById('annual-chart-insight');
    const continentEl = document.getElementById('continent-chart-insight');
    const annualBadge = document.getElementById('annual-chart-badge');
    const continentBadge = document.getElementById('continent-chart-badge');

    if (!annualEl || !continentEl) return;
    if (!filteredLocs.length) {
        annualEl.textContent = '等待資料中。';
        continentEl.textContent = '等待資料中。';
        if (annualBadge) annualBadge.textContent = 'Trend';
        if (continentBadge) continentBadge.textContent = 'Mix';
        return;
    }

    const yearCountMap = {};
    const continentCountMap = {};
    let bestYear = null;

    filteredLocs.forEach(loc => {
        const year = extractYear(loc);
        if (year) yearCountMap[year] = (yearCountMap[year] || 0) + 1;
        const continent = getContinent(loc.country);
        continentCountMap[continent] = (continentCountMap[continent] || 0) + 1;
    });

    const yearEntries = Object.entries(yearCountMap).sort((a, b) => b[1] - a[1] || String(b[0]).localeCompare(String(a[0])));
    const continentEntries = Object.entries(continentCountMap).sort((a, b) => b[1] - a[1]);

    if (yearEntries.length) {
        bestYear = yearEntries[0];
        annualEl.textContent = `${bestYear[0]} 是目前最密集的一年，共 ${bestYear[1]} 筆旅程。`;
        if (annualBadge) annualBadge.textContent = `Peak ${bestYear[0]}`;
    } else {
        annualEl.textContent = '目前沒有足夠日期資料可形成年度趨勢。';
        if (annualBadge) annualBadge.textContent = 'Trend';
    }

    if (continentEntries.length) {
        const [continent, count] = continentEntries[0];
        const share = ((count / filteredLocs.length) * 100).toFixed(0);
        continentEl.textContent = `${continentLabelMap[continent] || continent} 目前占 ${share}% ，是你的主戰區。`;
        if (continentBadge) continentBadge.textContent = `${share}% ${continentLabelMap[continent] || continent}`;
    } else {
        continentEl.textContent = '目前沒有足夠地區資料可形成洲別結構。';
        if (continentBadge) continentBadge.textContent = 'Mix';
    }
}

const originalRenderUI = renderUI;
renderUI = function(filteredLocations = getFilteredLocations()) {
    originalRenderUI(filteredLocations);
    updateActiveFilterSummary(filteredLocations);
    updateHeroMetrics(filteredLocations);
    updateChartInsights(filteredLocations);
    updateComposeHeader();
    updateMapModeLabel(currentMode);
    refreshDetailDrawer();
};

const originalSyncSubmitButtonUI = syncSubmitButtonUI;
syncSubmitButtonUI = function() {
    originalSyncSubmitButtonUI();
    updateComposeHeader();
};

window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && appShellState.openSheet) {
        closeSheet();
    }
});

document.addEventListener('DOMContentLoaded', () => {
    applyAccessibilityPreferences();
    handleSheetTriggers();
    initBottomTabs();
    updateComposeHeader();
    syncFilterShortcutState();
    updateActiveFilterSummary([]);
});
