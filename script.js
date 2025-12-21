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
    // レイアウト調整: AI結果領域の高さを調整
    adjustAiResponseHeight();
    window.addEventListener('resize', adjustAiResponseHeight);
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
            // リサイズ完了後にAIレスポンス高さを再計算
            adjustAiResponseHeight();
        }
    });
}

// サイドバー内の AI レスポンス領域の高さを残り領域に合わせる
function adjustAiResponseHeight() {
    const sidebar = document.getElementById('sidebar');
    const aiDetails = document.getElementById('ai-result-details');
    const resp = document.querySelector('.ai-response-content');
    if (!sidebar || !aiDetails || !resp) return;
    // 合計高さを算出: aiDetailsより前にある子要素の高さを引く
    let sum = 0;
    for (const ch of Array.from(sidebar.children)) {
        if (ch === aiDetails) break;
        sum += ch.offsetHeight || 0;
    }
    // 少しマージンを残す
    const avail = Math.max(120, sidebar.clientHeight - sum - 24);
    resp.style.maxHeight = avail + 'px';
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
                    node["waterway"~"waterfall|stream|river|canal"](around:1600,${lat},${lon});
                    way["waterway"~"river|stream|canal|riverbank"](around:1600,${lat},${lon});
                    relation["waterway"~"river|stream|canal"](around:1600,${lat},${lon});
                    way["natural"="coastline"](around:1600,${lat},${lon});

                    // 階段・小道・自販機などのインフラ
                    way["highway"="steps"](around:1000,${lat},${lon});
                    way["highway"="path"](around:1000,${lat},${lon});
                    node["amenity"="vending_machine"](around:1000,${lat},${lon});

                    // 小規模な水域やnatural=waterも取得
                    node["natural"="water"](around:1600,${lat},${lon});
                    way["natural"="water"](around:1600,${lat},${lon});

                    // その他、表示したいタグがあれば追加
                );
                out center;
        `;
    const url = "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query);
    try {
        const res = await fetch(url);
        const raw = await res.text();
        let data;
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        // JSONでない（例: HTMLのエラーページ）が返る場合があるためガード
        if (!res.ok) {
            // まずは本文をログに含める
            throw new Error(`${res.status} ${res.statusText}: ${raw.slice(0,200)}`);
        }
        if (contentType.includes('application/json') || raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
            data = JSON.parse(raw);
        } else {
            // フォールバックサーバーを順に試す
            log('❗ OSM: OverpassがHTMLを返しました。フォールバックを試行します...');
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
                    } else {
                        log(`❗ Overpass fallback ${s} 状態=${r2.status}`);
                    }
                } catch(e) {
                    log(`❌ Overpass fallback ${s} エラー: ${e.message}`);
                }
            }
            if (!ok) throw new Error('Overpass: JSON応答取得失敗（フォールバック含む）');
        }
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
            } else if (tags.waterway || tags.natural === "coastline" || tags.natural === "water") {
                type = "水辺・川・海"; bg = "bg-water"; icon = "fa-water";
            } else if (tags.highway === "steps") {
                type = "階段"; bg = "bg-steps"; icon = "fa-person-hiking";
            } else if (tags.highway === "path") {
                type = "路地"; bg = "bg-path"; icon = "fa-person-walking";
            } else if (tags.amenity === "vending_machine") {
                type = "自販機"; bg = "bg-vending"; icon = "fa-bottle-water";
            }

            // 名前の取得とフィルタ
            let name = tags.name || tags.alt_name || tags.location_name || "";
            // OSM上で特定の川（例: 二河川）が誤って目立つ場合は除外
            if (name && /二河川/.test(name)) return;

            // 名前がない場合でも、川や水域は表示候補にする
            if (!name && !(tags.highway === "steps" || tags.amenity === "vending_machine")) {
                if (type === "水辺・川・海") {
                    name = tags.waterway || tags.natural || '無名の水辺';
                } else {
                    // 非表示（名前必須）
                    return;
                }
            }

            addSpotToMap(elLat, elLon, type, name || type, "OSM", bg, icon, el.id);
        });
        log(`🌍 OSM: ${data.elements.length}件`);
        // （注）同名水辺を自動で結ぶ描画はユーザーから不要との要望があったため削除しました。
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

        // 種別に応じたアイコンと背景色を選択
        let chosenBg = "bg-kure";
        let chosenIcon = "fa-star";
        const lbl = (label || endpointId || "").toString().toLowerCase();
        if (lbl.includes('manhole') || lbl.includes('マンホール') || endpointId.includes('manhole')) {
            chosenBg = 'bg-manhole';
            chosenIcon = 'fa-circle-dot';
        } else if (lbl.includes('shelter') || lbl.includes('避難所') || lbl.includes('高台') || endpointId.includes('shelter')) {
            chosenBg = 'bg-infra';
            chosenIcon = 'fa-house';
        } else if (lbl.includes('culture') || lbl.includes('文化') || lbl.includes('cultural') || lbl.includes('retro') || lbl.includes('レトロ')) {
            chosenBg = 'bg-retro';
            chosenIcon = 'fa-landmark';
        }

        items.forEach(item => {
            const [iLat, iLon] = extractLatLon(item);
            const iName = item.name || item.title || item.location_name || item.location || item.place || "名称不明";
            if (iLat && iLon) {
                const dist = Math.sqrt(Math.pow(currentLat - iLat, 2) + Math.pow(currentLon - iLon, 2));
                if (dist < 0.02) { // 近場のみ
                    addSpotToMap(iLat, iLon, label, iName, "KureOfficial", chosenBg, chosenIcon);
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

function addSpotToMap(lat, lon, type, name, source, bgClass, iconClass="fa-map-pin", osmId=null) {
    // 重複チェック
    if(gatheredSpots.some(s => s.name === name && Math.abs(s.lat - lat) < 0.0001)) return;

    gatheredSpots.push({ lat, lon, type, name, source, osmId });
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
    // ユーザーの要望（ムード）をグローバルに保持（後続のルート調整で参照）
    window.userMood = mood;
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

        // 4. 避難所は通常は優先度を下げる（景色目的の高台は別途扱う）
        if (spot.type && spot.type.includes("避難所")) {
            if (mood.includes("避難") || mood.includes("避難所")) {
                score += 50; // 明示的に避難所を求めている場合のみ軽い加点
            } else {
                score -= 200; // 通常は避ける
            }
        }

        // 5. 高台 / 絶景は、ユーザーの要望に「景色」関連があると優先、なければ小さな加点
        if (spot.type && (spot.type.includes("絶景") || spot.type.includes("水辺") || spot.type.includes("高台") || spot.type.includes("view"))) {
            if (mood.includes("景") || mood.includes("絶景") || mood.includes("景色") || mood.includes("view")) score += 150;
            else score += 30;
        }

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

    // ルートが所要時間の下限より短い場合、候補スポットを追加して延伸を試みる
    async function tryExpandRouteToMinMinutes(pts, minAllowed, requested) {
        // 候補は gatheredSpots の中からまだ使われていないスポット
        const used = new Set(pts.map(p => (p.name || (p.lat + ',' + p.lon))));
        let candidates = gatheredSpots.filter(s => !used.has(s.name));
        if (!candidates || candidates.length === 0) return { pts, data: null, walkMinutes: 0, distMeters: 0 };

        // ヘルパ: 距離計算 (正確さは必要ないので簡易ハバースイン)
        function approxMeters(aLat, aLon, bLat, bLon) {
            const R = 6371000; const toRad = Math.PI / 180;
            const dLat = (bLat - aLat) * toRad; const dLon = (bLon - aLon) * toRad;
            const lat1 = aLat * toRad; const lat2 = bLat * toRad;
            const sinDLat = Math.sin(dLat/2); const sinDLon = Math.sin(dLon/2);
            const A = sinDLat*sinDLat + Math.cos(lat1)*Math.cos(lat2)*sinDLon*sinDLon;
            const C = 2 * Math.atan2(Math.sqrt(A), Math.sqrt(1-A));
            return R * C;
        }

        // 現在のルート長と所要時間を取得
        let baseData = await getOsrmForPoints(pts);
        let baseDist = 0; let baseMinutes = 0;
        if (baseData && baseData.routes && baseData.routes.length > 0) {
            baseDist = baseData.routes[0].distance;
            baseMinutes = Math.round((baseDist / 1000) / 4.0 * 60);
        }
        const metersPerMin = 4000 / 60; // 4km/h -> m/min
        let neededMeters = Math.max(0, (minAllowed - baseMinutes) * metersPerMin);
        if (neededMeters <= 0) return { pts, data: baseData, walkMinutes: baseMinutes, distMeters: baseDist };

        // 関心範囲: 各区間 (pts[i-1] -> pts[i]) に候補を挿入した時の増分を計算
        function scoreCandidateForPositions(cand, ptsArr) {
            const scores = [];
            for (let i = 1; i < ptsArr.length; i++) {
                const a = ptsArr[i-1]; const b = ptsArr[i];
                const before = approxMeters(a.lat, a.lon, b.lat, b.lon);
                const via = approxMeters(a.lat, a.lon, cand.lat, cand.lon) + approxMeters(cand.lat, cand.lon, b.lat, b.lon);
                const added = via - before;
                scores.push({ pos: i, addedMeters: added });
            }
            // 最大増分と位置を返す
            scores.sort((x,y) => y.addedMeters - x.addedMeters);
            return scores[0] || { pos: 1, addedMeters: 0 };
        }

        // 基準ジオメトリ（重複検出に使用）
        let baseGeom = [];
        if (baseData && baseData.routes && baseData.routes.length > 0 && baseData.routes[0].geometry) {
            baseGeom = baseData.routes[0].geometry.coordinates.slice(); // [lon,lat] pairs
        }

        // ヘルパ: ジオメトリ重複率を計算（共通の座標ペア割合）
        function overlapRatio(geomA, geomB) {
            if (!geomA || !geomB || geomA.length === 0 || geomB.length === 0) return 0;
            const round = (v) => Math.round(v * 10000) / 10000; // 約11m精度
            const setA = new Set();
            for (let i = 0; i < geomA.length - 1; i++) {
                const a0 = geomA[i]; const a1 = geomA[i+1];
                setA.add(`${round(a0[1])},${round(a0[0])}|${round(a1[1])},${round(a1[0])}`);
                setA.add(`${round(a1[1])},${round(a1[0])}|${round(a0[1])},${round(a0[0])}`);
            }
            let common = 0;
            let total = 0;
            for (let i = 0; i < geomB.length - 1; i++) {
                const b0 = geomB[i]; const b1 = geomB[i+1];
                const key = `${round(b0[1])},${round(b0[0])}|${round(b1[1])},${round(b1[0])}`;
                total++;
                if (setA.has(key)) common++;
            }
            return total === 0 ? 0 : (common / total);
        }

        // 繰り返し: 必要メートルを満たすまで貪欲に追加
        let ptsCopy = pts.slice();
        let localData = baseData; let localDist = baseDist; let localMinutes = baseMinutes;
        const MAX_ADDITIONS = 12; let additions = 0;
        while (neededMeters > 10 && additions < MAX_ADDITIONS) {
            // 各候補のベスト増分を評価
            const scored = [];
            for (const c of candidates) {
                const best = scoreCandidateForPositions(c, ptsCopy);
                // ムードで水辺優先バイアス
                let bias = 1;
                const mood = (window.userMood||'').toString();
                if ((mood.includes('川')||mood.includes('水')||mood.includes('海')) && (c.type||'').includes('水')) bias = 1.3;
                scored.push({ cand: c, pos: best.pos, addedMeters: best.addedMeters * bias });
            }
            // 上位を選ぶ
            scored.sort((a,b) => b.addedMeters - a.addedMeters);
            if (scored.length === 0 || scored[0].addedMeters <= 5) break; // 有効な候補なし

            // 追加候補のうち上位数件をOSRMでシミュレーションし、既存ルートとの重複を評価してペナルティ
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
                        // 重複が大きければ大幅ペナルティ、 moderate なら段階的に減衰
                        if (ov > 0.6) { s.addedMeters = 0; s.skip = true; log(`✖️ 候補 ${s.cand.name} は既存経路と ${Math.round(ov*100)}% 重複するため除外`); }
                        else if (ov > 0.2) { s.addedMeters *= (1 - ov * 0.9); log(`⚠️ 候補 ${s.cand.name} は経路と ${Math.round(ov*100)}% 重複。重みを調整`); }
                    }
                } catch(e) { log(`❌ 候補シミュレーションエラー: ${e.message}`); }
            }

            // 再ソートして最良を選ぶ
            scored.sort((a,b) => b.addedMeters - a.addedMeters);
            const pick = scored.find(s => !s.skip) || scored[0];

            // 挿入
            const newPt = { name: pick.cand.name || '追加スポット', lat: pick.cand.lat, lon: pick.cand.lon, photo_tip: '' };
            ptsCopy.splice(pick.pos, 0, newPt);
            additions++;
            log(`➕ 挿入: ${newPt.name} を位置 ${pick.pos} に追加 (推定 +${Math.round(pick.addedMeters)}m)`);

            // OSRMで再評価
            localData = await getOsrmForPoints(ptsCopy);
            if (localData && localData.routes && localData.routes.length > 0) {
                localDist = localData.routes[0].distance;
                localMinutes = Math.round((localDist / 1000) / 4.0 * 60);
            } else { localDist = 0; localMinutes = 0; }
            neededMeters = Math.max(0, (minAllowed - localMinutes) * metersPerMin);

            // 候補リストから使ったものを除去
            candidates = candidates.filter(c => c.name !== pick.cand.name || Math.abs(c.lat - pick.cand.lat) > 1e-6);
        }

        // それでも不足なら中間点で微調整（最終手段）
        if (neededMeters > 10) {
            let midsAdded = 0; const maxMids = 8;
            for (let i = 0; i < ptsCopy.length - 1 && midsAdded < maxMids && neededMeters > 10; i++) {
                const a = ptsCopy[i]; const b = ptsCopy[i+1];
                const mid = { name: 'ちょっと寄り道', lat: (a.lat + b.lat)/2, lon: (a.lon + b.lon)/2, photo_tip: '' };
                ptsCopy.splice(i+1, 0, mid);
                localData = await getOsrmForPoints(ptsCopy);
                if (localData && localData.routes && localData.routes.length > 0) {
                    localDist = localData.routes[0].distance;
                    localMinutes = Math.round((localDist / 1000) / 4.0 * 60);
                } else { localDist = 0; localMinutes = 0; }
                neededMeters = Math.max(0, (minAllowed - localMinutes) * metersPerMin);
                midsAdded++; log(`🔁 中間点追加で所要 ${localMinutes}分`);
            }
        }

        return { pts: ptsCopy, data: localData, walkMinutes: localMinutes, distMeters: localDist };
    }

    // 指定された OSM way/relation のジオメトリを取得する（Overpass）
    async function fetchOverpassGeometry(osmId, osmType="way") {
        try {
            log(`🌊 水路ジオメトリ取得: ${osmType}/${osmId} を Overpass から取得します`);
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
                } catch(e) { log(`❌ Overpass geom ${s} エラー: ${e.message}`); }
            }
            if (!data || !data.elements || data.elements.length === 0) {
                log('❗ ジオメトリ取得できませんでした'); return null;
            }
            const el = data.elements[0];
            // geometryは [{lat,lon}, ...]
            const coords = (el.geometry || []).map(p => [p.lat, p.lon]);
            return coords;
        } catch(e) { log(`❌ fetchOverpassGeometry エラー: ${e.message}`); return null; }
    }

    // 線上の座標配列から等間隔で n 個の点を抽出する
    function samplePointsOnLine(latlonArr, n) {
        if (!latlonArr || latlonArr.length === 0) return [];
        if (n <= 0) return [];
        // 距離累積
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
            // find segment
            let idx = 0; while (idx < dists.length-1 && dists[idx+1] < target) idx++;
            const a = latlonArr[idx]; const b = latlonArr[Math.min(idx+1, latlonArr.length-1)];
            const tSeg = (target - dists[idx]) / Math.max(1e-9, (dists[idx+1] - dists[idx] || 1e-9));
            const lat = a[0] + (b[0]-a[0]) * tSeg;
            const lon = a[1] + (b[1]-a[1]) * tSeg;
            out.push([lat, lon]);
        }
        return out;
    }

    // 川沿い希望なら、近い水路のジオメトリを取得して経由点を生成し、ptsの先頭直後へ挿入する
    async function injectRiverWaypointsIfRequested(pts, requested) {
        const mood = (window.userMood || '').toString();
        if (!(mood.includes('川') || mood.includes('水') || mood.includes('海'))) return pts;
        // gatheredSpots から水辺の OSM id を持つものを探す
        const waters = gatheredSpots.filter(s => (s.type||'').includes('水') && s.osmId);
        if (!waters || waters.length === 0) return pts;
        // startに最も近い水要素を選ぶ
        const start = { lat: currentLat, lon: currentLon };
        waters.sort((a,b) => {
            const da = Math.hypot(start.lat - a.lat, start.lon - a.lon);
            const db = Math.hypot(start.lat - b.lat, start.lon - b.lon);
            return da - db;
        });
        const chosen = waters[0];
        const geom = await fetchOverpassGeometry(chosen.osmId, 'way');
        if (!geom || geom.length < 2) return pts;
        // 作成する経由点数は所要時間に依存（長時間なら多め）
        const approxCount = Math.min(8, Math.max(3, Math.round(requested / 15)));
        const samples = samplePointsOnLine(geom, approxCount);
        // 生成点をptsの先頭直後に挿入（スタート→水路→既存ルート）
        const newPts = pts.slice();
        const insertPos = 1;
        const wp = samples.map((s,i) => ({ name: `${chosen.name||'水辺'} (${i+1})`, lat: s[0], lon: s[1], photo_tip: '' }));
        newPts.splice(insertPos, 0, ...wp);
        log(`🌊 川沿いポイントを ${wp.length} 件挿入しました（${chosen.name||'無名の水辺'}）`);
        return newPts;
    }

    try {
        let pts = routePoints.slice();
        // 川沿い希望があれば先に川の経由点を注入しておく
        if (window.userMood && (window.userMood.includes('川') || window.userMood.includes('水') || window.userMood.includes('海'))) {
            try { pts = await injectRiverWaypointsIfRequested(pts, requested); } catch(e) { log('❌ 川経由点注入でエラー: ' + e.message); }
        }
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
                    const coordsLatLon = coordinates.map(c => [c[1], c[0]]);

                    // 自己重複（同じ区間を再利用）を検出するヘルパ
                    function detectRepeatedSegments(latlonArr) {
                        const seen = new Set();
                        for (let i = 1; i < latlonArr.length; i++) {
                            const a = latlonArr[i-1]; const b = latlonArr[i];
                            const key = `${a[0].toFixed(5)},${a[1].toFixed(5)}|${b[0].toFixed(5)},${b[1].toFixed(5)}`;
                            if (seen.has(key)) return true;
                            // also add reverse to detect travel back
                            const rev = `${b[0].toFixed(5)},${b[1].toFixed(5)}|${a[0].toFixed(5)},${a[1].toFixed(5)}`;
                            if (seen.has(rev)) return true;
                            seen.add(key);
                        }
                        return false;
                    }

                    // 座標列を幅 direction(m) だけオフセットする（簡易）
                    function offsetCoordinates(latlonArr, offsetMeters) {
                        if (!latlonArr || latlonArr.length < 2) return latlonArr;
                        const out = [];
                        const Rlat = 111320; // m per deg lat approx
                        for (let i = 0; i < latlonArr.length; i++) {
                            const prev = latlonArr[Math.max(0, i-1)];
                            const next = latlonArr[Math.min(latlonArr.length-1, i+1)];
                            const lat = latlonArr[i][0];
                            // vector from prev to next
                            const dx = (next[1] - prev[1]) * Math.cos(lat * Math.PI/180) * Rlat; // meters approx
                            const dy = (next[0] - prev[0]) * Rlat;
                            // perp
                            let px = -dy; let py = dx;
                            const norm = Math.hypot(px, py) || 1;
                            px = px / norm; py = py / norm;
                            // convert meters to degrees
                            const dLat = (py * offsetMeters) / Rlat;
                            const dLon = (px * offsetMeters) / (Rlat * Math.cos(lat * Math.PI/180));
                            out.push([lat + dLat, latlonArr[i][1] + dLon]);
                        }
                        return out;
                    }

                    const hasRepeat = detectRepeatedSegments(coordsLatLon);
                    if (hasRepeat) {
                        // 重複がある場合は左右に2列にオフセットしてホットラインで描画
                        const left = offsetCoordinates(coordsLatLon, 3);
                        const right = offsetCoordinates(coordsLatLon, -3);
                        const leftHot = left.map((c, index) => [c[0], c[1], index / (left.length - 1)]);
                        const rightHot = right.map((c, index) => [c[0], c[1], index / (right.length - 1)]);
                        const leftHotline = L.hotline(leftHot, {
                            weight: 6, outlineWidth: 0,
                            palette: { 0.0: '#0000ff', 0.5: '#ff00ff', 1.0: '#ff0000' },
                            opacity: 1.0
                        }).addTo(routeLayer);
                        const rightHotline = L.hotline(rightHot, {
                            weight: 6, outlineWidth: 0,
                            palette: { 0.0: '#0000ff', 0.5: '#ff00ff', 1.0: '#ff0000' },
                            opacity: 1.0
                        }).addTo(routeLayer);
                        if (leftHotline.bringToFront) leftHotline.bringToFront();
                        if (rightHotline.bringToFront) rightHotline.bringToFront();
                        // 矢印線は中央軸に沿って表示（透明ポリラインに対して矢印を描く）
                        const centerLine = coordsLatLon.slice();
                        const arrowLine = L.polyline(centerLine, { color: 'transparent', weight: 0 }).addTo(routeLayer);
                        arrowLine.arrowheads({ size: '15px', frequency: '80px', fill: true, color: '#ff4500', offsets: { end: "10px" } });
                        if (arrowLine.bringToFront) arrowLine.bringToFront();
                    } else {
                        const hotline = L.hotline(hotlineData, {
                            weight: 6, outlineWidth: 0,
                            palette: { 0.0: '#0000ff', 0.5: '#ff00ff', 1.0: '#ff0000' },
                            opacity: 1.0
                        }).addTo(routeLayer);
                        if (hotline.bringToFront) hotline.bringToFront();

                        const arrowLine = L.polyline(coordsLatLon, { color: 'transparent', weight: 0 }).addTo(routeLayer);
                        arrowLine.arrowheads({ size: '15px', frequency: '80px', fill: true, color: '#ff4500', offsets: { end: "10px" } });
                        if (arrowLine.bringToFront) arrowLine.bringToFront();
                    }
                    if (hotline.bringToFront) hotline.bringToFront();

                    const arrowLine = L.polyline(bgCoords, { color: 'transparent', weight: 0 }).addTo(routeLayer);
                    arrowLine.arrowheads({ size: '15px', frequency: '80px', fill: true, color: '#ff4500', offsets: { end: "10px" } });
                    if (arrowLine.bringToFront) arrowLine.bringToFront();

            map.fitBounds(hotline.getBounds(), { padding: [50, 50], maxZoom: 17 });
            addRouteMarkers(routePoints);
            renderRouteSidebar({ ...window.lastRouteData, distance: distMeters, walkMinutes: walkMinutes });
        } else {
            addRouteMarkers(routePoints);
            renderRouteSidebar({ ...window.lastRouteData, distance: 0, walkMinutes: 0 });
        }
        // 範囲下限より短すぎる場合は注意表示
        if (requested && minAllowed !== null && walkMinutes < minAllowed) {
            log(`⚠️ ルート所要時間 ${walkMinutes}分 は希望下限 ${minAllowed}分 より短いです。自動でスポットを追加して延伸を試みます...`);
            const expanded = await tryExpandRouteToMinMinutes(pts, minAllowed, requested);
            if (expanded && expanded.walkMinutes >= minAllowed) {
                // 成功した場合、expanded.pts を使って再描画
                pts = expanded.pts;
                data = expanded.data || data;
                walkMinutes = expanded.walkMinutes;
                distMeters = expanded.distMeters;
                log(`✅ 自動延伸結果: ${walkMinutes}分`);
            } else {
                log(`⚠️ 自動延伸でも下限に達しませんでした（${expanded.walkMinutes || walkMinutes}分）。`);
            }
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
    // スクロール位置を末尾へ移動して、ユーザーが下まで見やすいようにする
    try { responseArea.scrollTop = responseArea.scrollHeight; } catch(e) {}
    // 高さを再計算
    adjustAiResponseHeight();
}