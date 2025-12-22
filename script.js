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
let currentLocationMarker = null;
let isResizing = false;

// ★動的パラメータ計算用関数 (LINEヤフー技術提案: 探索効率化)
function getSearchParameters(minutes) {
    // 時間(分)に応じて検索半径(m)と候補数(件)を動的に調整
    // 30分=歩行距離約2km -> 半径は余裕を見て800m程度
    // 60分=歩行距離約4km -> 半径1500m程度
    let radius = Math.min(3000, Math.max(500, minutes * 25)); // 最小500m, 最大3km
    let maxCandidates = Math.min(50, Math.max(15, Math.floor(minutes / 1.5))); // 最小15件, 最大50件
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

    // マップクリックイベント
    map.on('click', function(e) {
        if (!gpsMode) {
            handleMapClick(e);
        }
    });

    async function handleMapClick(e) {
        try {
            if (window.routeLocked) {
                const ok = await showConfirmation('新しい探索を開始しますか？', '現在のAIプランは破棄されます。続行して新しい場所を指定しますか？');
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
    
    const newBtn = document.getElementById('btn-new-search');
    if (newBtn) {
        newBtn.addEventListener('click', async function() {
            const ok = await showConfirmation('新しい探索を開始しますか？', '現在のAIプランは破棄されます。続行しますか？');
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

    // ★改善: 所要時間を取得して探索範囲を動的に決定
    const duration = Number(document.getElementById('walk-duration').value) || 60;
    const params = getSearchParameters(duration);
    log(`⚙️ 動的設定: 半径${params.radius}m, 候補上限${params.maxCandidates}件 (時間${duration}分より)`);

    const promises = [];
    promises.push(fetchWeather(lat, lon));
    // Overpassにも半径を渡す形がベストだが、既存互換のためfetchOverpass内でradiusを使う形に修正
    promises.push(fetchOverpass(lat, lon, params.radius)); 
    if(idManhole) promises.push(fetchKureData(idManhole, "デザインマンホール"));
    if(idCulture) promises.push(fetchKureData(idCulture, "文化財・レトロ"));
    if(idShelter) promises.push(fetchKureData(idShelter, "避難所・高台"));

    await Promise.all(promises);

    log(`✅ 完了。${gatheredSpots.length} 件のスポット発見。`);
    document.getElementById('btn-search').disabled = false;
    document.getElementById('ai-response').innerHTML = `データ収集完了！<br>現在の天気: ${weatherDescription}<br>発見スポット: ${gatheredSpots.length}件<br>「AIにプランを聞く」を押してください。`;
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

// ★修正: 半径を引数で受け取るように変更
async function fetchOverpass(lat, lon, radius = 1600) {
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
            way["highway"="steps"](around:${Math.min(radius, 1000)},${lat},${lon});
            way["highway"="path"](around:${Math.min(radius, 1000)},${lat},${lon});
            node["amenity"="vending_machine"](around:${Math.min(radius, 1000)},${lat},${lon});
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
                    if (r2.ok && (txt2.trim().startsWith('{') || txt2.trim().startsWith('['))) { data = JSON.parse(txt2); ok = true; break; }
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
                if (dist < 0.02) { 
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

// ==========================================
// 2. AIプランニングフェーズ
// ==========================================
async function askAI() {
    const geminiKey = document.getElementById('gemini-key').value;
    const mood = document.getElementById('user-mood').value;
    const duration = Number(document.getElementById('walk-duration').value) || 60;
    window.requestedDuration = duration;
    window.userMood = mood;
    const destination = document.getElementById('final-dest').value || "AIにお任せ(最適な場所)";
    
    if(!geminiKey) { alert("Gemini APIキーを入力してください"); return; }
    if(gatheredSpots.length === 0) { alert("周辺にスポットがありません"); return; }

    document.getElementById('ai-result-details').open = true;
    document.getElementById('ai-response').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> AIがルートを計算中...';
    routeLayer.clearLayers();

    // ★改善: パラメータ取得と候補数制限
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
        // スタート地点からの距離も少し考慮（遠すぎるものを自然減点）
        const distFromStart = Math.sqrt(Math.pow(currentLat - spot.lat, 2) + Math.pow(currentLon - spot.lon, 2));
        score -= distFromStart * 1000; // 遠いほどスコア減

        return { ...spot, score: score + Math.random() * 20 };
    });

    scoredSpots.sort((a, b) => b.score - a.score);
    // ★改善: 探索時間短縮のため、動的に決定した maxCandidates でスライス
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
   - 必ず以下のJSON形式のみで出力してください。

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
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        
        const result = await res.json();
        if (result.error) throw new Error(result.error.message);
        let text = result.candidates[0].content.parts[0].text;
        text = text.replace(/^```json\s*/, "").replace(/\s*```$/, "");

        const routeData = JSON.parse(text);
        window.lastRouteData = routeData;

        renderRouteSidebar(routeData);
        window.routeLocked = true;
        try { showNewSearchButton(true); } catch(e) {}
        log("🗺️ ルートデータ受信。地図描画を開始します...");
        drawSmartRoute(routeData.route).catch(err => { console.error('drawSmartRoute error', err); });

    } catch(e) {
        console.error(e);
        document.getElementById('ai-response').innerHTML = `<div style="color:red; font-weight:bold;">ルート生成エラー</div><small>${e.message}</small>`;
    }
}

async function drawSmartRoute(routePoints) {
    if(!routePoints || routePoints.length === 0) return;

    const requested = (window.requestedDuration !== undefined) ? Number(window.requestedDuration) : null;
    const minAllowed = requested ? Math.max(0, requested - 15) : null;

    // ★LINEヤフー技術提案: グリーディ法によるルート並べ替え (TSP簡易版)
    // AIが出したスポットを、現在地から近い順に並べ替えることで無駄な往復を排除する
    function optimizeRouteOrder(start, points) {
        let current = start;
        let unvisited = points.slice(); // コピー
        let ordered = [];
        
        // 最初の1点はAIの意図（スタート直後に行きたい場所）を尊重する場合もあるが、
        // ここでは「整合性」重視ですべて並べ替えるアプローチを取る。
        // ただしゴールが決まっている場合は最後にするなどの処理が必要だが、
        // 簡易的に「一番近いところへ次々行く」戦略で整合性を取る。
        
        while (unvisited.length > 0) {
            let nearestIdx = -1;
            let minDist = Infinity;
            
            for (let i = 0; i < unvisited.length; i++) {
                const p = unvisited[i];
                const d = Math.pow(current.lat - p.lat, 2) + Math.pow(current.lon - p.lon, 2);
                if (d < minDist) {
                    minDist = d;
                    nearestIdx = i;
                }
            }
            
            if (nearestIdx !== -1) {
                const nextSpot = unvisited[nearestIdx];
                ordered.push(nextSpot);
                current = nextSpot;
                unvisited.splice(nearestIdx, 1);
            } else {
                break;
            }
        }
        return ordered;
    }

    // AIのルートを最適化（整合性確保）
    let optimizedPts = optimizeRouteOrder({lat: currentLat, lon: currentLon}, routePoints);
    
    // ゴール指定がある場合、最適化の最後がゴールになる保証はないため、
    // ここでは「AIが選んだスポットを効率よく回る」ことに主眼を置く。
    // ※厳密なゴール指定がある場合は、それを固定するロジックが必要だが、散歩アプリとしては効率的な巡回を優先。

    async function getOsrmForPoints(points) {
        const waypoints = [[currentLon, currentLat], ...points.map(p => [p.lon, p.lat])];
        const coordsString = waypoints.map(pt => pt.join(',')).join(';');
        const osrmUrl = `https://router.project-osrm.org/route/v1/walking/${coordsString}?overview=full&geometries=geojson&continue_straight=true`;
        const res = await fetch(osrmUrl);
        return await res.json();
    }

    // ★LINEヤフー技術提案: 時間超過時の厳格なカット (Strict Pruning)
    // 指定時間を大幅に超える場合、遠いスポットから削除する
    async function pruneRouteToMaxMinutes(pts, maxMinutes) {
        let currentPts = pts.slice();
        // 最大5回まで試行
        for(let i=0; i<5; i++) {
            const data = await getOsrmForPoints(currentPts);
            if (!data.routes || data.routes.length === 0) break;
            const dist = data.routes[0].distance;
            const mins = Math.round((dist / 1000) / 4.0 * 60);
            
            if (mins <= maxMinutes + 10) { // 許容誤差+10分
                return { pts: currentPts, data, walkMinutes: mins, distMeters: dist };
            }
            
            // 時間オーバー: 末尾（ゴール付近）を削るか、中間を削るか。
            // ここでは「最後のスポット」を削る（スタート地点に近いスポットを残すため）
            // ただしスポットが1つしかない場合は削らない
            if (currentPts.length <= 1) return { pts: currentPts, data, walkMinutes: mins, distMeters: dist };
            
            log(`⏱ ルート ${mins}分 は長すぎます(${maxMinutes}分指定)。スポット「${currentPts[currentPts.length-1].name}」を削除して調整します。`);
            currentPts.pop();
        }
        return { pts: currentPts, data: null, walkMinutes: 0, distMeters: 0 };
    }

    async function tryExpandRouteToMinMinutes(pts, minAllowed, requested) {
        // (既存の延伸ロジックはそのまま維持)
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

        let baseGeom = [];
        if (baseData && baseData.routes && baseData.routes.length > 0 && baseData.routes[0].geometry) {
            baseGeom = baseData.routes[0].geometry.coordinates.slice();
        }

        function overlapRatio(geomA, geomB) {
            if (!geomA || !geomB || geomA.length === 0 || geomB.length === 0) return 0;
            const round = (v) => Math.round(v * 10000) / 10000;
            const setA = new Set();
            for (let i = 0; i < geomA.length - 1; i++) {
                const a0 = geomA[i]; const a1 = geomA[i+1];
                setA.add(`${round(a0[1])},${round(a0[0])}|${round(a1[1])},${round(a1[0])}`);
                setA.add(`${round(a1[1])},${round(a1[0])}|${round(a0[1])},${round(a0[0])}`);
            }
            let common = 0; let total = 0;
            for (let i = 0; i < geomB.length - 1; i++) {
                const b0 = geomB[i]; const b1 = geomB[i+1];
                const key = `${round(b0[1])},${round(b0[0])}|${round(b1[1])},${round(b1[0])}`;
                total++;
                if (setA.has(key)) common++;
            }
            return total === 0 ? 0 : (common / total);
        }

        let ptsCopy = pts.slice();
        let localData = baseData; let localDist = baseDist; let localMinutes = baseMinutes;
        const MAX_ADDITIONS = 15; let additions = 0;
        while (neededMeters > 10 && additions < MAX_ADDITIONS) {
            const scored = [];
            for (const c of candidates) {
                const best = scoreCandidateForPositions(c, ptsCopy);
                let bias = 1;
                const mood = (window.userMood||'').toString();
                if ((mood.includes('川')||mood.includes('水')||mood.includes('海')) && (c.type||'').includes('水')) bias = 1.3;
                scored.push({ cand: c, pos: best.pos, addedMeters: best.addedMeters * bias });
            }
            scored.sort((a,b) => b.addedMeters - a.addedMeters);
            if (scored.length === 0 || scored[0].addedMeters <= 5) break;

            const TOP_SIM = Math.min(6, scored.length);
            for (let i = 0; i < TOP_SIM; i++) {
                const s = scored[i];
                const simPts = ptsCopy.slice();
                const newPt = { name: s.cand.name || '追加スポット', lat: s.cand.lat, lon: s.cand.lon, photo_tip: '' };
                simPts.splice(s.pos, 0, newPt);
                try {
                    const simData = await getOsrmForPoints(simPts);
                    if (simData && simData.routes && simData.routes.length > 0 && simData.routes[0].geometry) {
                        const simGeom = simData.routes[0].geometry.coordinates;
                        const ov = overlapRatio(baseGeom, simGeom);
                        if (ov > 0.6) { s.addedMeters = 0; s.skip = true; }
                        else if (ov > 0.2) { s.addedMeters *= (1 - ov * 0.9); }
                    }
                } catch(e) { }
            }

            scored.sort((a,b) => b.addedMeters - a.addedMeters);
            const pick = scored.find(s => !s.skip) || scored[0];

            const newPt = { name: pick.cand.name || '追加スポット', lat: pick.cand.lat, lon: pick.cand.lon, photo_tip: '' };
            ptsCopy.splice(pick.pos, 0, newPt);
            additions++;
            
            localData = await getOsrmForPoints(ptsCopy);
            if (localData && localData.routes && localData.routes.length > 0) {
                localDist = localData.routes[0].distance;
                localMinutes = Math.round((localDist / 1000) / 4.0 * 60);
            }
            neededMeters = Math.max(0, (minAllowed - localMinutes) * metersPerMin);
            candidates = candidates.filter(c => c.name !== pick.cand.name || Math.abs(c.lat - pick.cand.lat) > 1e-6);
        }
        return { pts: ptsCopy, data: localData, walkMinutes: localMinutes, distMeters: localDist };
    }

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

    try {
        let pts = optimizedPts; // グリーディ法で並べ替えたリストを使用
        
        // 川沿い希望があれば先に川の経由点を注入
        if (window.userMood && (window.userMood.includes('川') || window.userMood.includes('水') || window.userMood.includes('海'))) {
            try { pts = await injectRiverWaypointsIfRequested(pts, requested); } catch(e) { }
        }

        // 初期ルート計算
        let data = await getOsrmForPoints(pts);
        let distMeters = 0;
        let walkMinutes = 0;
        if (data.routes && data.routes.length > 0) {
            distMeters = data.routes[0].distance;
            walkMinutes = Math.round((distMeters / 1000) / 4.0 * 60);
        }

        // ★改善: 時間が長すぎる場合の Strict Pruning 実行
        if (requested && walkMinutes > requested + 10) {
            const pruned = await pruneRouteToMaxMinutes(pts, requested);
            pts = pruned.pts;
            data = pruned.data || data;
            walkMinutes = pruned.walkMinutes;
            distMeters = pruned.distMeters;
            log(`✅ 時間調整完了: ${walkMinutes}分 (最適化後)`);
        }

        // 時間が短すぎる場合の延伸 (既存ロジック)
        if (requested && minAllowed !== null && walkMinutes < minAllowed) {
            log(`⚠️ ルート ${walkMinutes}分 は短すぎます。自動延伸します...`);
            const expanded = await tryExpandRouteToMinMinutes(pts, minAllowed, requested);
            if (expanded && expanded.walkMinutes >= minAllowed) {
                pts = expanded.pts;
                data = expanded.data || data;
                walkMinutes = expanded.walkMinutes;
                distMeters = expanded.distMeters;
                log(`✅ 延伸成功: ${walkMinutes}分`);
            } else {
                log(`⚠️ 延伸しましたが目標に届きませんでした（${expanded.walkMinutes}分）`);
            }
        }

        // 描画処理 (以下、既存の描画ロジック)
        if (data.routes && data.routes.length > 0 && data.routes[0].geometry) {
            const route = data.routes[0];
            const coordinates = route.geometry.coordinates;
            const hotlineData = coordinates.map((c, index) => [c[1], c[0], index / (coordinates.length - 1)]);
            const coordsLatLon = coordinates.map(c => [c[1], c[0]]);

            function detectRepeatedSegments(latlonArr) {
                const seen = new Set();
                for (let i = 1; i < latlonArr.length; i++) {
                    const a = latlonArr[i-1]; const b = latlonArr[i];
                    const key = `${a[0].toFixed(5)},${a[1].toFixed(5)}|${b[0].toFixed(5)},${b[1].toFixed(5)}`;
                    if (seen.has(key)) return true;
                    const rev = `${b[0].toFixed(5)},${b[1].toFixed(5)}|${a[0].toFixed(5)},${a[1].toFixed(5)}`;
                    if (seen.has(rev)) return true;
                    seen.add(key);
                }
                return false;
            }

            function offsetCoordinates(latlonArr, offsetMeters) {
                if (!latlonArr || latlonArr.length < 2) return latlonArr;
                const out = [];
                const Rlat = 111320; 
                for (let i = 0; i < latlonArr.length; i++) {
                    const prev = latlonArr[Math.max(0, i-1)];
                    const next = latlonArr[Math.min(latlonArr.length-1, i+1)];
                    const lat = latlonArr[i][0];
                    const dx = (next[1] - prev[1]) * Math.cos(lat * Math.PI/180) * Rlat;
                    const dy = (next[0] - prev[0]) * Rlat;
                    let px = -dy; let py = dx;
                    const norm = Math.hypot(px, py) || 1;
                    px = px / norm; py = py / norm;
                    const dLat = (py * offsetMeters) / Rlat;
                    const dLon = (px * offsetMeters) / (Rlat * Math.cos(lat * Math.PI/180));
                    out.push([lat + dLat, latlonArr[i][1] + dLon]);
                }
                return out;
            }

            const hasRepeat = detectRepeatedSegments(coordsLatLon);
            let boundsObj;

            if (hasRepeat) {
                const left = offsetCoordinates(coordsLatLon, 3);
                const right = offsetCoordinates(coordsLatLon, -3);
                const leftHot = left.map((c, index) => [c[0], c[1], index / (left.length - 1)]);
                const rightHot = right.map((c, index) => [c[0], c[1], index / (right.length - 1)]);
                
                const leftHotline = L.hotline(leftHot, {
                    weight: 6, outlineWidth: 0,
                    palette: { 0.0: '#0000ff', 0.5: '#ff00ff', 1.0: '#ff0000' }
                }).addTo(routeLayer);
                
                const rightHotline = L.hotline(rightHot, {
                    weight: 6, outlineWidth: 0,
                    palette: { 0.0: '#0000ff', 0.5: '#ff00ff', 1.0: '#ff0000' }
                }).addTo(routeLayer);
                
                if (leftHotline.bringToFront) leftHotline.bringToFront();
                if (rightHotline.bringToFront) rightHotline.bringToFront();
                
                const centerLine = coordsLatLon.slice();
                const arrowLine = L.polyline(centerLine, { color: 'transparent', weight: 0 }).addTo(routeLayer);
                arrowLine.arrowheads({ size: '15px', frequency: '80px', fill: true, color: '#ff4500', offsets: { end: "10px" } });
                if (arrowLine.bringToFront) arrowLine.bringToFront();
                
                boundsObj = leftHotline;
            } else {
                const hotline = L.hotline(hotlineData, {
                    weight: 6, outlineWidth: 0,
                    palette: { 0.0: '#0000ff', 0.5: '#ff00ff', 1.0: '#ff0000' }
                }).addTo(routeLayer);
                if (hotline.bringToFront) hotline.bringToFront();

                const arrowLine = L.polyline(coordsLatLon, { color: 'transparent', weight: 0 }).addTo(routeLayer);
                arrowLine.arrowheads({ size: '15px', frequency: '80px', fill: true, color: '#ff4500', offsets: { end: "10px" } });
                if (arrowLine.bringToFront) arrowLine.bringToFront();
                
                boundsObj = hotline;
            }

            if(boundsObj) map.fitBounds(boundsObj.getBounds(), { padding: [50, 50], maxZoom: 17 });
            addRouteMarkers(pts);
            renderRouteSidebar({ ...window.lastRouteData, route: pts, distance: distMeters, walkMinutes: walkMinutes }); 
        } else {
            addRouteMarkers(pts);
            renderRouteSidebar({ ...window.lastRouteData, route: pts, distance: 0, walkMinutes: 0 });
        }

    } catch (e) {
        log("⚠️ 道案内取得失敗。直線で結びます。");
        console.error(e);
        addRouteMarkers(routePoints);
    }
}

function addRouteMarkers(routePoints) {
    routePoints.forEach((pt, index) => {
        const numIcon = L.divIcon({
            className: '',
            html: `<div style="background: #ff0000; color: white; border-radius: 50%; width: 24px; height: 24px; text-align: center; line-height: 24px; font-weight: bold; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">${index + 1}</div>`,
            iconSize: [28, 28], iconAnchor: [14, 28]
        });
        L.marker([pt.lat, pt.lon], { icon: numIcon, zIndexOffset: 1000 })
            .bindPopup(`<b>Step ${index+1}</b><br>${pt.name}`).addTo(routeLayer);
    });
}

function renderRouteSidebar(data) {
    const responseArea = document.getElementById('ai-response');
    const distStr = (data.distance !== undefined) ? (data.distance / 1000).toFixed(1) + " km" : "-- km";
    const timeStr = (data.walkMinutes !== undefined) ? data.walkMinutes + " 分" : "-- 分";

    let html = `<div class="route-theme">“ ${data.theme} ”</div>`;
    html += `<div class="route-meta"><i class="fa-solid fa-person-walking"></i> <span>${distStr}</span> &nbsp;/&nbsp; <i class="fa-solid fa-clock"></i> <span>${timeStr}</span></div>`;
    
    const steps = data.route || []; 
    steps.forEach((step, index) => {
        html += `<div class="route-step">
            <div class="step-name"><span style="color:#ff4500;">Step ${index + 1}:</span> ${step.name}</div>
            <div class="step-photo"><i class="fa-solid fa-camera"></i> ${step.photo_tip || ''}</div>
        </div>`;
    });
    html += `<small style="color:#666;">※青(スタート)から赤(ゴール)へ。<br>矢印の方向に進んでください。</small>`;
    responseArea.innerHTML = html;
    try { responseArea.scrollTop = responseArea.scrollHeight; } catch(e) {}
    adjustAiResponseHeight();
}