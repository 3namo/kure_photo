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

// 1. 初期化処理
window.onload = function() {
    map = L.map('map').setView([34.248, 132.565], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
    markersLayer.addTo(map);

    map.on('click', async function(e) {
        await startExploration(e.latlng.lat, e.latlng.lng);
    });
};

function log(msg) {
    const el = document.getElementById('log-area');
    el.innerHTML += `<div>${msg}</div>`;
    el.scrollTop = el.scrollHeight;
}

// 2. 探索メイン処理
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

    // 呉市データセットIDの取得 (観光施設は削除済み)
    const idManhole = document.getElementById('id-manhole').value;
    const idCulture = document.getElementById('id-culture').value;
    const idShelter = document.getElementById('id-shelter').value;

    const promises = [];
    
    // A. 天気取得
    promises.push(fetchWeather(lat, lon));
    
    // B. OSM取得 (特盛りバージョン)
    promises.push(fetchOverpass(lat, lon));

    // C. 呉市データ取得 (観光施設は削除済み)
    if(idManhole) promises.push(fetchKureData(idManhole, "デザインマンホール"));
    if(idCulture) promises.push(fetchKureData(idCulture, "文化財・レトロ"));
    if(idShelter) promises.push(fetchKureData(idShelter, "避難所・高台"));

    await Promise.all(promises);

    log(`✅ 完了。${gatheredSpots.length} 件のスポット発見。`);
    document.getElementById('btn-search').disabled = false;
    document.getElementById('ai-response').innerHTML = `データ収集完了！<br>現在の天気: ${weatherDescription}<br>発見スポット: ${gatheredSpots.length}件<br>「AIにプランを聞く」を押してください。`;
}

// --- API A: 天気 (OpenWeather) ---
async function fetchWeather(lat, lon) {
    if (WEATHER_API_KEY.includes("貼り付け")) {
        log("⚠️ OpenWeatherキー未設定"); return;
    }
    try {
        const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${WEATHER_API_KEY}&lang=ja&units=metric`;
        const res = await fetch(url);
        const data = await res.json();
        weatherDescription = `${data.weather[0].description} (気温:${data.main.temp}℃)`;
        log(`🌤 天気: ${weatherDescription}`);
    } catch(e) {
        log(`❌ 天気エラー: ${e.message}`);
        weatherDescription = "取得失敗";
    }
}

// --- API B: OSM (Overpass Turbo 特盛り完全版) ---
async function fetchOverpass(lat, lon) {
    log("🌍 OSMデータ検索中(特盛り)...");
    
    const query = `
        [out:json][timeout:30];
        (
          // A. 階段・路地
          way["highway"="steps"](around:1000, ${lat}, ${lon});
          way["highway"="path"](around:1000, ${lat}, ${lon});

          // B. 神社・鳥居
          node["amenity"="place_of_worship"](around:1000, ${lat}, ${lon});
          way["amenity"="place_of_worship"](around:1000, ${lat}, ${lon});
          node["man_made"="torii"](around:1000, ${lat}, ${lon});

          // C. 絶景・展望
          node["tourism"="viewpoint"](around:1000, ${lat}, ${lon});

          // D. 産業・インフラ・廃墟
          node["man_made"="crane"](around:1000, ${lat}, ${lon});
          way["man_made"="bridge"](around:1000, ${lat}, ${lon});
          node["historic"~"memorial|monument|ruins|castle"](around:1000, ${lat}, ${lon});
          node["man_made"="monument"](around:1000, ${lat}, ${lon});
          node["man_made"="pipeline"](around:1000, ${lat}, ${lon});
          way["building:material"="brick"](around:1000, ${lat}, ${lon});
          way["barrier"="retaining_wall"](around:1000, ${lat}, ${lon});

          // E. 夜・雨の演出
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
            
            // アイコンと色の判定ロジック (MapCSS対応)
            let type = "その他";
            let bgClass = "bg-osm";
            let iconClass = "fa-map-pin";

            if (tags.highway === "steps") { type = "階段"; bgClass = "bg-steps"; iconClass = "fa-person-hiking"; }
            else if (tags.highway === "path") { type = "路地"; bgClass = "bg-path"; iconClass = "fa-person-walking"; }
            else if (tags.man_made === "torii" || (tags.amenity === "place_of_worship" && tags.religion === "shinto")) { 
                type = "神社・鳥居"; bgClass = "bg-shrine"; iconClass = "fa-torii-gate"; 
            }
            else if (tags.amenity === "place_of_worship") { 
                type = "寺社"; bgClass = "bg-temple"; iconClass = "fa-place-of-worship"; 
            }
            else if (tags.tourism === "viewpoint") { type = "絶景"; bgClass = "bg-view"; iconClass = "fa-camera"; }
            else if (tags.man_made === "crane" || tags.man_made === "pipeline") { 
                type = "工場・クレーン"; bgClass = "bg-infra"; iconClass = "fa-industry"; 
            }
            else if (tags.man_made === "bridge") { type = "橋"; bgClass = "bg-infra"; iconClass = "fa-road-bridge"; }
            else if (tags.historic || tags.man_made === "monument") { 
                type = "史跡・レトロ"; bgClass = "bg-retro"; iconClass = "fa-landmark"; 
            }
            else if (tags.building === "brick" || tags.barrier === "retaining_wall") { 
                type = "レンガ・石垣"; bgClass = "bg-retro"; iconClass = "fa-dungeon"; 
            }
            else if (tags.highway === "street_lamp") { type = "街灯"; bgClass = "bg-lamp"; iconClass = "fa-lightbulb"; }
            else if (tags.amenity === "vending_machine") { type = "自販機"; bgClass = "bg-vending"; iconClass = "fa-bottle-water"; }
            else if (tags.man_made === "manhole") { type = "マンホール"; bgClass = "bg-manhole"; iconClass = "fa-circle-dot"; }

            addSpotToMap(elLat, elLon, type, tags.name || type, "OpenStreetMap", bgClass, iconClass);
        });
        log(`🌍 OSM: ${data.elements.length}件`);
    } catch(e) { log(`❌ OSMエラー: ${e.message}`); }
}

// --- API C: 呉市データ ---
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

// 3. AIに聞く (Gemini)
async function askAI() {
    const geminiKey = document.getElementById('gemini-key').value;
    const mood = document.getElementById('user-mood').value;
    
    if(!geminiKey) { alert("Gemini APIキーを入力してください"); return; }
    if(gatheredSpots.length === 0) { alert("周辺にスポットがありません"); return; }

    document.getElementById('ai-response').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> AIがルートを生成中...';

    // データの要約 (ランダム30件)
    const spotsList = gatheredSpots
        .sort(() => 0.5 - Math.random())
        .slice(0, 30)
        .map(s => `- [${s.source}] ${s.type}: ${s.name}`)
        .join("\n");

    const prompt = `
あなたは呉市の観光ガイドです。以下のリアルタイムデータから散歩プランを作成してください。
【状況】天気: ${weatherDescription} / 気分・テーマ: ${mood}
【周辺スポット】
${spotsList}
【指令】
1. 天気と気分に合う「散歩テーマ」
2. [KureOfficial]を含む3つのルート提案
3. 情緒的な解説
`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const result = await res.json();
        const text = result.candidates[0].content.parts[0].text;
        document.getElementById('ai-response').innerHTML = marked.parse(text);
    } catch(e) {
        document.getElementById('ai-response').innerHTML = "AIエラー: " + e.message;
    }
}