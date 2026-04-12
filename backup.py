import os
import json
from datetime import datetime
from supabase import create_client, Client

url = os.environ.get("SUPABASE_URL")
key = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(url, key)

# 獲取資料
response = supabase.table("travel_logs").select("*").execute()
data = response.data

# 寫入 JSON 檔案
filename = f"backups/travel_log_{datetime.now().strftime('%Y%m%d')}.json"
os.makedirs("backups", exist_ok=True)
with open(filename, 'w', encoding='utf-8') as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print(f"✅ 戰略日誌已備份至 {filename}")
