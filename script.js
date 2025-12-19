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

    // マップクリックイベント（GPS OFFの時のみ有効）
    map.on('click', async function(e) {
        if (!gpsMode) {
            await startExploration(e.latlng.lat, e.latlng.lng);
        }
    });

    const inputs = document.querySelectorAll('input');
    inputs.forEach(input => {
        input.addEventListener('input', saveSettings);
    });

    // リサイザーの初期化
    initResizer();
};

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
        }
    });
}

// 設定の保存・読み込み
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

// 時計
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
    
    // 現在地マーカー
    if (!gpsMode) L.marker([lat, lon]).addTo(markersLayer).bindPopup("現在地").openPopup();
    
    document.getElementById('btn-search').disabled = true;
    document.getElementById('ai-response').innerHTML = "データ収集中...";
    document.getElementById('ai-result-details').open = false; // 一旦閉じる
    document.getElementById('log-area').innerHTML = ""; 
    log(`📍 探索開始: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);

    const idManhole = document.getElementById('id-manhole').value;
    const idCulture = document.getElementById('id-culture').value;
    const idShelter = document.getElementById('id-shelter').value;

    const promises = [];
    promises.push(fetchWeather(lat, lon));
    promises.push(fetchOverpass(lat, lon)); // ★修正版のOverpass呼び出し
    if(idManhole) promises.push(fetchKureData(idManhole, "デザインマンホール"));
    if(idCulture) promises.push(fetchKureData(idCulture, "文化財・レトロ"));
    if(idShelter) promises.push(fetchKureData(idShelter, "避難所・高台"));

    await Promise.all(promises);

    log(`✅ 完了。${gatheredSpots.length} 件のスポット発見。`);
    document.getElementById('btn-search').disabled = false;
    document.getElementById('ai-response').innerHTML = `データ収集完了！<br>現在の天気: ${weatherDescription}<br>発見スポット: ${gatheredSpots.length}件<br>「AIにプランを聞く」を押してください。`;
}

// 天気取得（貴方のオリジナルコードのロジック）
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

// ★修正版: Overpass API (神社/寺/川を厳格に区別)
async function fetchOverpass(lat, lon) {
    log("🌍 OSMデータ検索中(区別強化版)...");
        const query = `
                [out:json][timeout:30];
                (
                    // 神社・寺院などの礼拝施設
                    node["amenity"="place_of_worship"](around:1600,${lat},${lon});
                    way["amenity"="place_of_worship"](around:1600,${lat},${lon});
                    node["religion"="buddhist"](around:1600,${lat},${lon});
                    way["religion"="buddhist"](around:1600,${lat},${lon});

                    // 鳥居や神社に関連する要素
                    node["man_made"="torii"](around:1600,${lat},${lon});
                    way["man_made"="torii"](around:1600,${lat},${lon});

                    // ビューポイント・史跡・滝・河川・海岸
                    node["tourism"="viewpoint"](around:1600,${lat},${lon});
                    node["historic"](around:1600,${lat},${lon});
                    node["waterway"~"waterfall"](around:1600,${lat},${lon});
                    relation["waterway"="river"](around:1600,${lat},${lon});
                    way["natural"="coastline"](around:1600,${lat},${lon});

                    // 階段・小道・自販機などのインフラ
                    way["highway"="steps"](around:1000,${lat},${lon});
                    way["highway"="path"](around:1000,${lat},${lon});
                    node["amenity"="vending_machine"](around:1000,${lat},${lon});

                    // その他、表示したいタグがあれば追加
                );
                out center;
        `;
    const url = "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query);
    try {
        const res = await fetch(url);
        const data = await res.json();
        data.elements.forEach(el => {
            const tags = el.tags || {};
            const elLat = el.lat || (el.center && el.center.lat);
            const elLon = el.lon || (el.center && el.center.lon);
            if (!elLat || !elLon) return;

            let type = "その他", bg = "bg-other", icon = "fa-map-pin";

            // ジャンル分けロジック（優先順位を明確に）
            if (tags.religion === "buddhist") {
                type = "寺院"; bg = "bg-temple"; icon = null; // 卍で表示
            } else if (tags.religion === "shinto" || tags.man_made === "torii" || tags.man_made === "tori") {
                type = "神社"; bg = "bg-shrine"; icon = "fa-torii-gate";
            } else if (tags.tourism === "viewpoint") {
                type = "絶景"; bg = "bg-view"; icon = "fa-camera";
            } else if (tags.historic) {
                type = "史跡"; bg = "bg-retro"; icon = "fa-landmark";
            } else if (tags.waterway || tags.natural === "coastline") {
                type = "水辺・川・海"; bg = "bg-water"; icon = "fa-water";
            } else if (tags.highway === "steps") {
                type = "階段"; bg = "bg-steps"; icon = "fa-person-hiking";
            } else if (tags.highway === "path") {
                type = "路地"; bg = "bg-path"; icon = "fa-person-walking";
            } else if (tags.amenity === "vending_machine") {
                type = "自販機"; bg = "bg-vending"; icon = "fa-bottle-water";
            }

            // 名前がないものは重要度が低いのでスキップ（階段・自販機などは例外）
            const name = tags.name || tags.alt_name || "";
            if (!name && tags.highway !== "steps" && tags.amenity !== "vending_machine") return;

            addSpotToMap(elLat, elLon, type, name || type, "OSM", bg, icon);
        });
        log(`🌍 OSM: ${data.elements.length}件`);
    } catch(e) { log(`❌ OSMエラー: ${e.message}`); }
}

async function fetchKureData(endpointId, label) {
    if (KURE_API_KEY.includes("貼り付け")) return;
    log(`⚓️ 呉データ(${label})取得中...`);
    const url = `https://api.expolis.cloud/opendata/t/kure/v1/${endpointId}`;
    try {
        // データプラットフォームくれ のアクセストークンは `ecp-api-token` ヘッダーを使用
        const defaultHeaders = { "ecp-api-token": KURE_API_KEY, "Accept": "application/json" };
        let res = await fetch(url, { headers: defaultHeaders });
        // 401 の場合はクエリパラメータ方式で再試行（環境によってはヘッダーが通らないことがあるため）
        if (res.status === 401) {
            log(`❗ 呉API: 401 Unauthorized（ヘッダー試行）。クエリパラメータで再試行します...`);
            const urlWithToken = url + `?ecp-api-token=${encodeURIComponent(KURE_API_KEY)}`;
            res = await fetch(urlWithToken, { headers: { "Accept": "application/json" } });
        }
        if (!res.ok) {
            const txt = await res.text().catch(() => "(no body)");
            throw new Error(`HTTP ${res.status} - ${res.statusText} | ${txt}`);
        }
        const data = await res.json();
        let count = 0;
        // レスポンスは配列の場合とオブジェクト（data/items）を含む場合がある
        const items = Array.isArray(data) ? data : (data.data || data.items || []);
        function extractLatLon(it) {
            if (!it) return [null, null];
            // top-level
            const candidates = [
                [it.latitude, it.longitude],
                [it.lat, it.lon],
                [it.lat, it.lng],
                [it.lat, it.long],
                [it.latitude__ , it.longitude__],
                [it.latitude_wgs84, it.longitude_wgs84]
            ];
            for (const [a,b] of candidates) {
                if (a !== undefined && b !== undefined && a !== null && b !== null) return [Number(a), Number(b)];
            }
            // nested location objects
            const loc = it.location || it.location_data || it.position || it.pos || it.locationObject;
            if (loc) {
                const nested = [
                    [loc.latitude, loc.longitude],
                    [loc.lat, loc.lon],
                    [loc.lat, loc.lng],
                    [loc.latitude_wgs84, loc.longitude_wgs84]
                ];
                for (const [a,b] of nested) {
                    if (a !== undefined && b !== undefined && a !== null && b !== null) return [Number(a), Number(b)];
                }
            }
            // some APIs use 'geometry' or 'point'
            if (it.geometry && it.geometry.coordinates) {
                // GeoJSON [lon, lat]
                const c = it.geometry.coordinates;
                return [Number(c[1]), Number(c[0])];
            }
            if (it.point && it.point.coordinates) {
                const c = it.point.coordinates; // [lon, lat]
                return [Number(c[1]), Number(c[0])];
            }
            return [null, null];
        }

        items.forEach(item => {
            const [iLat, iLon] = extractLatLon(item);
            const iName = item.name || item.title || item.location_name || item.location || item.place || "名称不明";
            if (iLat && iLon) {
                const dist = Math.sqrt(Math.pow(currentLat - iLat, 2) + Math.pow(currentLon - iLon, 2));
                if (dist < 0.02) { // 近場のみ
                    addSpotToMap(iLat, iLon, label, iName, "KureOfficial", "bg-kure", "fa-star");
                    count++;
                }
            }
        });
        // デバッグ: ヒット数が0の場合、サンプルをログ表示
        if (count === 0 && items && items.length > 0) {
            const sample = items.slice(0,3).map(it => {
                try { return JSON.stringify(it, Object.keys(it).slice(0,10)); } catch(e) { return '(no preview)'; }
            }).join('\n---\n');
            log(`🔍 呉API取得は成功しましたが、近傍の緯度経度が検出できませんでした。サンプル項目:
${sample}`);
        }
        log(`⚓️ ${label}: ${count}件`);
    } catch(e) { log(`❌ 呉APIエラー: ${e.message}`); }
}

function addSpotToMap(lat, lon, type, name, source, bgClass, iconClass="fa-map-pin") {
    // 重複チェック
    if(gatheredSpots.some(s => s.name === name && Math.abs(s.lat - lat) < 0.0001)) return;

    gatheredSpots.push({ lat, lon, type, name, source });
    // 寺院は卍で表示したい（視認性のため、アイコンは文字で表示）
    let html = '';
    if (bgClass === 'bg-temple') {
        html = `<div class="custom-icon ${bgClass}" style="width:24px; height:24px; font-size:18px; line-height:22px;">卍</div>`;
    } else if (iconClass) {
        html = `<div class="custom-icon ${bgClass}" style="width:24px; height:24px;"><i class="fa-solid ${iconClass}"></i></div>`;
    } else {
        html = `<div class="custom-icon ${bgClass}" style="width:24px; height:24px;"></div>`;
    }

    const icon = L.divIcon({
        className: '',
        html: html,
        iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12]
    });
    L.marker([lat, lon], {icon: icon})
        .bindPopup(`<b>${name}</b><br>${type}<br><small>${source}</small>`)
        .addTo(markersLayer);
}

// ==========================================
// 2. AIプランニングフェーズ (★スマート検索追加)
// ==========================================
async function askAI() {
    const geminiKey = document.getElementById('gemini-key').value;
    const mood = document.getElementById('user-mood').value;
    const duration = Number(document.getElementById('walk-duration').value) || 60;
    // drawSmartRoute で参照するためグローバルに格納
    window.requestedDuration = duration;
    const destination = document.getElementById('final-dest').value || "AIにお任せ(最適な場所)";
    
    if(!geminiKey) { alert("Gemini APIキーを入力してください"); return; }
    if(gatheredSpots.length === 0) { alert("周辺にスポットがありません"); return; }

    document.getElementById('ai-result-details').open = true;
    document.getElementById('ai-response').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> AIがルートを計算中...';
    routeLayer.clearLayers();

    // ★スマート検索: ユーザーのキーワードに合うスポットのスコアを上げる
    const scoredSpots = gatheredSpots.map(spot => {
        let score = 0;
        // 1. 神社 vs 寺
        if (mood.includes("神社") && spot.type === "神社") score += 300;
        else if (mood.includes("神社") && spot.type === "寺院") score -= 100; // ペナルティ
        
        if ((mood.includes("寺") || mood.includes("仏閣")) && spot.type === "寺院") score += 300;

        // 2. 川・海・水辺
        if ((mood.includes("海") || mood.includes("川") || mood.includes("水")) && spot.type.includes("水")) score += 200;

        // 3. レトロ
        if (mood.includes("レトロ") && (spot.type.includes("歴史") || spot.type === "マンホール" || spot.type.includes("文化"))) score += 100;

        return { ...spot, score: score + Math.random() * 10 }; // ランダム性も加味
    });

    // スコア上位40件をAIに渡す
    scoredSpots.sort((a, b) => b.score - a.score);
    const spotsListJson = scoredSpots.slice(0, 40).map(s => ({ name: s.name, type: s.type, lat: s.lat, lon: s.lon }));

    const prompt = `
あなたは呉市のフォトスポットガイドです。
ユーザーの要望「${mood}」に基づき、最も適した散歩ルートを1つ作成してください。

【厳守条件】
- 現在地からスタートすること。
- 所要時間: ${duration}分。
- ゴール: "${destination}"。
- 天気: ${weatherDescription}。
- ユーザーの要望にあるキーワードを最優先してください。「神社」という要望なら、種別が「神社」のスポットを必ず含め、「寺院」で代用しないこと。「川」や「海」なら「水辺」スポットを含めること。
- JSON形式のみで回答。

【スポット候補 (優先度順)】
${JSON.stringify(spotsListJson)}

【出力JSON】
{
  "theme": "ルートのキャッチコピー",
  "route": [
    { "name": "スポット名", "lat": 数値, "lon": 数値, "photo_tip": "撮影アドバイス" }
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

        log("🗺️ ルートデータ受信。詳細ルート描画中...");
        await drawSmartRoute(routeData.route);

    } catch(e) {
        console.error(e);
        document.getElementById('ai-response').innerHTML = `<div style="color:red; font-weight:bold;">ルート生成エラー</div><small>${e.message}</small>`;
    }
}

// 貴方のオリジナルの詳細なルート描画機能（Hotline & Arrowheads）
async function drawSmartRoute(routePoints) {
    if(!routePoints || routePoints.length === 0) return;

    // ルートの長さを取得して、ユーザー指定の所要時間レンジに収まるように
    // 必要なら末尾のスポットを順に削る（短くする）試行を行う
    const requested = (window.requestedDuration !== undefined) ? Number(window.requestedDuration) : null;
    const minAllowed = requested ? Math.max(0, requested - 10) : null;

    async function getOsrmForPoints(points) {
        const waypoints = [[currentLon, currentLat], ...points.map(p => [p.lon, p.lat])];
        const coordsString = waypoints.map(pt => pt.join(',')).join(';');
        const osrmUrl = `https://router.project-osrm.org/route/v1/walking/${coordsString}?overview=full&geometries=geojson`;
        const res = await fetch(osrmUrl);
        return await res.json();
    }

    try {
        let pts = routePoints.slice();
        let data = await getOsrmForPoints(pts);
        let distMeters = 0;
        let walkMinutes = 0;

        if (data.routes && data.routes.length > 0) {
            distMeters = data.routes[0].distance;
            walkMinutes = Math.round((distMeters / 1000) / 4.0 * 60);
        }

        // 希望時間が指定されている場合、上限を越えるなら末尾を順に削って調整
        if (requested && walkMinutes > requested) {
            log(`⏱ ルート ${walkMinutes}分 は希望 ${requested}分 を超えています。短縮を試行します...`);
            // 最低でもスタート→1スポットは残す
            while (pts.length > 1) {
                pts.pop();
                data = await getOsrmForPoints(pts);
                if (data.routes && data.routes.length > 0) {
                    distMeters = data.routes[0].distance;
                    walkMinutes = Math.round((distMeters / 1000) / 4.0 * 60);
                } else {
                    walkMinutes = 0; distMeters = 0;
                }
                if (walkMinutes <= requested) break;
            }

            if (walkMinutes > requested) {
                log(`⚠️ 短縮により ${walkMinutes}分 のままでした。さらに調整できませんでした。`);
            } else {
                log(`✅ 短縮成功: ${walkMinutes}分 に収まりました。`);
                routePoints = pts; // 描画対象を更新
            }
        }

        // 描画（OSRMデータがある場合はジオメトリを使う）
        if (data.routes && data.routes.length > 0 && data.routes[0].geometry) {
            const route = data.routes[0];
            const coordinates = route.geometry.coordinates;
            const hotlineData = coordinates.map((c, index) => [c[1], c[0], index / (coordinates.length - 1)]);
            const hotline = L.hotline(hotlineData, {
                weight: 6, outlineWidth: 1, outlineColor: 'white',
                palette: { 0.0: '#0000ff', 0.5: '#ff00ff', 1.0: '#ff0000' }
            }).addTo(routeLayer);

            const arrowLine = L.polyline(coordinates.map(c => [c[1], c[0]]), { color: 'transparent', weight: 0 }).addTo(routeLayer);
            arrowLine.arrowheads({ size: '15px', frequency: '80px', fill: true, color: '#ff4500', offsets: { end: "10px" } });

            map.fitBounds(hotline.getBounds(), { padding: [50, 50], maxZoom: 17 });
            addRouteMarkers(routePoints);
            renderRouteSidebar({ ...window.lastRouteData, distance: distMeters, walkMinutes: walkMinutes });
        } else {
            addRouteMarkers(routePoints);
            renderRouteSidebar({ ...window.lastRouteData, distance: 0, walkMinutes: 0 });
        }
        // 範囲下限より短すぎる場合は注意表示
        if (requested && minAllowed !== null && walkMinutes < minAllowed) {
            log(`⚠️ ルート所要時間 ${walkMinutes}分 は希望下限 ${minAllowed}分 より短いです。追加スポットを検討してください。`);
        }
    } catch (e) {
        log("⚠️ 道案内取得失敗。直線で結びます。");
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
    
    data.route.forEach((step, index) => {
        html += `<div class="route-step">
            <div class="step-name"><span style="color:#ff4500;">Step ${index + 1}:</span> ${step.name}</div>
            <div class="step-photo"><i class="fa-solid fa-camera"></i> ${step.photo_tip}</div>
        </div>`;
    });
    html += `<small style="color:#666;">※青(スタート)から赤(ゴール)へ。<br>矢印の方向に進んでください。</small>`;
    responseArea.innerHTML = html;
}