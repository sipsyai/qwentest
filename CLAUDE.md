# Forge AI Studio - Proje Rehberi

## Genel Bakis
vLLM uzerinde calisan Qwen3-4B ve Nomic Embed modelleri icin React tabanli AI arabirimi.

## Proje Yapisi
- `forge-ai-studio/` - Ana React uygulamasi (Vite + TypeScript)
  - `pages/` - Playground, Models, ModelDetail, Embeddings, Datasets, DatasetRecords, Agents, History, Settings
  - `services/` - vllm.ts, kbApi.ts, settingsApi.ts, historyApi.ts, datasetsApi.ts, agentsApi.ts, embedUtils.ts, rag.ts, markdown.ts, mockData.ts
  - `components/` - Sidebar.tsx
- `kb-service/` - FastAPI + pgvector Knowledge Base backend (main.py, database.py, models.py)
- `docker-compose.yml` - pgvector PostgreSQL container
- `docs/api/` - vLLM API dokumantasyonu (chat-completions, embeddings, completions, tool-calling, tokenizer, qwen3-thinking, health, models)
- `docs/app/` - Uygulama dokumantasyonu
- `docs/database/SCHEMA.md` - Database sema dokumantasyonu (tablolar, indexler, iliskiler, API mapping)
- `test-api.py` - API test scripti (health, chat, thinking, completions, embed, tokenizer, streaming, edge)

## Servisler
- **vllm.ts**: Chat completion stream, embedding generation, model listesi, fallback URL support (fetchWithFallback)
- **kbApi.ts**: KB API client (addDocuments, getDocuments, searchSimilar, deleteDocument, bulkDelete, clearAll, getStats, duplicate handling)
- **datasetsApi.ts**: Datasets + records API client (CRUD, fetch proxy, records save/delete, embed records, search records)
- **embedUtils.ts**: Shared embedding utilities (batch embed with progress, chunked text processing)
- **settingsApi.ts**: Settings persistence (in-memory cache + PostgreSQL)
- **historyApi.ts**: Request history persistence (PostgreSQL), detail view with request/response payloads, 50K response cap, agent/variables tracking
- **agentsApi.ts**: Agents CRUD client, extractVariables() utility, runAgent() SSE stream client
- **rag.ts**: RAG pipeline (embed query → pgvector search → context injection, `{{context}}` template variable support)
- **markdown.ts**: Think tag parser + markdown renderer
- **mockData.ts**: Test/demo verileri

## Sayfalar
- **Playground**: Chat arayuzu, streaming, think mode, RAG mode, configurable RAG params (top_k, similarity_threshold sliders), `{{context}}` template variable for custom RAG chunk placement
- **Models**: Model listesi ve detaylari
- **ModelDetail**: Tek model detay sayfasi
- **Embeddings**: Embedding olusturma + Knowledge Base kaydetme, configurable search params (top_k, similarity_threshold sliders), multi-select source chip filtering for KB semantic search
- **Datasets**: Generic REST API connector, manual JSON paste (no API needed), JSON drill-down explorer, array→tablo gorunum, save selected, field extraction config (array_path + extract_fields), extract & save all, manual fetch
- **DatasetRecords**: Kaydedilen dataset kayitlari (/dataset-records), filter, search, tablo gorunumu (otomatik kolon turetme), embed pipeline (tag-based field selection, batch embed with progress, embed status tracking)
- **Agents**: Saved agent cards with Run/Edit/Delete, direct execution via streaming Run modal (variable inputs, markdown output, think tags, copy/stop), promptTemplate preview + variable badges
- **History**: Istek gecmisi goruntuleme, expand/collapse detail panel (request payload: messages + params + RAG config, response payload: full text)
- **Settings**: API URL, model, parametre ayarlari, fallback URL konfigurasyonu

## Dev Ortami

### Network IP'leri
| Ortam | Local IP | Tailscale IP |
|-------|----------|--------------|
| ubuntu-gpu | 192.168.1.8 | 100.96.50.76 |

### Servis Portlari ve URL'leri
| Servis | Port | Local URL | Tailscale URL | Proxy |
|--------|------|-----------|---------------|-------|
| vLLM Chat API | 8010 | http://192.168.1.8:8010/v1 | http://100.96.50.76:8010/v1 | /api/chat |
| vLLM Embed API | 8011 | http://192.168.1.8:8011/v1 | http://100.96.50.76:8011/v1 | /api/embed |
| KB API (FastAPI) | 8833 | http://localhost:8833 | - (sadece local) | /api/kb |
| Frontend (Vite) | 3000 | http://localhost:3000 | - | - |

## Servis Baslatma / Durdurma
- `./start.sh` - KB servisi (port 8833) + Frontend (port 3000) baslatir
- `./stop.sh` - Tum servisleri durdurur
- PID dosyalari: `.kb-service.pid`, `.frontend.pid`
- Loglar: `/tmp/kb-service.log`, `/tmp/frontend.log`

## Slash Komutlari
- `/test-api` - vLLM API testlerini calistir ve rapor olustur
- `/commit-push` - Commit + push + CHANGELOG + docs + CLAUDE.md otomatik guncelle

## Teknoloji Stack
- React 19 + TypeScript + Vite
- React Router DOM (SPA routing)
- Lucide React (ikonlar)
- PostgreSQL + pgvector (Knowledge Base backend)
- FastAPI (kb-service)
- PostgreSQL (settings + history + datasets persistence)
- httpx (async HTTP client, backend fetch proxy)

## Database
- 6 tablo: `kb_documents`, `app_settings`, `request_history`, `datasets`, `dataset_records`, `saved_agents`
- Detayli sema: `docs/database/SCHEMA.md`
