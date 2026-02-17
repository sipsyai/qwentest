# vLLM API Dokümantasyonu

Qwen3-4B (Chat) ve Nomic Embed Text v1.5 (Embedding) modelleri için OpenAI-uyumlu API referansı.

## Sunucular

| Servis | Model | Port | VRAM | Max Context |
|--------|-------|------|------|-------------|
| **vllm-chat** | `Qwen/Qwen3-4B` (FP16) | 8010 | ~8 GB | 8192 token |
| **vllm-embed** | `nomic-ai/nomic-embed-text-v1.5` (FP16) | 8011 | ~700 MB | 2048 token |

## Bağlantı

```
# Yerel
http://localhost:8010/v1    # Chat
http://localhost:8011/v1    # Embedding

# Uzak
http://31.206.209.189:8010/v1
http://31.206.209.189:8011/v1
```

Kimlik doğrulama gerekmez. `api_key` herhangi bir değer alabilir.

## Endpoint Listesi

### Chat & Completions (port 8010)

| Endpoint | Dosya | Açıklama |
|----------|-------|----------|
| `POST /v1/chat/completions` | [chat-completions.md](chat-completions.md) | Mesaj tabanlı chat yanıtı üretme |
| `POST /v1/completions` | [completions.md](completions.md) | Ham metin tamamlama |

### Embeddings (port 8011)

| Endpoint | Dosya | Açıklama |
|----------|-------|----------|
| `POST /v1/embeddings` | [embeddings.md](embeddings.md) | Metin → vektör dönüşümü |

### Models & Health (her iki port)

| Endpoint | Dosya | Açıklama |
|----------|-------|----------|
| `GET /v1/models` | [models.md](models.md) | Yüklü model listesi |
| `GET /health` | [health.md](health.md) | Sağlık kontrolü |
| `GET /version` | [health.md](health.md#version) | Versiyon bilgisi |
| `GET /metrics` | [health.md](health.md#metrics) | Prometheus metrikleri |

### Tokenizer (port 8010)

| Endpoint | Dosya | Açıklama |
|----------|-------|----------|
| `POST /tokenize` | [tokenizer.md](tokenizer.md) | Metin → token ID |
| `POST /detokenize` | [tokenizer.md](tokenizer.md#detokenize) | Token ID → metin |

### Qwen3 Özel

| Konu | Dosya | Açıklama |
|------|-------|----------|
| Thinking Mode | [qwen3-thinking.md](qwen3-thinking.md) | Düşünme modu kontrolü |
| Tool Calling | [tool-calling.md](tool-calling.md) | Fonksiyon çağırma |

## Frontend Entegrasyonu

Forge AI Studio frontend'i (`forge-ai-studio/`) bu API'leri Vite proxy üzerinden kullanır:

| Proxy Yolu | Hedef | Kullanım |
|------------|-------|----------|
| `/api/chat` | `http://192.168.1.8:8010/v1` | Chat completion (streaming) |
| `/api/embed` | `http://192.168.1.8:8011/v1` | Embedding üretimi |
| `/api/kb` | `http://localhost:8833` | Knowledge Base (pgvector) |
| `/api/strapi` | `https://strapi.sipsy.ai` | Strapi CMS veri çekme |

**Önemli notlar:**
- Tüm chat istekleri **her zaman streaming** gider (`stream: true` hardcoded). UI'da stream toggle var ama API isteğine etkisi yok.
- `stream_options` gönderilmediğinden streaming yanıtlarda usage/token istatistikleri dönmez.
- Fallback URL desteği var — birincil URL başarısız olursa (`TypeError` network hatası) otomatik olarak yedek URL denenir.
- `chat_template_kwargs` her istekte explicit gönderilir (thinking durumu ne olursa olsun).
- Detaylı frontend request örnekleri: [chat-completions.md — Frontend Kullanımı](chat-completions.md#frontend-kullanımı-playground)

## Python SDK

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8010/v1", api_key="not-needed")
embed_client = OpenAI(base_url="http://localhost:8011/v1", api_key="not-needed")
```
