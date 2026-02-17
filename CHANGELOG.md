# Changelog

Tum onemli degisiklikler bu dosyada belgelenir.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

## [0.10.0] - 2026-02-17

### Added
- Manual JSON dataset source: paste JSON directly without needing an API endpoint
- Source type picker dropdown (API Endpoint / Manual JSON) on "+" button
- `raw_data` JSONB column to datasets table (stores manually pasted JSON)

### Changed
- Dataset cards show purple "JSON" badge for manual datasets
- datasetsApi.ts: raw_data field in Dataset, DatasetCreate, DatasetUpdate interfaces
- kb-service: raw_data in all dataset SELECT/INSERT/UPDATE queries + _row_to_dataset_response

## [0.9.0] - 2026-02-17

### Added
- Dataset field extraction config: array_path + extract_fields kolonu, alan secimi toolbar
- "Extract & Save All" butonu: tum array elemanlarindan secili alanlari cikarip toplu kaydetme
- Manuel "Fetch" butonu: dataset verilerini yeniden cekme
- DatasetRecords tablo gorunumu: expand/collapse JSON listesi yerine duz tablo, kolon otomatik turetme
- `datasets` tablosuna `array_path` (TEXT) ve `extract_fields` (JSONB) kolonlari
- ALTER TABLE migration: mevcut datasets tablosuna yeni kolonlari ekler

### Changed
- DatasetRecords.tsx: Liste gorunumunden responsive tablo gorunumune gecis
- Datasets.tsx: Field extraction toolbar/config panel eklendi
- datasetsApi.ts: Dataset type'larina array_path, extract_fields alanlari
- kb-service: Dataset CRUD query'lerinde yeni kolonlar + _row_to_dataset_response helper

## [0.8.0] - 2026-02-17

### Added
- Generic REST API dataset connector (herhangi bir URL, GET/POST, token, custom headers)
- JSON drill-down explorer: breadcrumb navigation, object/array/primitive gorunum
- Array of objects → tablo gorunumu + satir secimi + "Save Selected"
- Dataset records sayfasi (/dataset-records): filter, search, expand/collapse, pagination
- Backend fetch proxy: CORS-free server-side URL fetch (httpx)
- 2 yeni DB tablosu: `datasets`, `dataset_records` (CASCADE delete)
- datasetsApi.ts: Full CRUD + fetch proxy + records API client
- 9 yeni backend endpoint (datasets CRUD + fetch + records CRUD)

### Removed
- Strapi bagimliligi tamamen kaldirildi (preset endpoints, v4 unwrap, pagination syntax)
- `/api/strapi` Vite proxy
- settingsApi ds_* defaults/getters (ds_api_url, ds_api_token, ds_endpoint)
- Eski dosyalar: ollama-playground.html, ollama-qwen3-4b-swagger.yaml, 8 screenshot PNG

### Changed
- Datasets.tsx: Strapi-only → generic 2-panel REST API connector + JSON explorer
- database.py: ds_* seed defaults kaldirildi
- Sidebar: "Saved Records" nav item eklendi

## [0.7.1] - 2026-02-17
### Changed
- docs/api/chat-completions.md: Sampling tablosuna "Frontend Default" kolonu + "Frontend Kullanimi (Playground)" section
- docs/api/qwen3-thinking.md: Onerilen parametreler tablosuna "Frontend Davranisi" kolonu + frontend notu
- docs/api/README.md: "Frontend Entegrasyonu" section eklendi

## [0.7.0] - 2026-02-17
### Removed
- localStorage: settings ve history icin localStorage tamamen kaldirildi
- settingsApi: localStorage read/write/migration fonksiyonlari
- historyApi: localStorage fallback (readLocalStorageHistory, LS_KEY)
- kb-service: /api/kb/settings/migrate endpoint

### Added
- start.sh: KB servisi + Frontend tek komutla baslatma
- stop.sh: Tum servisleri durdurma (PID + port fallback)

### Changed
- KB service port: 8012 → 8833
- settingsApi.ts: Pure DB + in-memory cache (localStorage yok)
- historyApi.ts: Pure DB (localStorage fallback yok)
- updateSettings: dbAvailable kontrolu kaldirildi, her zaman DB'ye yazar
- CLAUDE.md: IP tablosu, port guncelleme, script dokumantasyonu

## [0.6.0] - 2026-02-17
### Added
- PostgreSQL persistence: `app_settings` + `request_history` tablolari (kb-service/database.py)
- settingsApi.ts: In-memory cache + DB persistence, localStorage fallback
- historyApi.ts: Async DB-backed history API, localStorage fallback
- kb-service: 8 yeni endpoint (settings GET/PUT, history GET/POST/DELETE/clear)
- kb-service/models.py: 5 yeni Pydantic model (SettingItem, SettingsPayload, HistoryRecord, vb.)
- App.tsx: Init gate — settings + history localStorage → DB migration
- docs/database/SCHEMA.md: Database sema dokumantasyonu (3 tablo, indexler, iliskiler)

### Changed
- Settings.tsx: localStorage → settingsApi async save
- Datasets.tsx: localStorage → settingsApi import
- History.tsx: sync history.ts → async historyApi
- Playground.tsx: history.ts → historyApi import
- Embeddings.tsx: history.ts → historyApi import
- vllm.ts: localStorage getter/setter → settingsApi re-export

### Removed
- forge-ai-studio/services/history.ts (historyApi.ts ile replace edildi)
- forge-ai-studio/services/vectorStore.ts (dead code — pgvector ile replace edilmisti)

## [0.5.0] - 2026-02-17
### Added
- vLLM fallback URL destegi: fetchWithFallback helper, fallback getter/setter fonksiyonlari (vllm.ts)
- Settings: Fallback URL input alanlari (Chat API + Embed API)
- Vite proxy fallback mekanizmasi (local IP → Tailscale IP otomatik gecis)

### Changed
- Settings sayfa basligi "AI Configuration" olarak guncellendi

## [0.4.1] - 2026-02-16
### Fixed
- KB duplicate prevention: `idx_kb_text_unique` unique index (md5(text)) olusturma
- KB insert: `ON CONFLICT ((md5(text))) DO NOTHING` ile duplicate engelleme
- kbApi.ts: `data.count || docs.length` → `data.count ?? docs.length` (falsy zero fix)

### Changed
- Datasets: extractTextFromItem tum non-skip alanlari `key: value` formatinda birlestiriyor
- Datasets: handleEmbedAndSave totalSent vs totalSaved takibi, duplicate skipped mesaji

## [0.4.0] - 2026-02-16
### Added
- kb-service: FastAPI + pgvector Knowledge Base backend (PostgreSQL, cosine similarity search)
- kbApi.ts: KB API client (CRUD + semantic search)
- docker-compose.yml: pgvector container konfig
- Datasets: `name`/`title` alan destegi (extractTextFromItem) - tag isimleri duz metin olarak embed
- Embeddings: Knowledge Base tab (list, search, delete, bulk delete, pagination)

### Changed
- vectorStore (localStorage) → pgvector backend'e gecis (tum sayfalar)
- Datasets: handleSendToEmbeddings DRY refactor (extractTextFromItem kullanimi)
- Datasets: pageSize 100→1000
- Playground RAG mode: pgvector semantic search
- rag.ts: async pgvector search
- vite.config.ts: /api/kb proxy eklendi

### Fixed
- kb-service: asyncpg `::vector` cast syntax error → CAST(... AS vector)
- Datasets: addDocuments/getDocumentCount async/await eksikligi

## [0.3.0] - 2026-02-16
### Added
- `/commit-push` slash command: otomatik CHANGELOG, docs, CLAUDE.md guncelleyici
- `/test-api` slash command: git'e eklendi (ilk kez tracked)
- CHANGELOG.md: proje degisiklik kayitlari
- CLAUDE.md: proje rehberi (yapi, servisler, sayfalar, dev ortami)

### Changed
- .gitignore: `.claude/commands/` artik tracked (sadece reports/ ve plans/ ignore)

## [0.2.0] - 2026-02-16
### Added
- RAG entegrasyonu: vectorStore.ts, rag.ts, markdown.ts servisleri
- Playground: RAG Mode toggle, context preview panel, search timing
- Datasets: Strapi proxy, preset endpoints, pagination, Download JSON, Embed & Save to KB
- Embeddings: Save to Knowledge Base butonu
- Favicon (inline SVG)

### Fixed
- BUG-001: Think tag rendering (collapsible mor blok + markdown)
- BUG-002: Models format text truncation (tooltip eklendi)
- BUG-003: Missing favicon 404 hatasi

## [0.1.0] - 2026-02-16
### Added
- Ilk surum: Playground, Models, Embeddings, Datasets, History, Settings sayfalari
- vLLM chat completion stream + embedding generation
- Istek gecmisi (localStorage)
- Sidebar navigasyon
