import os
import json
import sqlite3
import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_methods=["*"],
    allow_headers=["*"],
)

API_KEY = os.environ.get("GEMINI_API_KEY")
client = genai.Client(api_key=API_KEY) if API_KEY else None

class TravelLog(BaseModel):
    country: str
    region: str
    ranking: int
    days: int

class RecommendRequest(BaseModel):
    logs: list[TravelLog]

conn = sqlite3.connect('geocode_cache.db', check_same_thread=False)
cursor = conn.cursor()
cursor.execute('''CREATE TABLE IF NOT EXISTS cache (query_url TEXT PRIMARY KEY, response_json TEXT)''')
conn.commit()

async def fetch_from_nominatim(url: str):
    cursor.execute('SELECT response_json FROM cache WHERE query_url = ?', (url,))
    cached_data = cursor.fetchone()
    if cached_data: return json.loads(cached_data[0])
    
    headers = {"User-Agent": "StrategicTravelCommand/1.0"}
    async with httpx.AsyncClient() as client_http:
        response = await client_http.get(url, headers=headers)
        if response.status_code == 200:
            data = response.json()
            cursor.execute('INSERT INTO cache (query_url, response_json) VALUES (?, ?)', (url, json.dumps(data)))
            conn.commit()
            return data
        else:
            raise HTTPException(status_code=response.status_code, detail="OSM Error")

@app.post("/api/recommend")
async def get_ai_recommendation(data: RecommendRequest):
    if not client: raise HTTPException(status_code=500, detail="API Key is missing")
    if not data.logs: raise HTTPException(status_code=400, detail="No data")
    
    history_text = "\n".join([f"- 國家:{log.country}, 據點:{log.region}, 停留:{log.days}天, 排名:No.{log.ranking}" for log in data.logs])
    prompt = f"""你是一位全球戰略旅遊分析師。分析出征紀錄：\n{history_text}\n任務：\n1. 排名越小越喜歡。停留越長代表越深度。\n2. 總結偏好。\n3. 推薦「下一個最該去」的未造訪國家與城市。\n4. 給出精準理由。\n嚴格輸出 JSON：\n{{"analysis":"一句話總結","recommend_country":"國家","recommend_city":"城市","reason":"30字理由"}}"""

    try:
        response = client.models.generate_content(model='gemini-2.5-flash', contents=prompt)
        text = response.text.strip().strip('`')
        if text.lower().startswith('json'): text = text[4:].strip()
        return json.loads(text)
    except Exception as e:
        print(f"AI Error: {e}")
        raise HTTPException(status_code=500, detail="AI Error")

@app.get("/api/search")
async def search_location(q: str = Query(..., min_length=2)):
    return await fetch_from_nominatim(f"https://nominatim.openstreetmap.org/search?q={q}&format=json&addressdetails=1&limit=5")

@app.get("/api/boundary")
async def get_boundary(region: str, country: str):
    return await fetch_from_nominatim(f"https://nominatim.openstreetmap.org/search?q={region}, {country}&format=json&limit=1&polygon_geojson=1&polygon_threshold=0.005")