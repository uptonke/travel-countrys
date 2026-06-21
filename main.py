import os
import json
import sqlite3
from urllib.parse import urlencode

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

NOMINATIM_BASE_URL = "https://nominatim.openstreetmap.org/search"
COUNTRY_CODE_MAP = {
    "china": "cn",
    "prc": "cn",
    "中國": "cn",
    "中国": "cn",
    "taiwan": "tw",
    "roc": "tw",
    "台灣": "tw",
    "臺灣": "tw",
    "japan": "jp",
    "thailand": "th",
    "singapore": "sg",
    "malaysia": "my",
    "united states": "us",
    "united states of america": "us",
    "usa": "us",
    "uk": "gb",
    "united kingdom": "gb",
    "france": "fr",
    "germany": "de",
    "italy": "it",
    "spain": "es",
    "netherlands": "nl",
    "portugal": "pt",
    "united arab emirates": "ae",
    "uae": "ae",
}

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

def normalize_text(value: str) -> str:
    return (value or "").strip()

def get_country_code(country: str) -> str | None:
    return COUNTRY_CODE_MAP.get(normalize_text(country).lower())

def build_nominatim_url(params: dict) -> str:
    base_params = {
        "format": "json",
        "addressdetails": 1,
        "limit": 5,
        "polygon_geojson": 1,
        "polygon_threshold": 0.005,
    }
    base_params.update({k: v for k, v in params.items() if v not in (None, "")})
    return f"{NOMINATIM_BASE_URL}?{urlencode(base_params)}"

async def fetch_from_nominatim(url: str):
    cursor.execute('SELECT response_json FROM cache WHERE query_url = ?', (url,))
    cached_data = cursor.fetchone()
    if cached_data:
        return json.loads(cached_data[0])

    headers = {
        "User-Agent": "StrategicTravelCommand/1.0 (uptonke7@gmail.com)",
        "Accept-Language": "en,zh-TW;q=0.8,zh;q=0.7",
    }
    async with httpx.AsyncClient(timeout=25.0) as client_http:
        response = await client_http.get(url, headers=headers)
        if response.status_code == 200:
            data = response.json()
            cursor.execute(
                'INSERT OR REPLACE INTO cache (query_url, response_json) VALUES (?, ?)',
                (url, json.dumps(data, ensure_ascii=False))
            )
            conn.commit()
            return data
        raise HTTPException(status_code=response.status_code, detail="OSM Error")

def sort_geocode_results(results: list[dict], region: str) -> list[dict]:
    region_lower = normalize_text(region).lower()

    def score(item: dict) -> int:
        score_value = 0
        name = normalize_text(item.get("name") or item.get("display_name")).lower()
        geojson = item.get("geojson") or {}
        if region_lower and region_lower in name:
            score_value += 4
        if geojson.get("type") in {"Polygon", "MultiPolygon"}:
            score_value += 3
        if item.get("class") == "boundary" or item.get("type") in {"administrative", "city", "municipality"}:
            score_value += 2
        if item.get("lat") and item.get("lon"):
            score_value += 1
        return score_value

    return sorted(results, key=score, reverse=True)

async def query_location_candidates(region: str, country: str) -> list[dict]:
    region = normalize_text(region)
    country = normalize_text(country)
    country_code = get_country_code(country)

    query_variants = [
        {"city": region, "country": country, "countrycodes": country_code},
        {"q": f"{region}, {country}", "countrycodes": country_code},
        {"q": f"{region} city, {country}", "countrycodes": country_code},
        {"q": region, "countrycodes": country_code},
        {"q": f"{region}, {country}"},
    ]

    seen_urls = set()
    for params in query_variants:
        url = build_nominatim_url(params)
        if url in seen_urls:
            continue
        seen_urls.add(url)
        data = await fetch_from_nominatim(url)
        if data:
            return sort_geocode_results(data, region)
    return []

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
    url = build_nominatim_url({"q": q, "limit": 5})
    return await fetch_from_nominatim(url)

@app.get("/api/boundary")
async def get_boundary(region: str, country: str):
    return await query_location_candidates(region, country)
