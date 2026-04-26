import httpx
import time

max_retries = 5
for _ in range(max_retries):
    try:
        r = httpx.post("http://127.0.0.1:8001/chat/completions", json={
            "model": "llama3.2:3b",
            "messages": [{"role": "user", "content": "hello how are you"}]
        }, timeout=60.0)
        print("Status", r.status_code)
        print(r.text)
        break
    except Exception as e:
        print("Error", e)
        time.sleep(2)
