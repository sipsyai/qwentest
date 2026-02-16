# Tokenizer API

Metin ↔ token ID dönüşümleri. Prompt uzunluğu hesaplama ve debug için kullanışlıdır.

**Sunucu:** `http://localhost:8010`

---

## POST /tokenize

Metni token ID listesine çevirir.

### Parametreler

| Parametre | Tip | Varsayılan | Zorunlu | Açıklama |
|-----------|-----|------------|---------|----------|
| `model` | string | `Qwen/Qwen3-4B` | hayır | Model adı |
| `prompt` | string | - | prompt veya messages | Tokenize edilecek düz metin |
| `messages` | array | - | prompt veya messages | Chat mesajları (template uygulanır) |
| `add_generation_prompt` | boolean | true | hayır | Generation prompt ekle (messages ile) |
| `add_special_tokens` | boolean | false | hayır | BOS gibi özel tokenler eklensin mi |

### Yanıt

```json
{
  "tokens": [26716, 10573, 64, 129463],
  "count": 4,
  "max_model_len": 8192
}
```

| Alan | Tip | Açıklama |
|------|-----|----------|
| `tokens` | array[int] | Token ID listesi |
| `count` | integer | Token sayısı |
| `max_model_len` | integer | Model maksimum context uzunluğu |

### Örnekler

#### Düz Metin

```bash
curl http://localhost:8010/tokenize \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "prompt": "Merhaba dünya"
  }'
```

Yanıt: 4 token

#### Chat Mesajları (Template ile)

```bash
curl http://localhost:8010/tokenize \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "messages": [
      {"role": "system", "content": "Sen bir asistansın."},
      {"role": "user", "content": "Merhaba"}
    ],
    "add_generation_prompt": true,
    "add_special_tokens": false
  }'
```

Chat template uygulandığı için token sayısı daha fazla olur (`<|im_start|>`, `<|im_end|>` tokenler dahil).

---

## POST /detokenize

Token ID listesini metne çevirir.

### Parametreler

| Parametre | Tip | Varsayılan | Zorunlu | Açıklama |
|-----------|-----|------------|---------|----------|
| `model` | string | `Qwen/Qwen3-4B` | hayır | Model adı |
| `tokens` | array[int] | - | evet | Token ID listesi |

### Yanıt

```json
{
  "prompt": "Merhaba dünya"
}
```

### Örnek

```bash
curl http://localhost:8010/detokenize \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "tokens": [26716, 10573, 64, 129463]
  }'
```

---

## Kullanım Senaryoları

### Prompt Uzunluğu Kontrolü

```python
import requests

def count_tokens(text):
    r = requests.post("http://localhost:8010/tokenize", json={
        "model": "Qwen/Qwen3-4B",
        "prompt": text,
    })
    return r.json()["count"]

text = "Çok uzun bir metin..."
tokens = count_tokens(text)
max_len = 8192

if tokens > max_len:
    print(f"UYARI: {tokens} token, limit {max_len}")
else:
    print(f"OK: {tokens}/{max_len} token kullanılıyor")
```

### Chat Template Token Sayısı

```python
def count_chat_tokens(messages):
    r = requests.post("http://localhost:8010/tokenize", json={
        "model": "Qwen/Qwen3-4B",
        "messages": messages,
        "add_generation_prompt": True,
    })
    return r.json()["count"]

messages = [
    {"role": "system", "content": "Sen bir IT asistanısın."},
    {"role": "user", "content": "VPN sorunum var"},
]
print(f"Chat token sayısı: {count_chat_tokens(messages)}")
```
