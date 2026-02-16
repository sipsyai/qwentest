# GET /v1/models

Sunucuda yüklü olan modelleri listeler.

**Sunucu:** Her iki port (8010 ve 8011)

---

## Parametreler

Yok.

---

## Yanıt Formatı

```json
{
  "object": "list",
  "data": [
    {
      "id": "Qwen/Qwen3-4B",
      "object": "model",
      "created": 1771268179,
      "owned_by": "vllm",
      "root": "Qwen/Qwen3-4B",
      "parent": null,
      "max_model_len": 8192,
      "permission": [
        {
          "id": "modelperm-abc123",
          "object": "model_permission",
          "created": 1771268179,
          "allow_create_engine": false,
          "allow_sampling": true,
          "allow_logprobs": true,
          "allow_search_indices": false,
          "allow_view": true,
          "allow_fine_tuning": false,
          "organization": "*",
          "group": null,
          "is_blocking": false
        }
      ]
    }
  ]
}
```

### Yanıt Alanları

| Alan | Tip | Açıklama |
|------|-----|----------|
| `id` | string | Model adı (API çağrılarında kullanılır) |
| `object` | string | Her zaman `"model"` |
| `created` | integer | Unix timestamp |
| `owned_by` | string | Her zaman `"vllm"` |
| `root` | string | Temel model adı |
| `max_model_len` | integer | Maksimum context uzunluğu (token) |
| `permission` | array | İzin bilgileri |

---

## Örnekler

### Chat Modeli (port 8010)

```bash
curl http://localhost:8010/v1/models
```

Yanıt: `Qwen/Qwen3-4B`, max_model_len: 8192

### Embedding Modeli (port 8011)

```bash
curl http://localhost:8011/v1/models
```

Yanıt: `nomic-ai/nomic-embed-text-v1.5`, max_model_len: 2048

### Python SDK

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8010/v1", api_key="not-needed")
models = client.models.list()

for model in models.data:
    print(f"{model.id} (max_len: {model.max_model_len})")
```
