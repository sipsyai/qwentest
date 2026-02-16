# POST /v1/completions

Ham metin tamamlama. Chat formatı yerine düz prompt kullanır.

**Sunucu:** `http://localhost:8010`

---

## Parametreler

### Zorunlu

| Parametre | Tip | Açıklama |
|-----------|-----|----------|
| `prompt` | string\|array[string] | Tamamlanacak metin. Array ile batch destekler |

### Model

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `model` | string | `Qwen/Qwen3-4B` | Model adı |

### Üretim Kontrolleri

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `max_tokens` | integer | 16 | Maksimum üretilecek token sayısı |
| `min_tokens` | integer | 0 | Minimum üretilecek token |
| `n` | integer | 1 | Kaç farklı tamamlama üretilecek |

### Sampling

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `temperature` | number\|null | model default | Rastgelelik (0.0-2.0). **0 kullanmayın** |
| `top_p` | number\|null | model default | Nucleus sampling eşiği |
| `top_k` | integer\|null | null | Top-K sampling. 20 önerilir |
| `min_p` | number\|null | null | Minimum olasılık eşiği |
| `seed` | integer\|null | null | Tekrarlanabilir sonuçlar için seed |

### Penaltiler

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `frequency_penalty` | number | 0.0 | Frekans cezası (-2.0 ~ 2.0) |
| `presence_penalty` | number | 0.0 | Mevcudiyet cezası (-2.0 ~ 2.0) |
| `repetition_penalty` | number\|null | null | Tekrar çarpanı (1.0 = yok) |
| `length_penalty` | number | 1.0 | Uzunluk cezası (beam search) |

### Stop Kontrolleri

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `stop` | string\|array | [] | Durma string(ler)i |
| `stop_token_ids` | array[int] | [] | Durma token ID'leri |
| `include_stop_str_in_output` | boolean | false | Stop stringi çıktıya dahil |
| `ignore_eos` | boolean | false | EOS'u görmezden gel |

### Streaming

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `stream` | boolean | false | SSE stream |
| `stream_options` | object\|null | null | `{"include_usage": true}` |

### Çıktı Formatı

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `response_format` | object\|null | null | `{"type":"json_object"}` ile JSON çıktı |

### Logprobs

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `logprobs` | integer\|null | null | Döndürülecek logprob sayısı |
| `prompt_logprobs` | integer\|null | null | Prompt tokenlerinin logprob'ları |

### Gelişmiş

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `echo` | boolean | false | Prompt'u da çıktıya dahil et |
| `suffix` | string\|null | null | Tamamlamanın ardına ek metin |
| `user` | string\|null | null | Kullanıcı ID (loglama) |
| `priority` | integer | 0 | İstek önceliği |
| `add_special_tokens` | boolean | true | BOS gibi özel tokenler eklensin mi |
| `skip_special_tokens` | boolean | true | Çıktıda özel tokenler atlanır |
| `truncate_prompt_tokens` | integer\|null | null | Prompt'u N tokene kırp |
| `use_beam_search` | boolean | false | Beam search (deneysel) |

---

## Yanıt Formatı

```json
{
  "id": "cmpl-abc123",
  "object": "text_completion",
  "created": 1771266744,
  "model": "Qwen/Qwen3-4B",
  "choices": [
    {
      "index": 0,
      "text": " Ankara'dır.",
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 5,
    "completion_tokens": 4,
    "total_tokens": 9
  }
}
```

---

## Örnekler

### 1. Basit Tamamlama

```bash
curl http://localhost:8010/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "prompt": "Türkiye'\''nin başkenti",
    "max_tokens": 50,
    "temperature": 0.7,
    "top_p": 0.8,
    "top_k": 20
  }'
```

### 2. Batch Tamamlama (Çoklu Prompt)

```bash
curl http://localhost:8010/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "prompt": [
      "Yapay zeka nedir?",
      "Makine öğrenmesi nedir?"
    ],
    "max_tokens": 100,
    "temperature": 0.7,
    "n": 1
  }'
```

### 3. Echo ile (Prompt Dahil)

```bash
curl http://localhost:8010/v1/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "prompt": "Bir varmış bir yokmuş",
    "max_tokens": 200,
    "temperature": 0.8,
    "echo": true
  }'
```

### 4. Python SDK

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8010/v1", api_key="not-needed")

response = client.completions.create(
    model="Qwen/Qwen3-4B",
    prompt="Türkiye'nin en büyük şehri",
    max_tokens=50,
    temperature=0.7,
)
print(response.choices[0].text)
```
