import os
import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import google.generativeai as genai

# 1. 初始化 FastAPI
app = FastAPI()

# 設定 CORS，讓前端 (localhost) 可以跨域呼叫這個 API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # 實戰中建議改成前端的實際網址
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. 設定 AI 模型 (需先至 Google AI Studio 申請免費 API Key)
# 請在終端機輸入: export GEMINI_API_KEY="你的_API_KEY"
api_key = os.environ.get("GEMINI_API_KEY")
if not api_key:
    print("⚠️ 警告：未設定 GEMINI_API_KEY 環境變數")
genai.configure(api_key=api_key)
model = genai.GenerativeModel('gemini-1.5-flash')

# 3. 定義前端傳來的資料結構
class TravelLog(BaseModel):
    country: str
    region: str
    ranking: int
    days: int

class RecommendRequest(BaseModel):
    logs: list[TravelLog]

# 4. 建立 AI 推薦 API 端點
@app.post("/api/recommend")
async def get_ai_recommendation(data: RecommendRequest):
    if not data.logs:
        raise HTTPException(status_code=400, detail="無戰報數據，無法進行分析")

    # 將數據轉換為 AI 容易理解的格式
    history_text = "\n".join(
        [f"- 國家: {log.country}, 據點: {log.region}, 停留: {log.days}天, 喜好排名: No.{log.ranking}" for log in data.logs]
    )

    # 刻劃 Prompt 系統提示詞
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
        # 呼叫大模型
        response = model.generate_content(prompt)
        result_text = response.text.strip()
        
        # 清理可能帶有的 markdown 標籤
        if result_text.startswith("```json"):
            result_text = result_text[7:-3]
        elif result_text.startswith("```"):
            result_text = result_text[3:-3]
            
        return json.loads(result_text)
    
    except Exception as e:
        print(f"AI 運算失敗: {e}")
        raise HTTPException(status_code=500, detail="戰略中樞連線異常或 AI 演算失敗")
