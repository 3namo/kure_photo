// ==========================================
// ★APIキー設定
// ==========================================
const WEATHER_API_KEY = "f5ced26dbed1c3f5d9ca115851dd4cce";
const KURE_API_KEY    = "a2620ef7-164e-467c-85c6-a51ca43f1fe5";

// ★モデル名: gemini-2.5-flash
const GEMINI_MODEL_NAME = "gemini-2.5-flash";
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

window.onload = function() {
    loadSettings();

    map = L.map('map').setView([34.248, 132.565], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    markersLayer.addTo(map);
    routeLayer.addTo(map);

    // 初期状態はGPS OFFに設定
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
};

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
}

function toggleLocationMode() {
    gpsMode = document.getElementById('gps-mode-toggle').checked;
    updateLocationHint();
    
    if (gpsMode) {
        getCurrentLocation();
    }
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
        gpsMode = false;
        document.getElementById('gps-mode-toggle').checked = false;
        updateLocationHint();
        return;
    }

    navigator.geolocation.getCurrentPosition(
        function(position) {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            const accuracy = position.coords.accuracy;
            log(`✅ GPS取得成功: ${lat.toFixed(4)}, ${lon.toFixed(4)} (精度: ${Math.round(accuracy)}m)`);
            
            // 地図を現在地に移動
            map.setView([lat, lon], 16);
            
            // 現在地マーカーを表示
            if (currentLocationMarker) {
                markersLayer.removeLayer(currentLocationMarker);
            }
            const icon = L.divIcon({
                className: '',
                html: `<div style="width:28px; height:28px; background:#007bff; border-radius:50%; border:3px solid white; box-shadow:0 0 10px rgba(0,123,255,0.5);"></div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 14],
                popupAnchor: [0, -14]
            });
            currentLocationMarker = L.marker([lat, lon], {icon: icon})
                .bindPopup("現在地（GPS取得）")
                .addTo(markersLayer)
                .openPopup();
        },
        function(error) {
            let errorMsg = '位置情報の取得に失敗しました';
            if (error.code === error.PERMISSION_DENIED) {
                errorMsg = '位置情報へのアクセスが許可されていません';
            } else if (error.code === error.POSITION_UNAVAILABLE) {
                errorMsg = '位置情報が利用できません';
            } else if (error.code === error.TIMEOUT) {
                errorMsg = '位置情報の取得がタイムアウトしました';
            }
            log(`❌ GPS取得エラー: ${errorMsg}`);
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

function toggleLogArea() {
    const container = document.getElementById('log-area');
    const arrow = document.getElementById('log-arrow');
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
    const timeStr = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    const clockEl = document.getElementById('clock');
    if(clockEl) clockEl.innerText = timeStr;
}, 1000);

function log(msg) {
    const el = document.getElementById('log-area');
    if(el) {
        el.innerHTML += `<div>${msg}</div>`;
        el.scrollTop = el.scrollHeight;
    }
}

async function startExploration(lat, lon) {
    currentLat = lat; currentLon = lon;
    gatheredSpots = [];
    if (!gpsMode) {
        markersLayer.clearLayers();
    }
    routeLayer.clearLayers();
    
    // GPS モード時は既にマーカーがあるので追加しない
    if (!gpsMode) {
        L.marker([lat, lon]).addTo(markersLayer).bindPopup("現在地").openPopup();
    } else if (currentLocationMarker) {
        currentLocationMarker.openPopup();
    }
    
    document.getElementById('btn-search').disabled = true;
    document.getElementById('ai-response').innerHTML = "データ収集中...";
    
    // ★改善箇所: 探索開始時はアコーディオンを閉じる（画面をすっきりさせる）
    const detailsElement = document.getElementById('ai-result-details');
    if(detailsElement) detailsElement.open = false;

    document.getElementById('log-area').innerHTML = ""; 
    log(`📍 探索開始: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);

    const idManhole = document.getElementById('id-manhole').value;
    const idCulture = document.getElementById('id-culture').value;
    const idShelter = document.getElementById('id-shelter').value;

    const promises = [];
    promises.push(fetchWeather(lat, lon));
    promises.push(fetchOverpass(lat, lon));
    if(idManhole) promises.push(fetchKureData(idManhole, "デザインマンホール"));
    if(idCulture) promises.push(fetchKureData(idCulture, "文化財・レトロ"));
    if(idShelter) promises.push(fetchKureData(idShelter, "避難所・高台"));

    await Promise.all(promises);

    log(`✅ 完了。${gatheredSpots.length} 件のスポット発見。`);
    document.getElementById('btn-search').disabled = false;
    document.getElementById('ai-response').innerHTML = `データ収集完了！<br>現在の天気: ${weatherDescription}<br>発見スポット: ${gatheredSpots.length}件<br>「AIにプランを聞く」を押してください。`;
}

async function fetchWeather(lat, lon) {
    if (WEATHER_API_KEY.includes("貼り付け")) { log("⚠️ OpenWeatherキー未設定"); return; }
    try {
        const currentUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}&lang=ja&units=metric`;
        const resCurrent = await fetch(currentUrl);
        const currentData = await resCurrent.json();
        
        const curDesc = currentData.weather[0].description;
        const curTemp = Math.round(currentData.main.temp);
        const curIcon = `https://openweathermap.org/img/wn/${currentData.weather[0].icon}@2x.png`;
        
        const iconEl = document.getElementById('weather-icon'); if(iconEl) iconEl.src = curIcon;
        const tempEl = document.getElementById('weather-temp'); if(tempEl) tempEl.innerText = `${curTemp}℃`;
        const descEl = document.getElementById('weather-desc'); if(descEl) descEl.innerText = curDesc;

        weatherDescription = `${curDesc} (気温:${curTemp}℃)`;
        log(`🌤 現在: ${weatherDescription}`);

        const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}&lang=ja&units=metric`;
        const resForecast = await fetch(forecastUrl);
        const forecastData = await resForecast.json();

        const container = document.getElementById('forecast-container');
        if(container) container.innerHTML = ""; 
        forecastText = ""; 

        const list = forecastData.list.slice(0, 4); 
        list.forEach(item => {
            const date = new Date(item.dt * 1000);
            const time = date.getHours() + ":00";
            const temp = Math.round(item.main.temp);
            const desc = item.weather[0].description;
            const icon = `https://openweathermap.org/img/wn/${item.weather[0].icon}.png`;

            if(container) {
                const div = document.createElement('div');
                div.className = "forecast-item";
                div.innerHTML = `<div class="forecast-time">${time}</div><img class="forecast-icon" src="${icon}"><div class="forecast-temp">${temp}℃</div>`;
                container.appendChild(div);
            }
            forecastText += `${time}は${desc}(${temp}℃), `;
        });
        log(`🔮 予報取得: ${list.length}件`);
    } catch(e) {
        log(`❌ 天気エラー: ${e.message}`);
        weatherDescription = "取得失敗";
    }
}

async function fetchOverpass(lat, lon) {
    log("🌍 OSMデータ検索中(特盛り)...");
    const query = `[out:json][timeout:30];(way["highway"="steps"](around:1000,${lat},${lon});way["highway"="path"](around:1000,${lat},${lon});node["amenity"="place_of_worship"](around:1000,${lat},${lon});node["man_made"="torii"](around:1000,${lat},${lon});node["tourism"="viewpoint"](around:1000,${lat},${lon});node["man_made"="crane"](around:1000,${lat},${lon});way["man_made"="bridge"](around:1000,${lat},${lon});node["historic"](around:1000,${lat},${lon});way["building:material"="brick"](around:1000,${lat},${lon});way["barrier"="retaining_wall"](around:1000,${lat},${lon});node["highway"="street_lamp"](around:1000,${lat},${lon});node["amenity"="vending_machine"](around:1000,${lat},${lon});node["man_made"="manhole"](around:1000,${lat},${lon}););out center;`;
    const url = "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query);
    try {
        const res = await fetch(url);
        const data = await res.json();
        data.elements.forEach(el => {
            const tags = el.tags || {};
            const lat = el.lat || el.center.lat;
            const lon = el.lon || el.center.lon;
            let type="その他", bg="bg-osm", icon="fa-map-pin";
            if (tags.highway==="steps") { type="階段"; bg="bg-steps"; icon="fa-person-hiking"; }
            else if (tags.highway==="path") { type="路地"; bg="bg-path"; icon="fa-person-walking"; }
            else if (tags.man_made==="torii"||(tags.amenity==="place_of_worship"&&tags.religion==="shinto")) { type="神社"; bg="bg-shrine"; icon="fa-torii-gate"; }
            else if (tags.amenity==="place_of_worship") { type="寺社"; bg="bg-temple"; icon="fa-place-of-worship"; }
            else if (tags.tourism==="viewpoint") { type="絶景"; bg="bg-view"; icon="fa-camera"; }
            else if (tags.man_made==="crane") { type="クレーン"; bg="bg-infra"; icon="fa-industry"; }
            else if (tags.historic) { type="史跡"; bg="bg-retro"; icon="fa-landmark"; }
            else if (tags.highway==="street_lamp") { type="街灯"; bg="bg-lamp"; icon="fa-lightbulb"; }
            else if (tags.amenity==="vending_machine") { type="自販機"; bg="bg-vending"; icon="fa-bottle-water"; }
            addSpotToMap(lat, lon, type, tags.name||type, "OSM", bg, icon);
        });
        log(`🌍 OSM: ${data.elements.length}件`);
    } catch(e) { log(`❌ OSMエラー: ${e.message}`); }
}

async function fetchKureData(endpointId, label) {
    if (KURE_API_KEY.includes("貼り付け")) { log("⚠️ 呉市キー未設定"); return; }
    log(`⚓️ 呉データ(${label})取得中...`);
    const url = `https://api.expolis.cloud/opendata/t/kure/v1/${endpointId}`;
    try {
        const res = await fetch(url, { headers: { "Authorization": `Bearer ${KURE_API_KEY}` } });
        if(!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        let count = 0;
        data.forEach(item => {
            const iLat = item.latitude || item.lat || item.Lat;
            const iLon = item.longitude || item.lon || item.Lon || item.long;
            const iName = item.name || item.title || item.名称 || "名称不明";
            if(iLat && iLon) {
                const dist = Math.sqrt(Math.pow(currentLat - iLat, 2) + Math.pow(currentLon - iLon, 2));
                if(dist < 0.015) {
                    addSpotToMap(iLat, iLon, label, iName, "KureOfficial", "bg-kure", "fa-star");
                    count++;
                }
            }
        });
        log(`⚓️ ${label}: ${count}件`);
    } catch(e) { log(`❌ 呉APIエラー: ${e.message}`); }
}

function addSpotToMap(lat, lon, type, name, source, bgClass, iconClass="fa-map-pin") {
    gatheredSpots.push({ lat, lon, type, name, source });
    const icon = L.divIcon({
        className: '',
        html: `<div class="custom-icon ${bgClass}" style="width:24px; height:24px;"><i class="fa-solid ${iconClass}"></i></div>`,
        iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12]
    });
    L.marker([lat, lon], {icon: icon})
        .bindPopup(`<b>${name}</b><br>${type}<br><small>${source}</small>`)
        .addTo(markersLayer);
}

async function askAI() {
    const geminiKey = document.getElementById('gemini-key').value;
    const mood = document.getElementById('user-mood').value;
    const duration = document.getElementById('walk-duration').value || 60;
    const destination = document.getElementById('final-dest').value || "AIにお任せ(最適な場所)";
    
    if(!geminiKey) { alert("Gemini APIキーを入力してください"); return; }
    if(gatheredSpots.length === 0) { alert("周辺にスポットがありません"); return; }

    // ★改善箇所: ボタンを押したら強制的にアコーディオンを開く
    const detailsElement = document.getElementById('ai-result-details');
    if(detailsElement) detailsElement.open = true;

    const responseArea = document.getElementById('ai-response');
    responseArea.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> AIがルートを計算中...';
    routeLayer.clearLayers();

    const spotsListJson = gatheredSpots
        .sort(() => 0.5 - Math.random())
        .slice(0, 30) 
        .map(s => ({ name: s.name, type: s.type, lat: s.lat, lon: s.lon }));

    const prompt = `
あなたは呉市のフォトスポットガイドです。
以下のデータから、最も写真映えする散歩ルートを1つ作成してください。

【条件】
- 現在地からスタートすること。
- 所要時間: ${duration}分を目安にしてください。移動と撮影を含めて、この時間を**最大限活用する**充実したルートにしてください。短時間で終わるルートはNGです。
- ゴール地点: "${destination}" にすること。
- 天気(${weatherDescription}, 予報:${forecastText})と気分(${mood})を考慮すること。
- 長文の説明は不要。

【重要指令】
回答は必ず以下のJSONフォーマットのみで行うこと。Markdownのコードブロックは不要。

{
  "theme": "ルートの短いキャッチコピー",
  "route": [
    {
      "name": "スポット名1",
      "lat": 緯度(数値),
      "lon": 経度(数値),
      "photo_tip": "写真のヒント"
    },
    {
      "name": "スポット名2",
      "lat": 緯度, "lon": 経度,
      "photo_tip": "写真のヒント"
    }
  ]
}

【周辺スポット候補データ】
${JSON.stringify(spotsListJson)}
`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_NAME}:generateContent?key=${geminiKey}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        
        const result = await res.json();
        if (result.error) throw new Error(`Google API Error: ${result.error.message}`);
        if (!result.candidates || result.candidates.length === 0) throw new Error("AIからの回答が空でした");

        let text = result.candidates[0].content.parts[0].text;
        text = text.replace(/^```json\s*/, "").replace(/\s*```$/, "");

        const routeData = JSON.parse(text);
        window.lastRouteData = routeData;

        log("🗺️ ルートデータを受信。ナビゲーション取得中...");
        
        // 念のためここでも開く
        if(detailsElement) detailsElement.open = true;

        await drawSmartRoute(routeData.route);

    } catch(e) {
        console.error(e);
        // エラー時も見せる
        if(detailsElement) detailsElement.open = true;
        responseArea.innerHTML = `<div style="color:red; font-weight:bold;">ルート生成エラー</div><small>${e.message}</small>`;
        log(`❌ エラー: ${e.message}`);
    }
}

async function drawSmartRoute(routePoints) {
    if(!routePoints || routePoints.length === 0) return;

    const waypoints = [
        [currentLon, currentLat],
        ...routePoints.map(p => [p.lon, p.lat])
    ];

    const coordsString = waypoints.map(pt => pt.join(',')).join(';');
    const osrmUrl = `https://router.project-osrm.org/route/v1/walking/${coordsString}?overview=full&geometries=geojson`;

    try {
        const res = await fetch(osrmUrl);
        const data = await res.json();

        let distMeters = 0;
        let walkMinutes = 0;

        if (data.routes && data.routes.length > 0) {
            const route = data.routes[0];
            const coordinates = route.geometry.coordinates;
            
            distMeters = route.distance;
            
            const speedKmh = 4.0;
            walkMinutes = Math.round((distMeters / 1000) / speedKmh * 60);

            const hotlineData = coordinates.map((c, index) => [
                c[1], c[0], index / (coordinates.length - 1)
            ]);

            const hotline = L.hotline(hotlineData, {
                weight: 6,
                outlineWidth: 1,
                outlineColor: 'white',
                palette: { 0.0: '#0000ff', 0.5: '#ff00ff', 1.0: '#ff0000' }
            }).addTo(routeLayer);

            const arrowLine = L.polyline(coordinates.map(c => [c[1], c[0]]), {
                color: 'transparent', weight: 0
            }).addTo(routeLayer);

            arrowLine.arrowheads({
                size: '15px', frequency: '80px', fill: true, color: '#ff4500', offsets: { end: "10px" }
            });

            map.fitBounds(hotline.getBounds(), { padding: [50, 50], maxZoom: 17 });
            addRouteMarkers(routePoints);
            
            renderRouteSidebar({ 
                ...window.lastRouteData, 
                distance: distMeters, 
                walkMinutes: walkMinutes
            });

        } else {
            console.warn("OSRMルート取得失敗。");
            addRouteMarkers(routePoints);
            renderRouteSidebar({ ...window.lastRouteData, distance: 0, walkMinutes: 0 });
        }
    } catch (e) {
        console.error("OSRM Error:", e);
        log("⚠️ 道案内データの取得に失敗しました");
        addRouteMarkers(routePoints);
    }
}

function addRouteMarkers(routePoints) {
    routePoints.forEach((pt, index) => {
        const numIcon = L.divIcon({
            className: '',
            html: `<div style="
                background: #ff0000; color: white; border-radius: 50%;
                width: 24px; height: 24px; text-align: center; line-height: 24px;
                font-weight: bold; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">
                ${index + 1}
            </div>`,
            iconSize: [28, 28],
            iconAnchor: [14, 28]
        });

        L.marker([pt.lat, pt.lon], { icon: numIcon, zIndexOffset: 1000 })
            .bindPopup(`<b>Step ${index+1}</b><br>${pt.name}`)
            .addTo(routeLayer);
    });
}

function renderRouteSidebar(data) {
    const responseArea = document.getElementById('ai-response');
    
    const distStr = (data.distance !== undefined) ? (data.distance / 1000).toFixed(1) + " km" : "-- km";
    const timeStr = (data.walkMinutes !== undefined) ? data.walkMinutes + " 分 (時速4km)" : "-- 分";

    let html = `<div class="route-theme">“ ${data.theme} ”</div>`;
    
    html += `
        <div class="route-meta">
            <i class="fa-solid fa-person-walking"></i> <span>${distStr}</span> &nbsp;&nbsp;/&nbsp;&nbsp; 
            <i class="fa-solid fa-clock"></i> <span>${timeStr}</span>
        </div>
    `;
    
    data.route.forEach((step, index) => {
        html += `
            <div class="route-step">
                <div class="step-name"><span style="color:#ff4500;">Step ${index + 1}:</span> ${step.name}</div>
                <div class="step-photo"><i class="fa-solid fa-camera"></i> ${step.photo_tip}</div>
            </div>
        `;
    });
    
    html += `<small style="color:#666;">※青(スタート)から赤(ゴール)へ。<br>矢印の方向に進んでください。</small>`;
    responseArea.innerHTML = html;
}