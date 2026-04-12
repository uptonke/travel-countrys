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

async function initApp() {
    const { data, error } = await supabaseClient.from('travel_logs').select('*');
    if (error) { console.error("Supabase 讀取失敗:", error); }
    else if (data) {
        locations = data.map(d => ({
            id: d.id, dateStart: d.date_start, dateEnd: d.date_end, dateRange: d.date_range,
            country: d.country, region: d.region, ranking: d.ranking,
            lat: d.lat, lng: d.lng, geojson: d.geojson
        }));
    }
    try {
        const res = await fetch('https://raw.githubusercontent.com/datasets/geo-boundaries-world-110m/master/countries.geojson');
        worldGeoJSON = await res.json();
        renderAll();
    } catch(e) { console.error("世界地圖載入失敗:", e); }
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
function formatDateCN(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getFullYear()}年${String(d.getMonth()+1).padStart(2,'0')}月${String(d.getDate()).padStart(2,'0')}日`;
}

// ==========================================
// 4. 地圖初始化
// ==========================================
const mapMain = L.map('map-main', { zoomControl: true }).setView([25, 0], 2);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { attribution:'&copy; OSM', minZoom:2, maxZoom:18 }).addTo(mapMain);
const countryLayerGroup = L.layerGroup().addTo(mapMain);
const regionLayerGroup = L.layerGroup();
let heatLayerGroup = null;

window.switchMode = function(mode) {
    currentMode = mode;
    ['country','region','heat'].forEach(m => document.getElementById(`btn-mode-${m}`).classList.remove('active'));
    document.getElementById(`btn-mode-${mode}`).classList.add('active');
    mapMain.removeLayer(countryLayerGroup); mapMain.removeLayer(regionLayerGroup);
    if (heatLayerGroup) mapMain.removeLayer(heatLayerGroup);
    if (mode === 'country') mapMain.addLayer(countryLayerGroup);
    else if (mode === 'region') mapMain.addLayer(regionLayerGroup);
    else if (mode === 'heat') {
        const heatPoints = locations.filter(l => l.lat && l.lng).map(l => {
            const days = calculateDays(l.dateStart, l.dateEnd);
            const rank = parseInt(l.ranking) || 10;
            return [l.lat, l.lng, days * (1/rank)];
        });
        heatLayerGroup = L.heatLayer(heatPoints, { radius:35, blur:20, max:15, maxZoom:6, gradient:{0.2:'blue',0.4:'cyan',0.6:'lime',0.8:'yellow',1.0:'red'} }).addTo(mapMain);
    }
};

// ==========================================
// 5. 地圖國家渲染
// ==========================================
function renderMapCountries() {
    if (!worldGeoJSON) return;
    countryLayerGroup.clearLayers();
    const countryDaysMap = {};
    locations.forEach(loc => {
        const cName = (loc.country||'').toLowerCase();
        countryDaysMap[cName] = (countryDaysMap[cName]||0) + calculateDays(loc.dateStart, loc.dateEnd);
    });
    const maxDays = Math.max(...Object.values(countryDaysMap), 1);
    let totalExploredAreaKm2 = 0;
    L.geoJSON(worldGeoJSON, {
        style: (feature) => {
            const countryName = (feature.properties?.name || feature.properties?.ADMIN || '').toLowerCase();
            const days = countryDaysMap[countryName] || 0;
            const isVisited = days > 0;
            if (isVisited) totalExploredAreaKm2 += getCountryArea(feature);
            let fillColor = varCSS('--country-default'), fillOpacity = 0.2;
            if (isVisited) {
                fillOpacity = 0.4 + (0.5 * (days/maxDays));
                fillColor = days > 14 ? '#166534' : (days > 5 ? '#22c55e' : '#4ade80');
            }
            return { fillColor, weight:1, color: varCSS('--country-border'), fillOpacity };
        }
    }).addTo(countryLayerGroup);
    document.getElementById('explore-percent').innerText = `${((totalExploredAreaKm2/EARTH_LAND_AREA_KM2)*100).toFixed(4)}%`;
    document.getElementById('explore-area').innerText = `${Math.round(totalExploredAreaKm2).toLocaleString()} km² / 1.48億 km²`;
}

function renderMapRegions() {
    regionLayerGroup.clearLayers();
    locations.forEach(loc => {
        const days = calculateDays(loc.dateStart, loc.dateEnd);
        const popupContent = `<strong>${getFlag(loc.country)} ${loc.region}</strong><br>${loc.country}<br>🏆 Vibe 排名: No.${loc.ranking}<br>⏱️ 停留: ${days} 天`;
        if (loc.geojson && (loc.geojson.type==='Polygon'||loc.geojson.type==='MultiPolygon')) {
            L.geoJSON(loc.geojson, { style:{ fillColor: varCSS('--cyan'), weight:2, color: varCSS('--cyan'), fillOpacity:0.4 } }).bindPopup(popupContent).addTo(regionLayerGroup);
        } else if (loc.lat && loc.lng) {
            L.circleMarker([loc.lat,loc.lng], { color: varCSS('--cyan'), fillColor: varCSS('--cyan'), fillOpacity:0.85, radius:7 }).bindPopup(popupContent).addTo(regionLayerGroup);
        }
    });
}

// ==========================================
// 6. Charts
// ==========================================
function renderChart(filteredLocs) {
    const barCanvas = document.getElementById('annualChart');
    const pieCanvas = document.getElementById('continentPieChart');
    if (!barCanvas || !pieCanvas) return;
    const yearCounts={}, yearDays={}, continentCounts={};
    filteredLocs.forEach(loc => {
        const days = calculateDays(loc.dateStart, loc.dateEnd);
        const y = extractYear(loc)||'未知';
        yearCounts[y] = (yearCounts[y]||0)+1; yearDays[y] = (yearDays[y]||0)+days;
        const cont = getContinent(loc.country); continentCounts[cont] = (continentCounts[cont]||0)+1;
    });
    const labels = Object.keys(yearCounts).filter(y=>y!=='未知').sort();
    const dataCounts = labels.map(y=>yearCounts[y]);
    const dataDays = labels.map(y=>yearDays[y]);
    const cumulativeCountries = labels.map(year => {
        const locsUp = locations.filter(l => { let ly=extractYear(l); return ly && ly<=year; });
        return new Set(locsUp.map(l=>(l.country||'').toLowerCase())).size;
    });
    if (window.chartBar) window.chartBar.destroy();
    window.chartBar = new Chart(barCanvas.getContext('2d'), {
        type:'bar',
        data:{ labels, datasets:[
            { type:'bar', label:'出征次數', data:dataCounts, backgroundColor:'rgba(56,189,248,0.7)', borderRadius:4, yAxisID:'y' },
            { type:'line', label:'停留天數', data:dataDays, borderColor:'#f5c842', backgroundColor:'#f5c842', borderWidth:2, pointRadius:4, yAxisID:'y1' },
            { type:'line', label:'累積國家數', data:cumulativeCountries, borderColor:'#a78bfa', backgroundColor:'#a78bfa', borderWidth:2, borderDash:[5,5], pointRadius:4, yAxisID:'y' }
        ]},
        options:{
            responsive:true, maintainAspectRatio:false,
            plugins:{ legend:{ labels:{ color:'#6b8aad', font:{ family:'Sora', size:11 } } } },
            scales:{
                y:{ type:'linear', position:'left', beginAtZero:true, ticks:{ color:'#6b8aad', stepSize:1, font:{family:'JetBrains Mono',size:10} }, grid:{ color:'rgba(56,189,248,0.06)' } },
                y1:{ type:'linear', position:'right', beginAtZero:true, ticks:{ color:'#6b8aad', font:{family:'JetBrains Mono',size:10} }, grid:{ display:false } },
                x:{ ticks:{ color:'#6b8aad', font:{family:'JetBrains Mono',size:10} }, grid:{ display:false } }
            }
        }
    });
    const contLabels = Object.keys(continentCounts).map(c=>({'Asia':'亞洲','Europe':'歐洲','Americas':'美洲','Oceania':'大洋洲','Africa':'非洲','Other':'其他'}[c]||c));
    if (window.chartPie) window.chartPie.destroy();
    window.chartPie = new Chart(pieCanvas.getContext('2d'), {
        type:'doughnut',
        data:{ labels:contLabels, datasets:[{ data:Object.values(continentCounts), backgroundColor:['#38bdf8','#34d399','#f5c842','#f87171','#a78bfa','#64748b'], borderWidth:0 }] },
        options:{ responsive:true, maintainAspectRatio:false, cutout:'65%', plugins:{ legend:{ position:'right', labels:{ color:'#6b8aad', font:{family:'Sora',size:11}, boxWidth:12 } } } }
    });
}

// ==========================================
// 7. UI 渲染
// ==========================================
function renderUI() {
    const list = document.getElementById('log-list');
    const summaryList = document.getElementById('country-summary-list');
    if (!list || !summaryList) return;
    list.innerHTML = ''; summaryList.innerHTML = '';

    const searchKeyword = (document.getElementById('search-log')?.value||'').toLowerCase();
    const filterYear = document.getElementById('filter-year')?.value||'all';
    const filterContinent = document.getElementById('filter-continent')?.value||'all';
    const sortBy = document.getElementById('sort-by')?.value||'date';

    const years = new Set(locations.map(l=>extractYear(l)).filter(y=>y!==null));
    const yearSelect = document.getElementById('filter-year');
    if (yearSelect) {
        const cur = yearSelect.value;
        yearSelect.innerHTML = '<option value="all">所有年份</option>';
        [...years].sort().reverse().forEach(year => {
            const o = document.createElement('option'); o.value=year; o.text=`${year} 年`; yearSelect.appendChild(o);
        });
        if (Array.from(yearSelect.options).some(o=>o.value===cur)) yearSelect.value=cur;
    }

    const filteredLocations = locations.filter(loc => {
        const c=(loc.country||'').toLowerCase(), r=(loc.region||'').toLowerCase();
        const locCont=getContinent(loc.country), locYear=extractYear(loc)||'none';
        return (c.includes(searchKeyword)||r.includes(searchKeyword)) && (filterYear==='all'||locYear===filterYear) && (filterContinent==='all'||locCont===filterContinent);
    });

    const countriesData={}, uniqueCities=new Set(); let totalDaysAll=0;
    filteredLocations.forEach(loc => {
        const days=calculateDays(loc.dateStart,loc.dateEnd);
        const cName=loc.country.toUpperCase(), rank=parseInt(loc.ranking)||10;
        if(!countriesData[cName]) countriesData[cName]={totalDays:0,visits:0,totalRank:0};
        countriesData[cName].totalDays+=days; countriesData[cName].visits+=1; countriesData[cName].totalRank+=rank;
        totalDaysAll+=days;
        uniqueCities.add(`${cName}_${loc.region.toLowerCase()}`);
    });

    Object.keys(countriesData).sort((a,b)=>countriesData[b].totalDays-countriesData[a].totalDays).forEach(c => {
        const stat=countriesData[c], avgRank=(stat.totalRank/stat.visits).toFixed(1);
        const cityCnt=Array.from(uniqueCities).filter(city=>city.startsWith(`${c}_`)).length;
        summaryList.innerHTML += `
            <div class="summary-card">
                <div class="summary-card-name">${getFlag(c)} ${c}</div>
                <div class="summary-card-meta">停留 ${stat.totalDays} 天 &nbsp;·&nbsp; 排名均值 ${avgRank} &nbsp;·&nbsp; ${cityCnt} 座城市</div>
            </div>`;
    });

    let hhi=0, entropy=0;
    Object.values(countriesData).forEach(c => {
        if(totalDaysAll>0){ const p=c.totalDays/totalDaysAll; hhi+=Math.pow(p,2); entropy-=p*Math.log2(p); }
    });
    const concentrationText = hhi>=0.25?"高度集中":(hhi>=0.15?"中度集中":"高度分散");
    document.getElementById('exposure-continent').innerText = hhi>0?hhi.toFixed(2):"0.00";
    document.getElementById('exposure-country').innerText = totalDaysAll>0?`${concentrationText} (H: ${entropy.toFixed(2)})`:"無資料";

    renderChart(filteredLocations);

    const sorted = [...filteredLocations].sort((a,b) => {
        if(sortBy==='rank') return parseInt(a.ranking||999)-parseInt(b.ranking||999);
        const ta=a.dateStart?new Date(a.dateStart).getTime():a.id;
        const tb=b.dateStart?new Date(b.dateStart).getTime():b.id;
        return tb-ta;
    });
    sorted.forEach(loc => {
        const days=calculateDays(loc.dateStart,loc.dateEnd);
        const li=document.createElement('li');
        li.className=`log-item ${editingId===loc.id?'editing':''}`;
        li.innerHTML=`
            <div class="log-item-info">
                <div class="log-item-top">
                    <span class="badge-country">${getFlag(loc.country)} ${loc.country}</span>
                    <span class="badge-region">${loc.region}</span>
                    <span class="badge-rank">No.${loc.ranking}</span>
                    <span class="badge-days">${days}天</span>
                </div>
                <div class="log-date">📅 ${loc.dateRange||'未紀錄'}</div>
            </div>
            <div class="action-group">
                <button class="action-btn edit-btn" onclick="editLocation(${loc.id})">編輯</button>
                <button class="action-btn delete-btn" onclick="deleteLocation(${loc.id})">刪除</button>
            </div>`;
        list.appendChild(li);
    });

    document.getElementById('count-country').innerText = Object.keys(countriesData).length;
    document.getElementById('count-region').innerText = uniqueCities.size;
}

['search-log','filter-year','filter-continent','sort-by'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', renderUI);
    document.getElementById(id)?.addEventListener('change', renderUI);
});

function renderAll() {
    renderUI(); renderMapCountries(); renderMapRegions();
    if(currentMode==='heat') switchMode('heat');
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
            const res=await fetch(`http://localhost:8000/api/search?q=${encodeURIComponent(val)}`);
            const data=await res.json(); autocompleteList.innerHTML='';
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

async function fetchRegionBoundary(region, country) {
    try {
        const url=`http://localhost:8000/api/boundary?region=${encodeURIComponent(region)}&country=${encodeURIComponent(country)}`;
        const res=await fetch(url); const data=await res.json();
        if(data&&data.length>0) return { lat:parseFloat(data[0].lat), lng:parseFloat(data[0].lon), geojson:data[0].geojson };
    } catch(e){ console.error(e); } return null;
}

document.getElementById('tracker-form')?.addEventListener('submit', async function(e) {
    e.preventDefault();
    const submitBtn=document.getElementById('submit-btn');
    submitBtn.innerText='🛰️ 衛星掃描中...'; submitBtn.disabled=true;
    const dStart=dateStartEl.value, dEnd=dateEndEl.value;
    const dateRangeStr=`${formatDateCN(dStart)} 到 ${formatDateCN(dEnd)}`;
    const geoData=await fetchRegionBoundary(regionInput.value.trim(), standardizeCountry(countryInput.value));
    if(!geoData){ alert(`⚠️ 找不到地理資料，請確認拼寫是否正確。`); submitBtn.innerText=editingId?'儲存變更 💾':'🚀 空降新領地'; submitBtn.disabled=false; return; }
    const newLog={
        id: editingId||(new Date(dStart).getTime()+Math.floor(Math.random()*1000)),
        date_start:dStart, date_end:dEnd, date_range:dateRangeStr,
        country:standardizeCountry(countryInput.value), region:regionInput.value.trim(),
        ranking:document.getElementById('input-ranking').value,
        lat:geoData.lat, lng:geoData.lng, geojson:geoData.geojson
    };
    const { error }=await supabaseClient.from('travel_logs').upsert([newLog]);
    if(error){ alert(`❌ 寫入失敗: ${error.message}`); }
    else {
        const locObj={...newLog, dateStart:dStart, dateEnd:dEnd, dateRange:dateRangeStr};
        if(editingId){ const idx=locations.findIndex(l=>l.id===editingId); if(idx!==-1) locations[idx]=locObj; cancelEdit(); }
        else { locations.push(locObj); submitBtn.innerText='🚀 空降新領地'; this.reset(); }
        renderAll(); mapMain.flyTo([geoData.lat,geoData.lng], currentMode==='country'?4:6);
    }
    submitBtn.disabled=false;
});

window.editLocation=function(id){
    const loc=locations.find(l=>l.id===id); if(!loc) return;
    countryInput.value=loc.country; regionInput.value=loc.region;
    dateStartEl.value=loc.dateStart||''; dateEndEl.value=loc.dateEnd||'';
    document.getElementById('input-ranking').value=loc.ranking||'';
    editingId=id;
    const sb=document.getElementById('submit-btn');
    sb.innerText='💾 儲存變更'; sb.style.background='linear-gradient(135deg,#f5c842,#d97706)';
    document.getElementById('cancel-edit-btn').style.display='block';
    renderUI(); document.getElementById('tracker-form').scrollIntoView({ behavior:'smooth' });
};
window.cancelEdit=function(){
    editingId=null; document.getElementById('tracker-form').reset();
    const sb=document.getElementById('submit-btn');
    sb.innerText='🚀 空降新領地'; sb.style.background='';
    document.getElementById('cancel-edit-btn').style.display='none';
    renderUI();
};
window.deleteLocation=async function(id){
    if(!confirm('確定要刪除這筆戰報嗎？')) return;
    const { error }=await supabaseClient.from('travel_logs').delete().eq('id',id);
    if(error){ alert(`❌ 刪除失敗: ${error.message}`); }
    else { locations=locations.filter(l=>l.id!==id); if(editingId===id) cancelEdit(); renderAll(); }
};

window.importData=function(event){
    const file=event.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=async function(e){
        try {
            const importedData=JSON.parse(e.target.result);
            if(Array.isArray(importedData)){
                const btn=document.querySelector('button[onclick="document.getElementById(\'import-file\').click()"]');
                const orig=btn.innerText; btn.innerText='☁️ 上傳中...'; btn.disabled=true;
                const payload=importedData.map(l=>({ id:l.id, date_start:l.dateStart||'', date_end:l.dateEnd||'', date_range:l.dateRange||'', country:l.country, region:l.region, ranking:l.ranking||l.rating||10, lat:l.lat, lng:l.lng, geojson:l.geojson }));
                const { error }=await supabaseClient.from('travel_logs').upsert(payload);
                if(error){ alert(`❌ 匯入失敗: ${error.message}`); }
                else { locations=importedData; renderAll(); alert(`✅ 成功匯入 ${importedData.length} 筆戰報！`); }
                btn.innerText=orig; btn.disabled=false;
            } else { alert("⚠️ JSON 格式有誤，必須是陣列格式。"); }
        } catch(err){ alert("⚠️ 檔案解析失敗"); }
    };
    reader.readAsText(file); event.target.value='';
};

window.exportData=function(type){
    if(locations.length===0) return alert("尚未佔領任何領地！");
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
};

window.playTimeline=async function(){
    const validLocs=[...locations].filter(l=>l.lat&&l.lng&&extractYear(l)).sort((a,b)=>{
        const ta=a.dateStart?new Date(a.dateStart).getTime():a.id;
        const tb=b.dateStart?new Date(b.dateStart).getTime():b.id;
        return ta-tb;
    });
    if(validLocs.length===0) return alert('無包含日期的戰報可推演！');
    switchMode('region'); regionLayerGroup.clearLayers();
    const btn=document.querySelector('button[onclick="playTimeline()"]');
    btn.innerText='推演中... ⏳'; btn.disabled=true;
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
         .bindPopup(`<strong>${getFlag(loc.country)} ${loc.region}</strong><br>📅 ${loc.dateRange||loc.dateStart}`)
         .addTo(regionLayerGroup).openPopup();
        await new Promise(r=>setTimeout(r,1000));
    }
    alert('✅ 戰略推演完畢！');
    btn.innerText='▶ 軌跡推演'; btn.disabled=false; renderMapRegions();
};

// ==========================================
// 🚀 真 AI 戰略預測引擎 (對接 FastAPI 後端)
// ==========================================
window.recommendNext = async function() {
    if (locations.length === 0) return alert('請先輸入戰報，AI 才能進行偏好分析！');

    const btn = document.querySelector('.btn-ai');
    const originalText = btn.innerHTML;
    
    // UI 狀態切換
    btn.innerHTML = '🧠 神經網絡演算中...';
    btn.disabled = true;
    btn.style.opacity = '0.7';

    // 1. 整理戰報數據，精簡傳給後端的 payload
    const payload = locations.map(l => ({
        country: l.country,
        region: l.region,
        ranking: parseInt(l.ranking) || 10,
        days: calculateDays(l.dateStart, l.dateEnd)
    }));

    try {
        // 2. 呼叫本地端的 Python FastAPI
        const response = await fetch('http://localhost:8000/api/recommend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ logs: payload })
        });

        if (!response.ok) {
            throw new Error(`伺服器代碼: ${response.status}`);
        }

        const aiResult = await response.json();

        // 3. 展示 AI 運算結果
        const msg = `🤖 [AI 戰略預測分析]

🔍 偏好解析：
${aiResult.analysis}

🎯 建議空降座標：
【 ${getFlagText(aiResult.recommend_country)} ${aiResult.recommend_country} - ${aiResult.recommend_city} 】

📝 戰略理由：
${aiResult.reason}`;

        alert(msg);

    } catch (error) {
        console.error('AI 請求失敗:', error);
        alert('⚠️ 無法連線至戰略中樞，請確認 Python 後端 (localhost:8000) 是否已啟動。');
    } finally {
        // 恢復 UI 狀態
        btn.innerHTML = originalText;
        btn.disabled = false;
        btn.style.opacity = '1';
    }
};

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

// 🚀 網頁載入後的第一個動作：從檢查權限開始！
document.addEventListener('DOMContentLoaded', checkAuth);
