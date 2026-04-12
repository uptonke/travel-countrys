import os
import json
import sqlite3
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai

# ==========================================
# 1. 初始化 FastAPI 與 CORS
# ==========================================
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # 實戰中若部署到雲端，務必鎖定為你前端的實際網址
    allow_methods=["*"],
    allow_headers=["*"],
)

# ==========================================
# 2. 設定 AI 模型 (Gemini)
# ==========================================
api_key = os.environ.get("GEMINI_API_KEY")
if not api_key:
    print("⚠️ 警告：未設定 GEMINI_API_KEY 環境變數，AI 預測功能將無法運作")
else:
    genai.configure(api_key=api_key)

model = genai.GenerativeModel('gemini-1.5-flash')

class TravelLog(BaseModel):
    country: str
    region: str
    ranking: int
    days: int

class RecommendRequest(BaseModel):
    logs: list[TravelLog]

# ==========================================
# 3. 建立地理搜尋快取資料庫 (SQLite)
# ==========================================
conn = sqlite3.connect('geocode_cache.db', check_same_thread=False)
cursor = conn.cursor()
cursor.execute('''
    CREATE TABLE IF NOT EXISTS cache (
        query_url TEXT PRIMARY KEY,
        response_json TEXT
    )
''')
conn.commit()

async def fetch_from_nominatim(url: str):
    """核心中繼站邏輯：先查本地快取，沒有再去 OSM 拿"""
    cursor.execute('SELECT response_json FROM cache WHERE query_url = ?', (url,))
    cached_data = cursor.fetchone()
    
    if cached_data:
        print(f"⚡ [Cache Hit] 秒回快取資料: {url}")
        return json.loads(cached_data[0])
    
    print(f"🐌 [Cache Miss] 向 OSM 發出請求: {url}")
    headers = {
        # 嚴格遵守 OSM 規範，避免 IP 被封鎖
        "User-Agent": "StrategicTravelCommand/1.0 (uptonke6@gmail.com)" 
    }
    
    async with httpx.AsyncClient() as client:
        response = await client.get(url, headers=headers)
        
        if response.status_code == 200:
            data = response.json()
            cursor.execute('INSERT INTO cache (query_url, response_json) VALUES (?, ?)', (url, json.dumps(data)))
            conn.commit()
            return data
        else:
            raise HTTPException(status_code=response.status_code, detail="OSM 伺服器拒絕請求")

# ==========================================
# 4. API 端點佈署
# ==========================================

@app.post("/api/recommend")
async def get_ai_recommendation(data: RecommendRequest):
    if not data.logs:
        raise HTTPException(status_code=400, detail="無戰報數據，無法進行分析")

    history_text = "\n".join(
        [f"- 國家: {log.country}, 據點: {log.region}, 停留: {log.days}天, 喜好排名: No.{log.ranking}" for log in data.logs]
    )

    prompt = f"""
    你是一位最高級別的全球戰略旅遊分析師。請分析該指揮官的歷史出征紀錄：
    
    【出征紀錄】
    {history_text}
    
    【分析任務】
    1. 排名越小代表越喜歡 (No.1 是最愛)。停留天數越長代表深度探索。
    2. 找出他的潛在偏好 (例如：偏好高度發展都會、或是熱帶海島、還是歷史古城？)。
    3. 推薦他「下一個最該解鎖的國家與城市」(必須是他沒去過的)。
    4. 給出精準的戰略理由。

    【輸出格式要求】
    你必須嚴格輸出 JSON 格式，不要包含任何 markdown 語法 (如 ```json) 或額外對話，只需輸出：
    {{
        "analysis": "一句話總結他的旅遊偏好",
        "recommend_country": "推薦國家",
        "recommend_city": "推薦據點",
        "reason": "30字以內的戰略推薦理由"
    }}
    """

    try:
        response = model.generate_content(prompt)
        result_text = response.text.strip()
        
        if result_text.startswith("```json"):
            result_text = result_text[7:-3]
        elif result_text.startswith("```"):
            result_text = result_text[3:-3]
            
        return json.loads(result_text)
    
    except Exception as e:
        print(f"AI 運算失敗: {e}")
        raise HTTPException(status_code=500, detail="戰略中樞連線異常或 AI 演算失敗")

@app.get("/api/search")
async def search_location(q: str = Query(..., min_length=2)):
    url = f"[https://nominatim.openstreetmap.org/search?q=](https://nominatim.openstreetmap.org/search?q=){q}&format=json&addressdetails=1&limit=5"
    return await fetch_from_nominatim(url)

@app.get("/api/boundary")
async def get_boundary(region: str, country: str):
    query_str = f"{region}, {country}"
    url = f"[https://nominatim.openstreetmap.org/search?q=](https://nominatim.openstreetmap.org/search?q=){query_str}&format=json&limit=1&polygon_geojson=1&polygon_threshold=0.005"
    return await fetch_from_nominatim(url)
