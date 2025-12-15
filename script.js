// ==========================================
// ★APIキー設定
// ==========================================
const WEATHER_API_KEY = "f5ced26dbed1c3f5d9ca115851dd4cce";
const KURE_API_KEY    = "a2620ef7-164e-467c-85c6-a51ca43f1fe5";

// ★ モデル名設定
// ご指定のモデル名に設定しました。
// ※もしAPIエラー(404など)が出る場合は "gemini-1.5-flash" に戻してください。
const GEMINI_MODEL_NAME = "gemini-3-pro-preview"; 
// ==========================================

// グローバル変数
let map;
let markersLayer = L.layerGroup();
let routeLayer = L.layerGroup();
let currentLat, currentLon;
let gatheredSpots = [];
let weatherDescription = "";
let forecastText = ""; 

// --- 1. 初期化処理 ---
window.onload = function() {
    loadSettings(); // 設定の復元

    map = L.map('map').setView([34.248, 132.565], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    markersLayer.addTo(map);
    routeLayer.addTo(map);

    map.on('click', async function(e) {
        await startExploration(e.latlng.lat, e.latlng.lng);
    });

    // 入力欄の変更を監視して自動保存
    const inputs = document.querySelectorAll('input');
    inputs.forEach(input => {
        input.addEventListener('input', saveSettings);
    });
};

// --- ★設定の自動保存と復元 ---
function saveSettings() {
    const settings = {
        geminiKey: document.getElementById('gemini-key').value,
        mood: document.getElementById('user-mood').value,
        idManhole: document.getElementById('id-manhole').value,
        idCulture: document.getElementById('id-culture').value,
        idShelter: document.getElementById('id-shelter').value
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
    }
}

// --- サイドバー開閉 ---
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('closed');
}

// --- 時計更新 ---
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

// --- 2. 探索メイン処理 ---
async function startExploration(lat, lon) {
    currentLat = lat; currentLon = lon;
    gatheredSpots = [];
    markersLayer.clearLayers();
    routeLayer.clearLayers();
    
    L.marker([lat, lon]).addTo(markersLayer).bindPopup("現在地").openPopup();
    
    document.getElementById('btn-search').disabled = true;
    document.getElementById('ai-response').innerHTML = "データ収集中...";
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

// --- API A: 天気予報 ---
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

// --- API B: OSM ---
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

// --- API C: 呉市データ ---
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

// --- 3. AIに聞く (JSON & アニメーションルート対応) ---
async function askAI() {
    const geminiKey = document.getElementById('gemini-key').value;
    const mood = document.getElementById('user-mood').value;
    
    if(!geminiKey) { alert("Gemini APIキーを入力してください"); return; }
    if(gatheredSpots.length === 0) { alert("周辺にスポットがありません"); return; }

    const responseArea = document.getElementById('ai-response');
    responseArea.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> AIがルートを計算中...';
    routeLayer.clearLayers();

    const spotsListJson = gatheredSpots.sort(() => 0.5 - Math.random()).slice(0, 40)
        .map(s => ({ name: s.name, type: s.type, lat: s.lat, lon: s.lon }));

    const prompt = `
あなたは呉市のフォトスポットガイドです。
以下のデータから、最も写真映えする散歩ルートを1つ作成してください。

【条件】
- 現在地からスタートし、3〜5箇所のスポットを巡る現実的なルート。
- 天気(${weatherDescription}, 予報:${forecastText})と気分(${mood})を考慮すること。
- 長文の説明は不要。

【重要指令】
回答は必ず以下のJSONフォーマットのみで行うこと。Markdownのコードブロック(jsonなど)は不要。

{
  "theme": "ルートの短いキャッチコピー (例: 雨上がりのレトロ階段巡り)",
  "route": [
    {
      "name": "スポット名1 (現在地に近い場所)",
      "lat": 緯度(数値),
      "lon": 経度(数値),
      "photo_tip": "ここで撮るべき写真の具体的で短いヒント"
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
        log("🗺️ ルートデータを受信しました。");
        
        drawRouteOnMap(routeData.route);
        renderRouteSidebar(routeData);

    } catch(e) {
        console.error(e);
        responseArea.innerHTML = `<div style="color:red; font-weight:bold;">ルート生成エラー</div><small>${e.message}</small><br><small>※AIが正しいデータを返せませんでした。もう一度試してみてください。</small>`;
        log(`❌ エラー: ${e.message}`);
    }
}

// --- ★アニメーション付きルート描画 ---
function drawRouteOnMap(routePoints) {
    if(!routePoints || routePoints.length === 0) return;

    const latlngs = routePoints.map(p => [p.lat, p.lon]);
    latlngs.unshift([currentLat, currentLon]);

    const polyline = L.polyline(latlngs, {
        color: '#ff4500',
        weight: 6,
        opacity: 0.9,
        dashArray: '10, 10', 
        className: 'animated-route'
    }).addTo(routeLayer);

    map.fitBounds(polyline.getBounds(), { padding: [50, 50], maxZoom: 17 });
}

function renderRouteSidebar(data) {
    const responseArea = document.getElementById('ai-response');
    let html = `<div class="route-theme">“ ${data.theme} ”</div>`;
    data.route.forEach((step, index) => {
        html += `
            <div class="route-step">
                <div class="step-name"><span style="color:#ff4500;">Step ${index + 1}:</span> ${step.name}</div>
                <div class="step-photo"><i class="fa-solid fa-camera"></i> ${step.photo_tip}</div>
            </div>
        `;
    });
    html += `<small style="color:#666;">※地図上の赤い点線が推奨ルートです。</small>`;
    responseArea.innerHTML = html;
}