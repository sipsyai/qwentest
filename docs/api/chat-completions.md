# POST /v1/chat/completions

Mesaj listesine göre model yanıtı üretir. Tool calling, streaming ve thinking mode destekler.

**Sunucu:** `http://localhost:8010`

---

## Parametreler

### Zorunlu

| Parametre | Tip | Açıklama |
|-----------|-----|----------|
| `messages` | array | Mesaj listesi. Her eleman `{role, content}` içerir. Roller: `system`, `user`, `assistant`, `tool` |

### Model

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `model` | string | `Qwen/Qwen3-4B` | Model adı |

### Üretim Kontrolleri

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `max_tokens` | integer\|null | model limiti | Maksimum üretilecek token sayısı |
| `max_completion_tokens` | integer\|null | null | `max_tokens` aliası (OpenAI uyumluluk) |
| `min_tokens` | integer | 0 | Minimum üretilecek token. Bu sayıya ulaşmadan stop/eos çalışmaz |
| `n` | integer | 1 | Kaç farklı tamamlama üretilecek |

### Sampling Parametreleri

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `temperature` | number\|null | model default | Rastgelelik (0.0-2.0). **Thinking ON: 0.6, OFF: 0.7 önerilir. 0 KULLANMAYIN!** |
| `top_p` | number\|null | model default | Nucleus sampling eşiği. **Thinking ON: 0.95, OFF: 0.8** |
| `top_k` | integer\|null | null | En yüksek olasılıklı K tokenden seçim. **Qwen3 için 20 önerilir** |
| `min_p` | number\|null | null | Minimum olasılık eşiği. **Qwen3 için 0 önerilir** |
| `seed` | integer\|null | null | Tekrarlanabilir sonuçlar için sabit seed |

### Penaltiler

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `frequency_penalty` | number | 0.0 | Sık tekrarlanan tokenlere ceza (-2.0 ~ 2.0). Tekrar azaltmak için 0.5 |
| `presence_penalty` | number | 0.0 | Daha önce görülen tokenlere ceza (-2.0 ~ 2.0). **Tekrar sorununda 1.5 kullanın** |
| `repetition_penalty` | number\|null | null | Tekrar cezası çarpanı (1.0 = ceza yok). 1.05 önerilir |
| `length_penalty` | number | 1.0 | Uzunluk cezası (beam search). >1.0 daha uzun, <1.0 daha kısa |

### Stop Kontrolleri

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `stop` | string\|array | [] | Üretimi durduracak string(ler) |
| `stop_token_ids` | array[int] | [] | Üretimi durduracak token ID'leri |
| `include_stop_str_in_output` | boolean | false | Stop stringi çıktıya dahil edilsin mi |
| `ignore_eos` | boolean | false | EOS tokeni görmezden gel, max_tokens'a kadar üret |

### Streaming

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `stream` | boolean | false | SSE formatında parça parça yanıt |
| `stream_options` | object\|null | null | `{"include_usage": true}` ile stream sonunda usage bilgisi |

### Tool Calling

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `tools` | array\|null | null | Tool tanımları. Detay: [tool-calling.md](tool-calling.md) |
| `tool_choice` | string\|object | "none" | `"none"`, `"auto"`, `"required"` veya `{"type":"function","function":{"name":"..."}}` |
| `parallel_tool_calls` | boolean | true | Birden fazla toolu paralel çağırabilir mi |

### Çıktı Formatı

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `response_format` | object\|null | null | `{"type":"text"}`, `{"type":"json_object"}` veya `{"type":"json_schema","json_schema":{...}}` |

### Qwen3 Thinking Mode

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `chat_template_kwargs` | object\|null | null | `{"enable_thinking": false}` ile düşünme kapatılır. Detay: [qwen3-thinking.md](qwen3-thinking.md) |
| `reasoning_effort` | string\|null | null | `"low"`, `"medium"`, `"high"` - düşünme derinliği |
| `include_reasoning` | boolean | true | Thinking içeriği yanıtta gösterilsin mi |

### Logprobs

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `logprobs` | boolean | false | Token olasılıklarını döndür |
| `top_logprobs` | integer | 0 | Her pozisyonda en olası N tokenin logprob'u (0-20) |
| `prompt_logprobs` | integer\|null | null | Prompt tokenlerinin logprob'ları |

### Gelişmiş

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `echo` | boolean | false | Prompt'u da yanıta dahil et |
| `user` | string\|null | null | İstek sahibi kullanıcı ID'si (loglama) |
| `priority` | integer | 0 | İstek önceliği. Düşük = daha önce işlenir. Negatif = yüksek öncelik |
| `truncate_prompt_tokens` | integer\|null | null | Prompt'u N tokene kırp |
| `add_generation_prompt` | boolean | true | Generation prompt'u şablona ekle |
| `continue_final_message` | boolean | false | Son assistant mesajını devam ettir |
| `add_special_tokens` | boolean | false | BOS gibi özel tokenler eklensin mi |
| `skip_special_tokens` | boolean | true | Çıktıda özel tokenler atlanır |
| `spaces_between_special_tokens` | boolean | true | Özel tokenler arasına boşluk |
| `chat_template` | string\|null | null | Özel Jinja2 chat template |
| `logit_bias` | object\|null | null | Token ID → bias. Belirli tokenlerin olasılığını değiştir |
| `allowed_token_ids` | array[int]\|null | null | Sadece bu tokenlerden üretim yap |
| `bad_words` | array[string] | [] | Üretilmemesi gereken kelimeler |
| `use_beam_search` | boolean | false | Beam search kullan (deneysel) |
| `cache_salt` | string\|null | null | Prefix cache ayırma tuzu |

---

## Yanıt Formatı

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1771266744,
  "model": "Qwen/Qwen3-4B",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Yanıt metni",
        "tool_calls": []
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 15,
    "completion_tokens": 10,
    "total_tokens": 25
  }
}
```

### `finish_reason` Değerleri

| Değer | Açıklama |
|-------|----------|
| `stop` | Normal tamamlandı (EOS veya stop stringi) |
| `length` | `max_tokens`'a ulaşıldı |
| `tool_calls` | Tool çağrısı yapıldı |

---

## Örnekler

### 1. Basit Chat (Thinking Kapalı)

```bash
curl http://localhost:8010/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "messages": [
      {"role": "system", "content": "Sen yardımcı bir IT asistanısın. Türkçe yanıt ver."},
      {"role": "user", "content": "VPN bağlanamıyorum"}
    ],
    "max_tokens": 512,
    "temperature": 0.7,
    "top_p": 0.8,
    "top_k": 20,
    "chat_template_kwargs": {"enable_thinking": false}
  }'
```

### 2. Thinking Mode (Derin Düşünme)

```bash
curl http://localhost:8010/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "messages": [
      {"role": "user", "content": "Bu SQL sorgusunu optimize et: SELECT * FROM tickets WHERE status='\''open'\'' ORDER BY created_at"}
    ],
    "max_tokens": 2048,
    "temperature": 0.6,
    "top_p": 0.95,
    "top_k": 20
  }'
```

Yanıt:
```
<think>
Okay, I need to optimize this SQL query...
</think>

SQL sorgusunun optimize edilmesi için indeks oluşturma...
```

### 3. /no_think Soft Switch

```bash
curl http://localhost:8010/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "messages": [
      {"role": "user", "content": "Merhaba, nasılsın? /no_think"}
    ],
    "max_tokens": 256,
    "temperature": 0.6,
    "top_p": 0.95
  }'
```

### 4. Streaming (SSE)

```bash
curl -N http://localhost:8010/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "messages": [{"role": "user", "content": "Yapay zeka nedir?"}],
    "max_tokens": 512,
    "temperature": 0.7,
    "top_p": 0.8,
    "stream": true,
    "stream_options": {"include_usage": true}
  }'
```

SSE formatında her satır:
```
data: {"id":"...","choices":[{"delta":{"content":"parça"},...}],...}
data: {"id":"...","usage":{"prompt_tokens":11,"completion_tokens":100,"total_tokens":111}}
data: [DONE]
```

### 5. Tool Calling

```bash
curl http://localhost:8010/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "messages": [
      {"role": "system", "content": "Sen bir IT destek asistanısın."},
      {"role": "user", "content": "Yazıcım çalışmıyor, ticket aç /no_think"}
    ],
    "tools": [{
      "type": "function",
      "function": {
        "name": "create_ticket",
        "description": "IT destek talebi oluşturur",
        "parameters": {
          "type": "object",
          "properties": {
            "title": {"type": "string", "description": "Kısa başlık"},
            "description": {"type": "string", "description": "Detaylı açıklama"},
            "urgency": {"type": "string", "enum": ["low","medium","high","critical"]}
          },
          "required": ["title", "description"]
        }
      }
    }],
    "tool_choice": "auto",
    "parallel_tool_calls": true,
    "max_tokens": 512,
    "temperature": 0.6,
    "top_p": 0.95
  }'
```

### 6. Tool Sonucu ile Devam

```bash
curl http://localhost:8010/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "messages": [
      {"role": "system", "content": "Sen bir IT destek asistanısın. Türkçe yanıt ver."},
      {"role": "user", "content": "Yazıcım çalışmıyor"},
      {"role": "assistant", "content": "", "tool_calls": [{
        "id": "call_abc123",
        "type": "function",
        "function": {"name": "create_ticket", "arguments": "{\"title\":\"Yazıcı arızası\",\"description\":\"Yazıcı çalışmıyor\"}"}
      }]},
      {"role": "tool", "tool_call_id": "call_abc123", "content": "{\"success\": true, \"ticket_id\": 42}"}
    ],
    "max_tokens": 256,
    "temperature": 0.7
  }'
```

### 7. JSON Çıktı Formatı

```bash
curl http://localhost:8010/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "messages": [
      {"role": "user", "content": "İstanbul hakkında JSON: {\"city\": ..., \"population\": ..., \"country\": ...} /no_think"}
    ],
    "response_format": {"type": "json_object"},
    "max_tokens": 256,
    "temperature": 0.7
  }'
```

Yanıt:
```json
{"city": "İstanbul", "population": 15000000, "country": "Türkiye"}
```

### 8. Tekrar Düzeltme (Penalty)

```bash
curl http://localhost:8010/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "messages": [{"role": "user", "content": "Uzun bir hikaye yaz /no_think"}],
    "max_tokens": 1024,
    "temperature": 0.7,
    "top_p": 0.8,
    "presence_penalty": 1.5,
    "frequency_penalty": 0.5
  }'
```

### 9. Python SDK

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8010/v1", api_key="not-needed")

# Basit chat
response = client.chat.completions.create(
    model="Qwen/Qwen3-4B",
    messages=[
        {"role": "system", "content": "Sen bir IT asistanısın."},
        {"role": "user", "content": "VPN bağlanamıyorum"},
    ],
    max_tokens=512,
    temperature=0.7,
    top_p=0.8,
    extra_body={
        "top_k": 20,
        "chat_template_kwargs": {"enable_thinking": False},
    },
)
print(response.choices[0].message.content)

# Streaming
stream = client.chat.completions.create(
    model="Qwen/Qwen3-4B",
    messages=[{"role": "user", "content": "Merhaba"}],
    max_tokens=256,
    stream=True,
)
for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```
