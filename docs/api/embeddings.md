# POST /v1/embeddings

Metin(ler)i 768 boyutlu vektöre dönüştürür. Semantic search, RAG ve benzerlik analizi için kullanılır.

**Sunucu:** `http://localhost:8011`
**Model:** `nomic-ai/nomic-embed-text-v1.5`
**Vektör boyutu:** 768
**Max input:** 2048 token

---

## Parametreler

### Zorunlu

| Parametre | Tip | Açıklama |
|-----------|-----|----------|
| `input` | string\|array[string] | Embed edilecek metin(ler). Tek string veya array |

### Model

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `model` | string | `nomic-ai/nomic-embed-text-v1.5` | Model adı |

### Encoding

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `encoding_format` | string | `"float"` | `"float"` (JSON array) veya `"base64"` (binary, daha kompakt) |
| `embed_dtype` | string | `"float32"` | Veri tipi: `float32`, `float16`, `bfloat16`, `uint8`, `int8`, `binary`, `ubinary` |
| `endianness` | string | `"native"` | Base64 byte sırası: `"native"`, `"little"`, `"big"` |

### Vektör Kontrolü

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `dimensions` | integer\|null | null (768) | Çıktı vektör boyutu. null = model varsayılanı |
| `normalize` | boolean\|null | true | L2 normalizasyon. Cosine similarity için true olmalı |

### Gelişmiş

| Parametre | Tip | Varsayılan | Açıklama |
|-----------|-----|------------|----------|
| `add_special_tokens` | boolean | true | BOS/EOS özel tokenler eklensin mi |
| `truncate_prompt_tokens` | integer\|null | null | Girdiyi N tokene kırp |
| `priority` | integer | 0 | İstek önceliği |
| `user` | string\|null | null | Kullanıcı ID (loglama) |

---

## Yanıt Formatı

### Float encoding

```json
{
  "id": "embd-abc123",
  "object": "list",
  "model": "nomic-ai/nomic-embed-text-v1.5",
  "data": [
    {
      "index": 0,
      "object": "embedding",
      "embedding": [0.099, -0.436, -3.661, 0.795, ...]
    }
  ],
  "usage": {
    "prompt_tokens": 5,
    "total_tokens": 5
  }
}
```

### Base64 encoding

```json
{
  "data": [
    {
      "index": 0,
      "object": "embedding",
      "embedding": "mrHMPTNj376aWWrAM6NLP2amPT8AZmG+..."
    }
  ]
}
```

---

## Örnekler

### 1. Tek Metin

```bash
curl http://localhost:8011/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nomic-ai/nomic-embed-text-v1.5",
    "input": "Yazıcı kağıt sıkışması çözümü"
  }'
```

### 2. Batch Embedding (Çoklu Metin)

```bash
curl http://localhost:8011/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nomic-ai/nomic-embed-text-v1.5",
    "input": [
      "Yazıcı kağıt sıkışması",
      "VPN bağlantı problemi",
      "E-posta şifre sıfırlama",
      "Monitör görüntü yok"
    ],
    "encoding_format": "float"
  }'
```

### 3. Base64 Format

```bash
curl http://localhost:8011/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nomic-ai/nomic-embed-text-v1.5",
    "input": "test metni",
    "encoding_format": "base64"
  }'
```

### 4. Cosine Similarity (Python)

```python
from openai import OpenAI
import numpy as np

client = OpenAI(base_url="http://localhost:8011/v1", api_key="not-needed")

texts = ["Yazıcı kağıt sıkışması", "Printer paper jam", "VPN bağlantı sorunu"]

result = client.embeddings.create(
    model="nomic-ai/nomic-embed-text-v1.5",
    input=texts,
)

vecs = [np.array(d.embedding) for d in result.data]

# Cosine similarity
for i in range(len(texts)):
    for j in range(i + 1, len(texts)):
        sim = np.dot(vecs[i], vecs[j]) / (np.linalg.norm(vecs[i]) * np.linalg.norm(vecs[j]))
        print(f'"{texts[i]}" <-> "{texts[j]}": {sim:.4f}')
```

### 5. Performans

| Metrik | Değer |
|--------|-------|
| Tek metin latency | ~10ms |
| Batch 4 metin | ~9ms |
| Vektör boyutu | 768 |
| Max input token | 2048 |
