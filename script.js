// ==========================================
// ★APIキー設定
// ==========================================
const WEATHER_API_KEY = "f5ced26dbed1c3f5d9ca115851dd4cce";
const KURE_API_KEY    = "a2620ef7-164e-467c-85c6-a51ca43f1fe5";
// ==========================================

// グローバル変数
let map;
let markersLayer = L.layerGroup();
let currentLat, currentLon;
let gatheredSpots = [];
let weatherDescription = "";
let forecastText = ""; // AIに伝えるための予報テキスト

// --- 1. 初期化処理 ---
window.onload = function() {
    // 地図を呉市中心に表示
    map = L.map('map').setView([34.248, 132.565], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    markersLayer.addTo(map);

    // 地図クリックイベント
    map.on('click', async function(e) {
        await startExploration(e.latlng.lat, e.latlng.lng);
    });
};

// --- 時計の更新 (リアルタイム表示) ---
setInterval(() => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
    const clockEl = document.getElementById('clock');
    if(clockEl) clockEl.innerText = timeStr;
}, 1000);

// ログ出力用関数
function log(msg) {
    const el = document.getElementById('log-area');
    el.innerHTML += `<div>${msg}</div>`;
    el.scrollTop = el.scrollHeight;
}

// --- 2. 探索メイン処理 ---
async function startExploration(lat, lon) {
    currentLat = lat; currentLon = lon;
    gatheredSpots = [];
    markersLayer.clearLayers();
    
    // 現在地ピン
    L.marker([lat, lon]).addTo(markersLayer).bindPopup("現在地").openPopup();
    
    // UI更新
    document.getElementById('btn-search').disabled = true;
    document.getElementById('ai-response').innerHTML = "データ収集中...";
    document.getElementById('log-area').innerHTML = ""; 
    log(`📍 探索開始: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);

    // 呉市データセットIDの取得
    const idManhole = document.getElementById('id-manhole').value;
    const idCulture = document.getElementById('id-culture').value;
    const idShelter = document.getElementById('id-shelter').value;

    const promises = [];
    
    // A. 天気取得 (現在 + 予報)
    promises.push(fetchWeather(lat, lon));
    
    // B. OSM取得 (特盛りバージョン)
    promises.push(fetchOverpass(lat, lon));

    // C. 呉市データ取得 (IDがあるものだけ)
    if(idManhole) promises.push(fetchKureData(idManhole, "デザインマンホール"));
    if(idCulture) promises.push(fetchKureData(idCulture, "文化財・レトロ"));
    if(idShelter) promises.push(fetchKureData(idShelter, "避難所・高台"));

    // 全API完了待ち
    await Promise.all(promises);

    log(`✅ 完了。${gatheredSpots.length} 件のスポット発見。`);
    document.getElementById('btn-search').disabled = false;
    document.getElementById('ai-response').innerHTML = `データ収集完了！<br>現在の天気: ${weatherDescription}<br>発見スポット: ${gatheredSpots.length}件<br>「AIにプランを聞く」を押してください。`;
}

// --- API A: 天気予報取得 (現在天気 + 3時間ごとの予報) ---
async function fetchWeather(lat, lon) {
    if (WEATHER_API_KEY.includes("貼り付け")) {
        log("⚠️ OpenWeatherキー未設定"); return;
    }
    
    try {
        // 1. 現在の天気
        const currentUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}&lang=ja&units=metric`;
        const resCurrent = await fetch(currentUrl);
        const currentData = await resCurrent.json();
        
        // 画面更新 (現在)
        const curDesc = currentData.weather[0].description;
        const curTemp = Math.round(currentData.main.temp);
        const curIcon = `https://openweathermap.org/img/wn/${currentData.weather[0].icon}@2x.png`;
        
        // index.htmlに追加した要素へ値をセット
        const iconEl = document.getElementById('weather-icon');
        if(iconEl) iconEl.src = curIcon;
        
        const tempEl = document.getElementById('weather-temp');
        if(tempEl) tempEl.innerText = `${curTemp}℃`;
        
        const descEl = document.getElementById('weather-desc');
        if(descEl) descEl.innerText = curDesc;

        weatherDescription = `${curDesc} (気温:${curTemp}℃)`;
        log(`🌤 現在: ${weatherDescription}`);

        // 2. 未来の予報 (5日分/3時間ごと)
        const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}&lang=ja&units=metric`;
        const resForecast = await fetch(forecastUrl);
        const forecastData = await resForecast.json();

        // 画面更新 (未来) & AI用テキスト生成
        const container = document.getElementById('forecast-container');
        if(container) container.innerHTML = ""; // クリア
        forecastText = ""; // リセット

        // 向こう4回分 (約12時間後まで) を取得
        const list = forecastData.list.slice(0, 4); 
        
        list.forEach(item => {
            const date = new Date(item.dt * 1000);
            const time = date.getHours() + ":00";
            const temp = Math.round(item.main.temp);
            const desc = item.weather[0].description;
            const icon = `https://openweathermap.org/img/wn/${item.weather[0].icon}.png`;

            // HTML生成
            if(container) {
                const div = document.createElement('div');
                div.className = "forecast-item";
                div.innerHTML = `
                    <div class="forecast-time">${time}</div>
                    <img class="forecast-icon" src="${icon}">
                    <div class="forecast-temp">${temp}℃</div>
                `;
                container.appendChild(div);
            }

            // AI用の文章を作る ("15:00は雨(18℃), ...")
            forecastText += `${time}は${desc}(${temp}℃), `;
        });

        log(`🔮 予報取得: ${list.length}件`);

    } catch(e) {
        log(`❌ 天気エラー: ${e.message}`);
        weatherDescription = "取得失敗";
    }
}

// --- API B: OSM (Overpass Turbo 特盛り) ---
async function fetchOverpass(lat, lon) {
    log("🌍 OSMデータ検索中(特盛り)...");
    const query = `
        [out:json][timeout:30];
        (
          way["highway"="steps"](around:1000, ${lat}, ${lon});
          way["highway"="path"](around:1000, ${lat}, ${lon});
          node["amenity"="place_of_worship"](around:1000, ${lat}, ${lon});
          node["man_made"="torii"](around:1000, ${lat}, ${lon});
          node["tourism"="viewpoint"](around:1000, ${lat}, ${lon});
          node["man_made"="crane"](around:1000, ${lat}, ${lon});
          way["man_made"="bridge"](around:1000, ${lat}, ${lon});
          node["historic"](around:1000, ${lat}, ${lon});
          way["building:material"="brick"](around:1000, ${lat}, ${lon});
          way["barrier"="retaining_wall"](around:1000, ${lat}, ${lon});
          node["highway"="street_lamp"](around:1000, ${lat}, ${lon});
          node["amenity"="vending_machine"](around:1000, ${lat}, ${lon});
          node["man_made"="manhole"](around:1000, ${lat}, ${lon});
        );
        out center;
    `;
    const url = "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query);

    try {
        const res = await fetch(url);
        const data = await res.json();
        
        data.elements.forEach(el => {
            const elLat = el.lat || el.center.lat;
            const elLon = el.lon || el.center.lon;
            const tags = el.tags || {};
            
            // アイコン判定ロジック
            let type = "その他";
            let bgClass = "bg-osm";
            let iconClass = "fa-map-pin";

            if (tags.highway === "steps") { type = "階段"; bgClass = "bg-steps"; iconClass = "fa-person-hiking"; }
            else if (tags.highway === "path") { type = "路地"; bgClass = "bg-path"; iconClass = "fa-person-walking"; }
            else if (tags.man_made === "torii" || (tags.amenity === "place_of_worship" && tags.religion === "shinto")) { type = "神社・鳥居"; bgClass = "bg-shrine"; iconClass = "fa-torii-gate"; }
            else if (tags.amenity === "place_of_worship") { type = "寺社"; bgClass = "bg-temple"; iconClass = "fa-place-of-worship"; }
            else if (tags.tourism === "viewpoint") { type = "絶景"; bgClass = "bg-view"; iconClass = "fa-camera"; }
            else if (tags.man_made === "crane") { type = "クレーン"; bgClass = "bg-infra"; iconClass = "fa-industry"; }
            else if (tags.historic) { type = "レトロ・史跡"; bgClass = "bg-retro"; iconClass = "fa-landmark"; }
            else if (tags.highway === "street_lamp") { type = "街灯"; bgClass = "bg-lamp"; iconClass = "fa-lightbulb"; }
            else if (tags.amenity === "vending_machine") { type = "自販機"; bgClass = "bg-vending"; iconClass = "fa-bottle-water"; }

            addSpotToMap(elLat, elLon, type, tags.name || type, "OpenStreetMap", bgClass, iconClass);
        });
        log(`🌍 OSM: ${data.elements.length}件`);
    } catch(e) { log(`❌ OSMエラー: ${e.message}`); }
}

// --- API C: 呉市データ (実際のAPI仕様に修正済み) ---
async function fetchKureData(endpointId, label) {
    if (KURE_API_KEY.includes("貼り付け")) {
        log("⚠️ 呉市APIキー未設定"); return;
    }
    log(`⚓️ 呉データ(${label})取得中...`);
    const url = `https://api.expolis.cloud/opendata/t/kure/v1/${endpointId}`;
    
    try {
        const res = await fetch(url, {
            headers: { 
                "Authorization": `Bearer ${KURE_API_KEY}`,
                "Content-Type": "application/json"
             }
        });
        if(!res.ok) throw new Error(`Status ${res.status}`);
        const data = await res.json();

        let count = 0;
        data.forEach(item => {
            const iLat = item.latitude || item.lat || item.Lat;
            const iLon = item.longitude || item.lon || item.Lon || item.long;
            const iName = item.name || item.title || item.名称 || "名称不明";
            
            if(iLat && iLon) {
                const dist = Math.sqrt(Math.pow(currentLat - iLat, 2) + Math.pow(currentLon - iLon, 2));
                if(dist < 0.015) { // 1.5km圏内
                    addSpotToMap(iLat, iLon, label, iName, "KureOfficial", "bg-kure", "fa-star");
                    count++;
                }
            }
        });
        log(`⚓️ ${label}: ${count}件`);
    } catch(e) { log(`❌ 呉APIエラー: ${e.message}`); }
}

// --- マーカー追加ヘルパー ---
function addSpotToMap(lat, lon, type, name, source, bgClass, iconClass = "fa-map-pin") {
    gatheredSpots.push({ lat, lon, type, name, source });

    const icon = L.divIcon({
        className: '',
        html: `<div class="custom-icon ${bgClass}" style="width:24px; height:24px;">
                   <i class="fa-solid ${iconClass}"></i>
               </div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12]
    });

    L.marker([lat, lon], {icon: icon})
        .bindPopup(`<b>${name}</b><br>${type}<br><small>${source}</small>`)
        .addTo(markersLayer);
}

// --- 3. AIに聞く (Gemini) - 修正版 ---
async function askAI() {
    const geminiKey = document.getElementById('gemini-key').value;
    const mood = document.getElementById('user-mood').value;
    
    if(!geminiKey) { alert("Gemini APIキーを入力してください"); return; }
    if(gatheredSpots.length === 0) { alert("周辺にスポットがありません"); return; }

    const responseArea = document.getElementById('ai-response');
    responseArea.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> AIがルートを生成中...';

    // データの要約 (ランダム30件)
    const spotsList = gatheredSpots
        .sort(() => 0.5 - Math.random())
        .slice(0, 30)
        .map(s => `- [${s.source}] ${s.type}: ${s.name}`)
        .join("\n");

    const prompt = `
あなたは呉市の観光ガイドです。以下のリアルタイムデータから散歩プランを作成してください。

【現在の状況】
- 現在時刻: ${new Date().toLocaleTimeString()}
- 現在の天気: ${weatherDescription}
- 今後の予報: ${forecastText}
- ユーザーの気分: ${mood}

【周辺スポット】
${spotsList}

【指令】
1. 天気予報（今後の変化）を考慮した「散歩テーマ」
2. [KureOfficial]を含む3つのルート提案
3. 情緒的な解説
`;

    try {
        // ★修正箇所: モデル名を 'gemini-1.5-flash' から 'gemini-1.5-flash-latest' に変更
        // もしこれでもエラーになる場合は 'gemini-pro' に書き換えてみてください
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${geminiKey}`;
        
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        
        const result = await res.json();

        // エラーチェック
        if (result.error) {
            console.error("Gemini API Error:", result.error);
            throw new Error(`Google APIのエラー: ${result.error.message}`);
        }
        if (!result.candidates || result.candidates.length === 0) {
            throw new Error("AIからの回答が空でした。(安全フィルター等の可能性)");
        }

        const text = result.candidates[0].content.parts[0].text;
        responseArea.innerHTML = marked.parse(text);

    } catch(e) {
        console.error(e);
        responseArea.innerHTML = `<div style="color:red; font-weight:bold;">AIエラー発生</div><small>${e.message}</small>`;
    }
}