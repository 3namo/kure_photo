// ==========================================
// ★APIキー設定
// ==========================================
const WEATHER_API_KEY = "f5ced26dbed1c3f5d9ca115851dd4cce";
const KURE_API_KEY    = "a2620ef7-164e-467c-85c6-a51ca43f1fe5";
const GEMINI_MODEL_NAME = "gemini-2.5-flash";

// ==========================================
// グローバル変数
// ==========================================
let map;
let markersLayer = L.layerGroup();
let routeLayer = L.layerGroup();
let currentLat, currentLon;
let gatheredSpots = [];
let weatherDescription = "";
let forecastText = "";
let gpsMode = false;
let useAiMode = true; // AIモードフラグ
let currentLocationMarker = null;
let isResizing = false;

// ★動的パラメータ計算
function getSearchParameters(minutes) {
    let radius = Math.min(3000, Math.max(800, minutes * 25));
    let maxCandidates = Math.min(45, Math.max(15, Math.floor(minutes / 1.5)));
    return { radius, maxCandidates };
}

window.onload = function() {
    loadSettings();

    // マップ初期化
    map = L.map('map').setView([34.248, 132.565], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    markersLayer.addTo(map);
    routeLayer.addTo(map);

    // 初期状態設定
    document.getElementById('gps-mode-toggle').checked = false;
    gpsMode = false;
    updateLocationHint();

    // AIモード設定初期化
    const savedAiMode = localStorage.getItem('kureApp_useAiMode');
    if (savedAiMode !== null) {
        useAiMode = (savedAiMode === 'true');
        document.getElementById('ai-mode-toggle').checked = useAiMode;
    }
    updateAiModeUI();

    // マップクリックイベント
    map.on('click', function(e) {
        if (!gpsMode) {
            handleMapClick(e);
        }
    });

    // マップクリック時の処理
    async function handleMapClick(e) {
        try {
            if (window.routeLocked) {
                const ok = await showConfirmation('新しい探索を開始しますか？', '現在のプランは破棄されます。続行して新しい場所を指定しますか？');
                if (!ok) return;
                window.routeLocked = false;
                try { showNewSearchButton(false); } catch(e) {}
            }
            await startExploration(e.latlng.lat, e.latlng.lng);
        } catch (err) {
            console.error(err);
        }
    }

    const inputs = document.querySelectorAll('input');
    inputs.forEach(input => {
        input.addEventListener('input', saveSettings);
    });

    initResizer();
    adjustAiResponseHeight();
    window.addEventListener('resize', adjustAiResponseHeight);
    
    // 新しい探索ボタンの初期設定
    const newBtn = document.getElementById('btn-new-search');
    if (newBtn) {
        newBtn.addEventListener('click', async function() {
            const ok = await showConfirmation('新しい探索を開始しますか？', '現在のプランは破棄されます。続行しますか？');
            if (!ok) return;
            window.routeLocked = false;
            showNewSearchButton(false);
            try { routeLayer.clearLayers(); } catch(e) {}
            document.getElementById('ai-response').innerHTML = '既存のプランを破棄しました。地図をクリックして新しい現在地を指定してください。';
        });
    }
};

function showNewSearchButton(show) {
    const btn = document.getElementById('btn-new-search');
    if (!btn) return;
    btn.style.display = show ? 'block' : 'none';
}

function toggleAiMode() {
    useAiMode = document.getElementById('ai-mode-toggle').checked;
    localStorage.setItem('kureApp_useAiMode', useAiMode);
    updateAiModeUI();
}

function updateAiModeUI() {
    const statusEl = document.getElementById('ai-mode-status');
    const hintEl = document.getElementById('ai-mode-hint');
    const apiKeyGroup = document.getElementById('api-key-group');
    const label = document.getElementById('result-title-label');

    if (useAiMode) {
        statusEl.textContent = 'ON';
        statusEl.style.color = '#007bff';
        hintEl.textContent = 'Gemini AIが文脈を読んでプランを作成します';
        apiKeyGroup.style.display = 'block';
        if(label) label.textContent = "🤖 AIプラン結果";
    } else {
        statusEl.textContent = 'OFF (標準)';
        statusEl.style.color = '#555';
        hintEl.textContent = 'キーワードと距離に基づき高速にルートを作成します(APIキー不要)';
        apiKeyGroup.style.display = 'none';
        if(label) label.textContent = "🗺️ 標準プラン結果";
    }
}

function showConfirmation(title, message) {
    return new Promise((resolve) => {
        const overlay = document.getElementById('confirm-modal');
        const t = document.getElementById('confirm-modal-title');
        const m = document.getElementById('confirm-modal-message');
        const okBtn = document.getElementById('confirm-ok');
        const cancelBtn = document.getElementById('confirm-cancel');
        if (!overlay || !okBtn || !cancelBtn || !t || !m) { resolve(confirm(message)); return; }
        t.textContent = title || '確認';
        m.textContent = message || '';
        overlay.classList.add('show');
        overlay.setAttribute('aria-hidden', 'false');

        function cleanup() {
            overlay.classList.remove('show');
            overlay.setAttribute('aria-hidden', 'true');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
        }
        function onOk() { cleanup(); resolve(true); }
        function onCancel() { cleanup(); resolve(false); }
        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);

        function onKey(e) { if (e.key === 'Escape') { onCancel(); window.removeEventListener('keydown', onKey); } }
        window.addEventListener('keydown', onKey);
    });
}

function initResizer() {
    const resizer = document.getElementById('resizer');
    const sidebar = document.getElementById('sidebar');
    resizer.addEventListener('mousedown', function(e) {
        isResizing = true;
        document.body.style.cursor = 'col-resize';
    });
    document.addEventListener('mousemove', function(e) {
        if (!isResizing) return;
        const newWidth = Math.max(200, Math.min(800, e.clientX));
        sidebar.style.width = newWidth + 'px';
        map.invalidateSize();
    });
    document.addEventListener('mouseup', function(e) {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = 'default';
            adjustAiResponseHeight();
        }
    });
}

function adjustAiResponseHeight() {
    const sidebar = document.getElementById('sidebar');
    const aiDetails = document.getElementById('ai-result-details');
    const resp = document.querySelector('.ai-response-content');
    if (!sidebar || !aiDetails || !resp) return;
    let sum = 0;
    for (const ch of Array.from(sidebar.children)) {
        if (ch === aiDetails) break;
        sum += ch.offsetHeight || 0;
    }
    const avail = Math.max(120, sidebar.clientHeight - sum - 24);
    resp.style.maxHeight = avail + 'px';
}

function saveSettings() {
    const settings = {
        geminiKey: document.getElementById('gemini-key').value,
        mood: document.getElementById('user-mood').value,
        idManhole: document.getElementById('id-manhole').value,
        idCulture: document.getElementById('id-culture').value,
        idShelter: document.getElementById('id-shelter').value,
        walkDuration: document.getElementById('walk-duration').value,
        finalDest: document.getElementById('final-dest').value
    };
    localStorage.setItem('kureApp_settings', JSON.stringify(settings));
}

function loadSettings() {
    const saved = localStorage.getItem('kureApp_settings');
    if (saved) {
        const settings = JSON.parse(saved);
        if(settings.geminiKey) document.getElementById('gemini-key').value = settings.geminiKey;
        if(settings.mood) document.getElementById('user-mood').value = settings.mood;
        if(settings.idManhole) document.getElementById('id-manhole').value = settings.idManhole;
        if(settings.idCulture) document.getElementById('id-culture').value = settings.idCulture;
        if(settings.idShelter) document.getElementById('id-shelter').value = settings.idShelter;
        if(settings.walkDuration) document.getElementById('walk-duration').value = settings.walkDuration;
        if(settings.finalDest) document.getElementById('final-dest').value = settings.finalDest;
    }
}

function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('closed');
    setTimeout(() => map.invalidateSize(), 300);
}

function toggleLocationMode() {
    gpsMode = document.getElementById('gps-mode-toggle').checked;
    updateLocationHint();
    if (gpsMode) getCurrentLocation();
}

function updateLocationHint() {
    const hintEl = document.getElementById('location-hint');
    const statusEl = document.getElementById('mode-status');
    if (gpsMode) {
        statusEl.textContent = 'ON (GPS取得中)';
        hintEl.textContent = '※位置情報を使用して現在地を取得します';
    } else {
        statusEl.textContent = 'OFF (マップクリック)';
        hintEl.textContent = '※マップをクリックして現在地を指定してください';
    }
}

function getCurrentLocation() {
    log('📍 GPS位置情報を取得中...');
    if (!navigator.geolocation) {
        log('❌ ブラウザが位置情報取得に対応していません');
        return;
    }
    navigator.geolocation.getCurrentPosition(
        function(position) {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            log(`✅ GPS成功: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
            map.setView([lat, lon], 16);
            if (currentLocationMarker) markersLayer.removeLayer(currentLocationMarker);
            const icon = L.divIcon({
                className: '',
                html: `<div style="width:28px; height:28px; background:#007bff; border-radius:50%; border:3px solid white; box-shadow:0 0 10px rgba(0,123,255,0.5);"></div>`,
                iconSize: [28, 28], iconAnchor: [14, 14]
            });
            currentLocationMarker = L.marker([lat, lon], {icon: icon})
                .bindPopup("現在地（GPS）").addTo(markersLayer).openPopup();
        },
        function(error) {
            log(`❌ GPSエラー: ${error.message}`);
            gpsMode = false;
            document.getElementById('gps-mode-toggle').checked = false;
            updateLocationHint();
        }
    );
}

function toggleDatasetInput() {
    const container = document.getElementById('dataset-container');
    const arrow = document.getElementById('dataset-arrow');
    if(container.style.display === 'none') {
        container.style.display = 'block';
        arrow.className = 'fa-solid fa-chevron-up';
    } else {
        container.style.display = 'none';
        arrow.className = 'fa-solid fa-chevron-down';
    }
}

setInterval(() => {
    const now = new Date();
    const clockEl = document.getElementById('clock');
    if(clockEl) clockEl.innerText = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}, 1000);

function log(msg) {
    const el = document.getElementById('log-area');
    if(el) {
        el.innerHTML += `<div>${msg}</div>`;
        el.scrollTop = el.scrollHeight;
    }
}

// ==========================================
// 1. データ探索フェーズ
// ==========================================
async function startExploration(lat, lon) {
    currentLat = lat; currentLon = lon;
    gatheredSpots = [];
    if (!gpsMode) markersLayer.clearLayers();
    routeLayer.clearLayers();
    
    if (!gpsMode) L.marker([lat, lon]).addTo(markersLayer).bindPopup("現在地").openPopup();
    
    document.getElementById('btn-search').disabled = true;
    document.getElementById('ai-response').innerHTML = "データ収集中...";
    document.getElementById('ai-result-details').open = false; 
    document.getElementById('log-area').innerHTML = ""; 
    log(`📍 探索開始: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);

    const idManhole = document.getElementById('id-manhole').value;
    const idCulture = document.getElementById('id-culture').value;
    const idShelter = document.getElementById('id-shelter').value;

    const duration = Number(document.getElementById('walk-duration').value) || 60;
    const params = getSearchParameters(duration);
    log(`⚙️ 設定: 所要${duration}分 -> 検索半径${params.radius}m`);

    const promises = [];
    promises.push(fetchWeather(lat, lon));
    promises.push(fetchOverpass(lat, lon, params.radius));
    
    if(idManhole) promises.push(fetchKureData(idManhole, "デザインマンホール"));
    if(idCulture) promises.push(fetchKureData(idCulture, "文化財・レトロ"));
    if(idShelter) promises.push(fetchKureData(idShelter, "避難所・高台"));

    await Promise.all(promises);

    log(`✅ 完了。${gatheredSpots.length} 件のスポット発見。`);
    document.getElementById('btn-search').disabled = false;
    document.getElementById('ai-response').innerHTML = `データ収集完了！<br>現在の天気: ${weatherDescription}<br>発見スポット: ${gatheredSpots.length}件<br>「プランを作成」を押してください。`;
}

async function fetchWeather(lat, lon) {
    if (WEATHER_API_KEY.includes("貼り付け")) { log("⚠️ Weatherキー未設定"); return; }
    try {
        const currentUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}&lang=ja&units=metric`;
        const resCurrent = await fetch(currentUrl);
        const currentData = await resCurrent.json();
        
        const curDesc = currentData.weather[0].description;
        const curTemp = Math.round(currentData.main.temp);
        const curIcon = `https://openweathermap.org/img/wn/${currentData.weather[0].icon}@2x.png`;
        
        document.getElementById('weather-icon').src = curIcon;
        document.getElementById('weather-temp').innerText = `${curTemp}℃`;
        document.getElementById('weather-desc').innerText = curDesc;
        weatherDescription = `${curDesc} (気温:${curTemp}℃)`;
        log(`🌤 現在: ${weatherDescription}`);

        const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}&lang=ja&units=metric`;
        const resForecast = await fetch(forecastUrl);
        const forecastData = await resForecast.json();

        const container = document.getElementById('forecast-container');
        container.innerHTML = ""; 
        forecastText = ""; 

        const list = forecastData.list.slice(0, 5); 
        list.forEach(item => {
            const date = new Date(item.dt * 1000);
            const time = date.getHours() + ":00";
            const temp = Math.round(item.main.temp);
            const icon = `https://openweathermap.org/img/wn/${item.weather[0].icon}.png`;

            const div = document.createElement('div');
            div.className = "forecast-item";
            div.innerHTML = `<div class="forecast-time">${time}</div><img class="forecast-icon" src="${icon}"><div class="forecast-temp">${temp}℃</div>`;
            container.appendChild(div);
            forecastText += `${time}は${item.weather[0].description}(${temp}℃), `;
        });
        log(`🔮 予報取得: ${list.length}件`);
    } catch(e) {
        log(`❌ 天気エラー: ${e.message}`);
        weatherDescription = "取得失敗";
    }
}

async function fetchOverpass(lat, lon, radius) {
    log(`🌍 OSMデータ検索中(半径${radius}m)...`);
    const query = `
        [out:json][timeout:30];
        (
            node["amenity"="place_of_worship"](around:${radius},${lat},${lon});
            way["amenity"="place_of_worship"](around:${radius},${lat},${lon});
            node["religion"="buddhist"](around:${radius},${lat},${lon});
            way["religion"="buddhist"](around:${radius},${lat},${lon});
            node["man_made"="torii"](around:${radius},${lat},${lon});
            way["man_made"="torii"](around:${radius},${lat},${lon});
            node["tourism"="viewpoint"](around:${radius},${lat},${lon});
            node["historic"](around:${radius},${lat},${lon});
            node["waterway"~"waterfall|stream|river|canal"](around:${radius},${lat},${lon});
            way["waterway"~"river|stream|canal|riverbank"](around:${radius},${lat},${lon});
            relation["waterway"~"river|stream|canal"](around:${radius},${lat},${lon});
            way["natural"="coastline"](around:${radius},${lat},${lon});
            
            way["highway"="steps"](around:${Math.min(1000, radius)},${lat},${lon});
            way["highway"="path"](around:${Math.min(1000, radius)},${lat},${lon});
            node["amenity"="vending_machine"](around:${Math.min(1000, radius)},${lat},${lon});
            
            node["natural"="water"](around:${radius},${lat},${lon});
            way["natural"="water"](around:${radius},${lat},${lon});
        );
        out center;
    `;
    const url = "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query);
    try {
        const res = await fetch(url);
        const raw = await res.text();
        let data;
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        
        if (contentType.includes('application/json') || raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
            data = JSON.parse(raw);
        } else {
            const altServers = [
                'https://lz4.overpass-api.de/api/interpreter?data=',
                'https://overpass.openstreetmap.fr/api/interpreter?data=',
                'https://overpass.kumi.systems/api/interpreter?data='
            ];
            let ok = false;
            for (const s of altServers) {
                try {
                    const r2 = await fetch(s + encodeURIComponent(query));
                    const txt2 = await r2.text();
                    if (r2.ok && (txt2.trim().startsWith('{') || txt2.trim().startsWith('['))) {
                        data = JSON.parse(txt2);
                        ok = true; break;
                    }
                } catch(e) { }
            }
            if (!ok) throw new Error('Overpass: JSON応答取得失敗');
        }
        
        data.elements.forEach(el => {
            const tags = el.tags || {};
            const elLat = el.lat || (el.center && el.center.lat);
            const elLon = el.lon || (el.center && el.center.lon);
            if (!elLat || !elLon) return;

            let type = "その他", bg = "bg-other", icon = "fa-map-pin";

            if (tags.religion === "buddhist") { type = "寺院"; bg = "bg-temple"; icon = null; } 
            else if (tags.religion === "shinto" || tags.man_made === "torii" || tags.man_made === "tori") { type = "神社"; bg = "bg-shrine"; icon = "fa-torii-gate"; }
            else if (tags.tourism === "viewpoint") { type = "絶景"; bg = "bg-view"; icon = "fa-camera"; }
            else if (tags.historic) { type = "史跡"; bg = "bg-retro"; icon = "fa-landmark"; }
            else if (tags.waterway || tags.natural === "coastline" || tags.natural === "water") { type = "水辺・川・海"; bg = "bg-water"; icon = "fa-water"; }
            else if (tags.highway === "steps") { type = "階段"; bg = "bg-steps"; icon = "fa-person-hiking"; }
            else if (tags.highway === "path") { type = "路地"; bg = "bg-path"; icon = "fa-person-walking"; }
            else if (tags.amenity === "vending_machine") { type = "自販機"; bg = "bg-vending"; icon = "fa-bottle-water"; }

            let name = tags.name || tags.alt_name || "";
            if (name && /二河川/.test(name)) return;
            if (!name && !(tags.highway === "steps" || tags.amenity === "vending_machine")) {
                if (type === "水辺・川・海") name = tags.waterway || tags.natural || '無名の水辺';
                else return;
            }

            addSpotToMap(elLat, elLon, type, name || type, "OSM", bg, icon, el.id);
        });
        log(`🌍 OSM: ${data.elements.length}件`);
    } catch(e) { log(`❌ OSMエラー: ${e.message}`); }
}

async function fetchKureData(endpointId, label) {
    if (KURE_API_KEY.includes("貼り付け")) return;
    log(`⚓️ 呉データ(${label})取得中...`);
    const url = `https://api.expolis.cloud/opendata/t/kure/v1/${endpointId}`;
    try {
        const defaultHeaders = { "ecp-api-token": KURE_API_KEY, "Accept": "application/json" };
        let res = await fetch(url, { headers: defaultHeaders });
        if (res.status === 401) {
            const urlWithToken = url + `?ecp-api-token=${encodeURIComponent(KURE_API_KEY)}`;
            res = await fetch(urlWithToken, { headers: { "Accept": "application/json" } });
        }
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        let count = 0;
        const items = Array.isArray(data) ? data : (data.data || data.items || []);
        
        function extractLatLon(it) {
            if (!it) return [null, null];
            const candidates = [
                [it.latitude, it.longitude], [it.lat, it.lon], [it.lat, it.lng], [it.lat, it.long],
                [it.latitude__ , it.longitude__], [it.latitude_wgs84, it.longitude_wgs84]
            ];
            for (const [a,b] of candidates) {
                if (a != null && b != null) return [Number(a), Number(b)];
            }
            const loc = it.location || it.location_data || it.position || it.pos || it.locationObject;
            if (loc) {
                const nested = [
                    [loc.latitude, loc.longitude], [loc.lat, loc.lon], [loc.lat, loc.lng],
                    [loc.latitude_wgs84, loc.longitude_wgs84]
                ];
                for (const [a,b] of nested) {
                    if (a != null && b != null) return [Number(a), Number(b)];
                }
            }
            if (it.geometry && it.geometry.coordinates) {
                const c = it.geometry.coordinates;
                return [Number(c[1]), Number(c[0])];
            }
            return [null, null];
        }

        let chosenBg = "bg-kure";
        let chosenIcon = "fa-star";
        const lbl = (label || endpointId || "").toString().toLowerCase();
        if (lbl.includes('manhole') || lbl.includes('マンホール')) { chosenBg = 'bg-manhole'; chosenIcon = 'fa-circle-dot'; }
        else if (lbl.includes('shelter') || lbl.includes('避難所')) { chosenBg = 'bg-infra'; chosenIcon = 'fa-house'; }
        else if (lbl.includes('culture') || lbl.includes('レトロ')) { chosenBg = 'bg-retro'; chosenIcon = 'fa-landmark'; }

        items.forEach(item => {
            const [iLat, iLon] = extractLatLon(item);
            const iName = item.name || item.title || "名称不明";
            if (iLat && iLon) {
                const dist = Math.sqrt(Math.pow(currentLat - iLat, 2) + Math.pow(currentLon - iLon, 2));
                if (dist < 0.04) { 
                    addSpotToMap(iLat, iLon, label, iName, "KureOfficial", chosenBg, chosenIcon);
                    count++;
                }
            }
        });
        log(`⚓️ ${label}: ${count}件`);
    } catch(e) { log(`❌ 呉APIエラー: ${e.message}`); }
}

function addSpotToMap(lat, lon, type, name, source, bgClass, iconClass="fa-map-pin", osmId=null) {
    if(gatheredSpots.some(s => s.name === name && Math.abs(s.lat - lat) < 0.0001)) return;
    gatheredSpots.push({ lat, lon, type, name, source, osmId });
    let html = '';
    if (bgClass === 'bg-temple') html = `<div class="custom-icon ${bgClass}" style="width:24px; height:24px; font-size:18px; line-height:22px;">卍</div>`;
    else if (iconClass) html = `<div class="custom-icon ${bgClass}" style="width:24px; height:24px;"><i class="fa-solid ${iconClass}"></i></div>`;
    else html = `<div class="custom-icon ${bgClass}" style="width:24px; height:24px;"></div>`;
    
    const icon = L.divIcon({ className: '', html: html, iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12] });
    L.marker([lat, lon], {icon: icon}).bindPopup(`<b>${name}</b><br>${type}<br><small>${source}</small>`).addTo(markersLayer);
}

// ★メインの分岐関数
async function planRoute() {
    if (gatheredSpots.length === 0) { alert("周辺にスポットがありません"); return; }
    if (useAiMode) {
        await generateRouteWithGemini();
    } else {
        await generateRouteStandard();
    }
}

// ==========================================
// ★標準モード (AIなし) - アルゴリズムによる生成
// ==========================================
async function generateRouteStandard() {
    const mood = document.getElementById('user-mood').value;
    const duration = Number(document.getElementById('walk-duration').value) || 60;
    
    document.getElementById('ai-result-details').open = true;
    document.getElementById('ai-response').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 標準アルゴリズムで計算中...';
    routeLayer.clearLayers();

    window.requestedDuration = duration;
    window.userMood = mood;

    // 1. スコアリング
    const scoredSpots = gatheredSpots.map(spot => {
        let score = 0;
        if (mood.includes("神社") && spot.type === "神社") score += 500;
        if ((mood.includes("寺") || mood.includes("仏閣")) && spot.type === "寺院") score += 500;
        if ((mood.includes("海") || mood.includes("川")) && spot.type.includes("水")) score += 300;
        if (mood.includes("レトロ") && (spot.type.includes("歴史") || spot.type === "マンホール" || spot.source === "KureOfficial")) score += 300;
        
        const dist = Math.sqrt(Math.pow(currentLat - spot.lat, 2) + Math.pow(currentLon - spot.lon, 2));
        if (dist > 0.002 && dist < 0.015) score += 50; 

        return { ...spot, score: score + Math.random() * 50 };
    });

    // 2. 上位選定
    scoredSpots.sort((a, b) => b.score - a.score);
    const count = Math.max(3, Math.floor(duration / 12));
    const candidates = scoredSpots.slice(0, count * 2);

    // 3. ルート構築 (Greedy法)
    let route = [];
    let current = { lat: currentLat, lon: currentLon };
    let unvisited = candidates.slice();

    for(let i=0; i<count; i++) {
        let nearestIdx = -1;
        let minDist = Infinity;
        for(let j=0; j<unvisited.length; j++) {
            const p = unvisited[j];
            const d = Math.pow(current.lat - p.lat, 2) + Math.pow(current.lon - p.lon, 2);
            if(d < minDist) { minDist = d; nearestIdx = j; }
        }
        if(nearestIdx !== -1) {
            const pick = unvisited[nearestIdx];
            route.push({ 
                name: pick.name, lat: pick.lat, lon: pick.lon, 
                photo_tip: `[標準] ${pick.type}スポットです` 
            });
            current = pick;
            unvisited.splice(nearestIdx, 1);
        } else break;
    }

    // ★改善: 標準モードでも時間調整を実行
    const pruned = await pruneRouteToMaxMinutes(route, duration);
    const finalRoute = pruned.pts;
    const warningMsg = (route.length !== finalRoute.length) ? "※時間内に収めるため、一部のスポットを省略しました" : "";

    const routeData = {
        theme: `【標準】${mood || 'おまかせ'}探索コース`,
        route: finalRoute,
        warning: warningMsg
    };
    
    window.lastRouteData = routeData;
    renderRouteSidebar(routeData);
    window.routeLocked = true;
    try { showNewSearchButton(true); } catch(e) {}
    
    log("🗺️ 標準ルート計算完了。地図描画を開始します...");
    // 描画
    if (pruned.data && pruned.data.routes) {
        drawRouteFromData(finalRoute, pruned.data, pruned.distMeters, pruned.walkMinutes);
    } else {
        drawSmartRoute(finalRoute).catch(err => console.error(err));
    }
}

// ==========================================
// ★AIモード (Gemini)
// ==========================================
async function generateRouteWithGemini() {
    const geminiKey = document.getElementById('gemini-key').value;
    const mood = document.getElementById('user-mood').value;
    const duration = Number(document.getElementById('walk-duration').value) || 60;
    const destination = document.getElementById('final-dest').value || "AIにお任せ(最適な場所)";
    
    if(!geminiKey) { alert("Gemini APIキーを入力してください"); return; }

    document.getElementById('ai-result-details').open = true;
    document.getElementById('ai-response').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> AIがルートを計算中...';
    routeLayer.clearLayers();

    const params = getSearchParameters(duration);

    const scoredSpots = gatheredSpots.map(spot => {
        let score = 0;
        if (mood.includes("神社") && spot.type === "神社") score += 300;
        else if (mood.includes("神社") && spot.type === "寺院") score -= 100;
        if ((mood.includes("寺") || mood.includes("仏閣")) && spot.type === "寺院") score += 300;
        if ((mood.includes("海") || mood.includes("川") || mood.includes("水")) && spot.type.includes("水")) score += 200;
        if (mood.includes("レトロ") && (spot.type.includes("歴史") || spot.type === "マンホール")) score += 100;
        if (spot.type && spot.type.includes("避難所")) {
            if (mood.includes("避難") || mood.includes("避難所")) score += 50; else score -= 200;
        }
        if (spot.type && (spot.type.includes("絶景") || spot.type.includes("高台"))) {
            if (mood.includes("景") || mood.includes("view")) score += 150; else score += 30;
        }
        const distFromStart = Math.sqrt(Math.pow(currentLat - spot.lat, 2) + Math.pow(currentLon - spot.lon, 2));
        score -= distFromStart * 1000; 

        return { ...spot, score: score + Math.random() * 20 };
    });

    scoredSpots.sort((a, b) => b.score - a.score);
    const spotsListJson = scoredSpots.slice(0, params.maxCandidates).map(s => ({ name: s.name, type: s.type, lat: s.lat, lon: s.lon }));

    const prompt = `
あなたは呉市のベテラン観光ガイドです。
ユーザーの要望: 「${mood}」
目標所要時間: ${duration}分
ゴール地点: "${destination}"
現在の天気: ${weatherDescription}

【重要指令】
1. **文脈とつなぎ:**
   - 「Aの後にB」といった要望があれば順序を守りつつ、移動区間に候補リストの魅力的なスポット（路地、商店、公園など）を経由地として組み込んでください。
2. **時間調整:**
   - 短すぎるルートはNGですが、長すぎるルートもNGです。${duration}分前後を目指してスポット数を選んでください。
   - 往復は避け、なるべく一筆書きや周回ルートにしてください。
3. **出力形式:**
   - 必ず以下のJSON形式のみで出力してください。挨拶文などは不要です。

【スポット候補リスト】
${JSON.stringify(spotsListJson)}

【出力JSON】
{
    "theme": "ルートのタイトル",
    "route": [
        { "name": "スポット名", "lat": 緯度, "lon": 経度, "photo_tip": "撮影アドバイス" }
    ]
}
`;
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent?key=${geminiKey}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { response_mime_type: "application/json" }
            })
        });
        
        const result = await res.json();
        if (result.error) throw new Error(result.error.message);
        let text = result.candidates[0].content.parts[0].text;
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) { text = jsonMatch[0]; }
        
        const routeData = JSON.parse(text);
        
        // ★改善: AIのルートを最適化して時間調整
        let pts = optimizeRouteOrder({lat: currentLat, lon: currentLon}, routeData.route);
        if (window.userMood && (window.userMood.includes('川') || window.userMood.includes('水') || window.userMood.includes('海'))) {
            try { pts = await injectRiverWaypointsIfRequested(pts, duration); } catch(e) { }
        }
        
        const pruned = await pruneRouteToMaxMinutes(pts, duration);
        const finalRoute = pruned.pts;
        const warningMsg = (pts.length !== finalRoute.length) ? "※時間内に収めるため、一部のスポットを省略しました" : "";
        
        routeData.route = finalRoute;
        routeData.warning = warningMsg;
        window.lastRouteData = routeData;

        renderRouteSidebar(routeData);
        window.routeLocked = true;
        try { showNewSearchButton(true); } catch(e) {}
        
        log("🗺️ ルートデータ受信。地図描画を開始します...");
        if (pruned.data && pruned.data.routes) {
            drawRouteFromData(finalRoute, pruned.data, pruned.distMeters, pruned.walkMinutes);
        } else {
            drawSmartRoute(finalRoute).catch(err => console.error('drawSmartRoute error', err));
        }

    } catch(e) {
        console.error(e);
        document.getElementById('ai-response').innerHTML = `<div style="color:red; font-weight:bold;">ルート生成エラー</div><small>${e.message}</small>`;
    }
}

// 共通ロジック群
async function getOsrmForPoints(points) {
    const waypoints = [[currentLon, currentLat], ...points.map(p => [p.lon, p.lat])];
    const coordsString = waypoints.map(pt => pt.join(',')).join(';');
    const osrmUrl = `https://router.project-osrm.org/route/v1/walking/${coordsString}?overview=full&geometries=geojson&continue_straight=true`;
    const res = await fetch(osrmUrl);
    return await res.json();
}

function optimizeRouteOrder(start, points) {
    let current = start;
    let unvisited = points.slice();
    let ordered = [];
    while (unvisited.length > 0) {
        let nearestIdx = -1;
        let minDist = Infinity;
        for (let i = 0; i < unvisited.length; i++) {
            const p = unvisited[i];
            const d = Math.pow(current.lat - p.lat, 2) + Math.pow(current.lon - p.lon, 2);
            if (d < minDist) { minDist = d; nearestIdx = i; }
        }
        if (nearestIdx !== -1) {
            const nextSpot = unvisited[nearestIdx];
            ordered.push(nextSpot);
            current = nextSpot;
            unvisited.splice(nearestIdx, 1);
        } else { break; }
    }
    return ordered;
}

// ★改善: 指定時間を超える場合、末尾からスポットを削除して再計算する
async function pruneRouteToMaxMinutes(pts, maxMinutes) {
    let currentPts = pts.slice();
    // 試行回数
    for(let i=0; i<8; i++) {
        const data = await getOsrmForPoints(currentPts);
        if (!data.routes || data.routes.length === 0) break;
        const dist = data.routes[0].distance;
        const mins = Math.round((dist / 1000) / 4.0 * 60);
        
        if (mins <= maxMinutes + 10) {
            return { pts: currentPts, data, walkMinutes: mins, distMeters: dist };
        }
        
        if (currentPts.length <= 1) return { pts: currentPts, data, walkMinutes: mins, distMeters: dist };
        
        log(`⏱ ルート ${mins}分 は長すぎます(目標${maxMinutes}分)。調整のためスポット「${currentPts[currentPts.length-1].name}」を削除します。`);
        currentPts.pop(); 
    }
    return { pts: currentPts, data: null, walkMinutes: 0, distMeters: 0 };
}

// 共通描画関数 (既にデータがある場合用)
function drawRouteFromData(routePoints, osrmData, distMeters, walkMinutes) {
    if (osrmData && osrmData.routes && osrmData.routes.length > 0 && osrmData.routes[0].geometry) {
        const coordinates = osrmData.routes[0].geometry.coordinates;
        const hotlineData = coordinates.map((c, index) => [c[1], c[0], index / (coordinates.length - 1)]);
        const coordsLatLon = coordinates.map(c => [c[1], c[0]]);
        
        const hotline = L.hotline(hotlineData, {
            weight: 6, outlineWidth: 0, palette: { 0.0: '#0000ff', 0.5: '#ff00ff', 1.0: '#ff0000' }
        }).addTo(routeLayer);
        const arrowLine = L.polyline(coordsLatLon, { color: 'transparent', weight: 0 }).addTo(routeLayer);
        arrowLine.arrowheads({ size: '15px', frequency: '80px', fill: true, color: '#ff4500', offsets: { end: "10px" } });
        
        map.fitBounds(hotline.getBounds(), { padding: [50, 50], maxZoom: 17 });
        addRouteMarkers(routePoints);
        
        // ★未達成メッセージがあれば表示に反映
        const baseData = window.lastRouteData || {};
        renderRouteSidebar({ ...baseData, route: routePoints, distance: distMeters, walkMinutes: walkMinutes, warning: baseData.warning });
    }
}

// 既存の描画ロジック（延伸処理など含む）
async function drawSmartRoute(routePoints) {
    if(!routePoints || routePoints.length === 0) return;
    const requested = (window.requestedDuration !== undefined) ? Number(window.requestedDuration) : null;
    const minAllowed = requested ? Math.max(0, requested - 15) : null;

    let pts = routePoints.slice();
    let data = await getOsrmForPoints(pts);
    let distMeters = 0, walkMinutes = 0;
    if (data.routes && data.routes.length > 0) {
        distMeters = data.routes[0].distance;
        walkMinutes = Math.round((distMeters / 1000) / 4.0 * 60);
    }
    
    // 短すぎる場合の延伸
    if (requested && minAllowed !== null && walkMinutes < minAllowed) {
        const expanded = await tryExpandRouteToMinMinutes(pts, minAllowed, requested);
        if (expanded && expanded.walkMinutes >= minAllowed) {
            pts = expanded.pts;
            data = expanded.data || data;
            walkMinutes = expanded.walkMinutes;
            distMeters = expanded.distMeters;
            log(`✅ 延伸成功: ${walkMinutes}分`);
        }
    }
    drawRouteFromData(pts, data, distMeters, walkMinutes);
}

// ----------------------------------------------------
// 以前のヘルパー関数（省略なし）
// ----------------------------------------------------

async function fetchOverpassGeometry(osmId, osmType="way") {
    try {
        const q = `[out:json][timeout:25]; ${osmType}(${osmId}); out geom;`;
        const servers = [
            'https://overpass-api.de/api/interpreter?data=',
            'https://lz4.overpass-api.de/api/interpreter?data=',
            'https://overpass.openstreetmap.fr/api/interpreter?data='
        ];
        let txt = null; let data = null;
        for (const s of servers) {
            try {
                const r = await fetch(s + encodeURIComponent(q));
                txt = await r.text();
                if (r.ok && (txt.trim().startsWith('{') || txt.trim().startsWith('['))) { data = JSON.parse(txt); break; }
            } catch(e) { }
        }
        if (!data || !data.elements || data.elements.length === 0) return null;
        const el = data.elements[0];
        const coords = (el.geometry || []).map(p => [p.lat, p.lon]);
        return coords;
    } catch(e) { return null; }
}

function samplePointsOnLine(latlonArr, n) {
    if (!latlonArr || latlonArr.length === 0) return [];
    if (n <= 0) return [];
    const dists = [0];
    for (let i = 1; i < latlonArr.length; i++) {
        const a = latlonArr[i-1]; const b = latlonArr[i];
        const m = Math.hypot((a[0]-b[0]), (a[1]-b[1]));
        dists.push(dists[dists.length-1] + m);
    }
    const total = dists[dists.length-1];
    if (total === 0) return [latlonArr[0]];
    const out = [];
    for (let k = 0; k < n; k++) {
        const target = (k/(n-1)) * total;
        let idx = 0; while (idx < dists.length-1 && dists[idx+1] < target) idx++;
        const a = latlonArr[idx]; const b = latlonArr[Math.min(idx+1, latlonArr.length-1)];
        const tSeg = (target - dists[idx]) / Math.max(1e-9, (dists[idx+1] - dists[idx] || 1e-9));
        const lat = a[0] + (b[0]-a[0]) * tSeg;
        const lon = a[1] + (b[1]-a[1]) * tSeg;
        out.push([lat, lon]);
    }
    return out;
}

// 以前のロジックを復元 (injectRiverWaypointsIfRequested)
async function injectRiverWaypointsIfRequested(pts, requested) {
    const mood = (window.userMood || '').toString();
    if (!(mood.includes('川') || mood.includes('水') || mood.includes('海'))) return pts;
    const waters = gatheredSpots.filter(s => (s.type||'').includes('水') && s.osmId);
    if (!waters || waters.length === 0) return pts;
    const start = { lat: currentLat, lon: currentLon };
    waters.sort((a,b) => {
        const da = Math.hypot(start.lat - a.lat, start.lon - a.lon);
        const db = Math.hypot(start.lat - b.lat, start.lon - b.lon);
        return da - db;
    });
    const chosen = waters[0];
    const geom = await fetchOverpassGeometry(chosen.osmId, 'way');
    if (!geom || geom.length < 2) return pts;
    const approxCount = Math.min(8, Math.max(3, Math.round(requested / 15)));
    const samples = samplePointsOnLine(geom, approxCount);
    const newPts = pts.slice();
    const wp = samples.map((s,i) => ({ name: `${chosen.name||'水辺'} (${i+1})`, lat: s[0], lon: s[1], photo_tip: '' }));
    newPts.splice(1, 0, ...wp);
    return newPts;
}

// 以前のロジックを復元 (tryExpandRouteToMinMinutes)
async function tryExpandRouteToMinMinutes(pts, minAllowed, requested) {
    const used = new Set(pts.map(p => (p.name || (p.lat + ',' + p.lon))));
    let candidates = gatheredSpots.filter(s => !used.has(s.name));
    if (!candidates || candidates.length === 0) return { pts, data: null, walkMinutes: 0, distMeters: 0 };

    function approxMeters(aLat, aLon, bLat, bLon) {
        const R = 6371000; const toRad = Math.PI / 180;
        const dLat = (bLat - aLat) * toRad; const dLon = (bLon - aLon) * toRad;
        const lat1 = aLat * toRad; const lat2 = bLat * toRad;
        const sinDLat = Math.sin(dLat/2); const sinDLon = Math.sin(dLon/2);
        const A = sinDLat*sinDLat + Math.cos(lat1)*Math.cos(lat2)*sinDLon*sinDLon;
        const C = 2 * Math.atan2(Math.sqrt(A), Math.sqrt(1-A));
        return R * C;
    }

    let baseData = await getOsrmForPoints(pts);
    let baseDist = 0; let baseMinutes = 0;
    if (baseData && baseData.routes && baseData.routes.length > 0) {
        baseDist = baseData.routes[0].distance;
        baseMinutes = Math.round((baseDist / 1000) / 4.0 * 60);
    }
    const metersPerMin = 4000 / 60;
    let neededMeters = Math.max(0, (minAllowed - baseMinutes) * metersPerMin);
    if (neededMeters <= 0) return { pts, data: baseData, walkMinutes: baseMinutes, distMeters: baseDist };

    function scoreCandidateForPositions(cand, ptsArr) {
        const scores = [];
        for (let i = 1; i < ptsArr.length; i++) {
            const a = ptsArr[i-1]; const b = ptsArr[i];
            const before = approxMeters(a.lat, a.lon, b.lat, b.lon);
            const via = approxMeters(a.lat, a.lon, cand.lat, cand.lon) + approxMeters(cand.lat, cand.lon, b.lat, b.lon);
            scores.push({ pos: i, addedMeters: via - before });
        }
        scores.sort((x,y) => y.addedMeters - x.addedMeters);
        return scores[0] || { pos: 1, addedMeters: 0 };
    }

    let ptsCopy = pts.slice();
    let localData = baseData; let localDist = baseDist; let localMinutes = baseMinutes;
    const MAX_ADDITIONS = 10; let additions = 0;
    while (neededMeters > 10 && additions < MAX_ADDITIONS) {
        const scored = [];
        for (const c of candidates) {
            const best = scoreCandidateForPositions(c, ptsCopy);
            scored.push({ cand: c, pos: best.pos, addedMeters: best.addedMeters });
        }
        scored.sort((a,b) => b.addedMeters - a.addedMeters);
        if (scored.length === 0 || scored[0].addedMeters <= 5) break;

        const pick = scored[0];
        const newPt = { name: pick.cand.name, lat: pick.cand.lat, lon: pick.cand.lon, photo_tip: '' };
        ptsCopy.splice(pick.pos, 0, newPt);
        additions++;
        
        localData = await getOsrmForPoints(ptsCopy);
        if (localData && localData.routes) {
            localDist = localData.routes[0].distance;
            localMinutes = Math.round((localDist / 1000) / 4.0 * 60);
        }
        neededMeters = Math.max(0, (minAllowed - localMinutes) * metersPerMin);
        candidates = candidates.filter(c => c.name !== pick.cand.name);
    }
    return { pts: ptsCopy, data: localData, walkMinutes: localMinutes, distMeters: localDist };
}