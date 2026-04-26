import os
import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

app = FastAPI(title="Local SLM API")

BASE_MODEL = os.environ.get("BASE_MODEL", "meta-llama/Llama-3.2-3B-Instruct")
ADAPTER_DIR = os.environ.get("ADAPTER_DIR", "./slm-finetuned-final")

tokenizer = None
model = None

@app.on_event("startup")
def load_model():
    global tokenizer, model
    print(f"Loading base model: {BASE_MODEL}")
    try:
        tokenizer = AutoTokenizer.from_pretrained(ADAPTER_DIR, trust_remote_code=True)
    except Exception:
        # Fallback if tokenizer not fully present in adapter dir
        tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
        
    target_device = "cpu" # Force CPU since 6GB GPU runs out of memory
    base_model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL,
        torch_dtype=torch.float16,
        device_map={"": target_device},
        trust_remote_code=True
    )
    
    print(f"Loading LoRA adapter from: {ADAPTER_DIR}")
    model = PeftModel.from_pretrained(base_model, ADAPTER_DIR)
    model.eval()
    print("Model loaded successfully!")

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatCompletionRequest(BaseModel):
    model: str
    messages: List[ChatMessage]
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 500
    top_p: Optional[float] = 0.9

@app.get("/models")
async def get_models():
    return {
        "object": "list",
        "data": [
            {
                "id": "llama3.2:3b",
                "object": "model",
                "created": 1690000000,
                "owned_by": "organization"
            }
        ]
    }

@app.post("/chat/completions")
def chat_completions(req: ChatCompletionRequest):
    if not model or not tokenizer:
        raise HTTPException(status_code=503, detail="Model is still loading")

    messages = [{"role": msg.role, "content": msg.content} for msg in req.messages]
    
    prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=req.max_tokens or 500,
            temperature=req.temperature if req.temperature is not None else 0.7,
            top_p=req.top_p if req.top_p is not None else 0.9,
            pad_token_id=tokenizer.eos_token_id,
            do_sample=True if (req.temperature and req.temperature > 0) else False
        )
        
    generated_ids = outputs[0][inputs["input_ids"].shape[-1]:]
    response_text = tokenizer.decode(generated_ids, skip_special_tokens=True)
    
    return {
        "id": "chatcmpl-123",
        "object": "chat.completion",
        "created": 1690000000,
        "model": req.model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": response_text
                },
                "finish_reason": "stop"
            }
        ],
        "usage": {
            "prompt_tokens": inputs["input_ids"].shape[-1],
            "completion_tokens": len(generated_ids),
            "total_tokens": inputs["input_ids"].shape[-1] + len(generated_ids)
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
