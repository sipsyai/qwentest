# Forge AI Studio - Database Schema

PostgreSQL 16 + pgvector extension. Container: `docker-compose.yml` (port 5434).

**Connection:** `postgresql+asyncpg://forge:ForgeKB2025!@localhost:5434/forge_kb`

---

## Tablolar

### 1. `kb_documents` - Knowledge Base

Embedding vektorleri ve kaynak metinleri saklayan ana tablo. pgvector extension ile semantic search destekler.

| Kolon | Tip | Constraint | Aciklama |
|-------|-----|-----------|----------|
| `id` | UUID | PRIMARY KEY, DEFAULT gen_random_uuid() | Otomatik UUID |
| `text` | TEXT | NOT NULL | Kaynak metin |
| `embedding` | vector(768) | NOT NULL | 768 boyutlu embedding vektoru |
| `source` | VARCHAR(20) | NOT NULL, DEFAULT 'manual' | Kaynak tipi: `manual` veya `dataset` |
| `source_label` | VARCHAR(255) | NOT NULL, DEFAULT '' | Kaynak etiketi (orn. "knowledge-bases #5") |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Olusturulma zamani |

**Indexler:**
- `idx_kb_embedding` - HNSW index on `embedding` (vector_cosine_ops) - Semantic search icin
- `idx_kb_text_unique` - UNIQUE index on `md5(text)` - Duplicate metin onleme

---

### 2. `app_settings` - Uygulama Ayarlari

Key-value store. Frontend settings'lerini persist eder (onceki localStorage yerine).

| Kolon | Tip | Constraint | Aciklama |
|-------|-----|-----------|----------|
| `key` | VARCHAR(100) | PRIMARY KEY | Setting anahtari |
| `value` | TEXT | NOT NULL, DEFAULT '' | Setting degeri |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Son guncelleme zamani |

**Varsayilan Degerler (seed):**

| Key | Default | Aciklama |
|-----|---------|----------|
| `forge_chat_url` | `/api/chat` | Chat API base URL |
| `forge_embed_url` | `/api/embed` | Embedding API base URL |
| `forge_chat_fallback_url` | (bos) | Chat fallback URL (Tailscale vb.) |
| `forge_embed_fallback_url` | (bos) | Embed fallback URL |
| `forge_api_key` | `EMPTY` | API anahtari |
| `ds_api_url` | `/api/strapi` | Dataset/Strapi base URL |
| `ds_api_token` | (bos) | Dataset bearer token |
| `ds_endpoint` | `knowledge-bases` | Dataset endpoint |

---

### 3. `request_history` - API Istek Gecmisi

Playground ve Embeddings sayfalarindan yapilan tum API isteklerini loglar.

| Kolon | Tip | Constraint | Aciklama |
|-------|-----|-----------|----------|
| `id` | VARCHAR(50) | PRIMARY KEY | Unique ID (orn. `req_1708123456_abc123`) |
| `method` | VARCHAR(10) | NOT NULL | HTTP method: `POST`, `GET` |
| `endpoint` | VARCHAR(255) | NOT NULL | API endpoint: `/v1/chat/completions`, `/v1/embeddings` |
| `model` | VARCHAR(255) | NOT NULL | Kullanilan model adi |
| `timestamp` | VARCHAR(50) | NOT NULL | Insan-okunabilir zaman damgasi |
| `duration` | VARCHAR(20) | NOT NULL | Sure: `150ms` veya `2.3s` |
| `tokens` | INTEGER | NOT NULL, DEFAULT 0 | Token sayisi (tahmini) |
| `status` | INTEGER | NOT NULL | HTTP status kodu: 200, 500 vb. |
| `status_text` | VARCHAR(100) | NOT NULL, DEFAULT '' | Status aciklamasi: `OK`, `Error` |
| `preview` | TEXT | NOT NULL, DEFAULT '' | Yanit onizlemesi (ilk 150 karakter) |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | DB'ye yazilma zamani |

**Indexler:**
- `idx_history_created_at` - DESC index on `created_at` - Sirali listeleme icin

---

## Tablo Iliskileri

```
+------------------+     +------------------+     +------------------+
|  kb_documents    |     |  app_settings    |     | request_history  |
+------------------+     +------------------+     +------------------+
| id (UUID) PK     |     | key (VARCHAR) PK |     | id (VARCHAR) PK  |
| text             |     | value            |     | method           |
| embedding        |     | updated_at       |     | endpoint         |
| source           |     +------------------+     | model            |
| source_label     |                              | timestamp        |
| created_at       |                              | duration         |
+------------------+                              | tokens           |
                                                  | status           |
                                                  | status_text      |
                                                  | preview          |
                                                  | created_at       |
                                                  +------------------+
```

**Tablolar bagimsizdir** - aralarinda foreign key iliskisi yoktur. Her tablo farkli bir concern'u karsilar:

- `kb_documents`: Veri katmani (RAG icin embedding'ler)
- `app_settings`: Konfigurasyon katmani (UI settings persistence)
- `request_history`: Gozlemlenebilirlik katmani (API istek loglari)

---

## API Endpoint Mapping

| Tablo | Endpoint | Method | Aciklama |
|-------|----------|--------|----------|
| kb_documents | `/api/kb/documents` | POST | Dokuman ekle |
| kb_documents | `/api/kb/documents` | GET | Dokuman listele (paginated) |
| kb_documents | `/api/kb/documents/{id}` | DELETE | Tek dokuman sil |
| kb_documents | `/api/kb/documents/bulk-delete` | POST | Toplu silme |
| kb_documents | `/api/kb/search` | POST | Semantic arama (pgvector) |
| kb_documents | `/api/kb/stats` | GET | Istatistikler |
| kb_documents | `/api/kb/clear` | DELETE | Tum dokumanlari sil |
| app_settings | `/api/kb/settings` | GET | Tum settings'i getir |
| app_settings | `/api/kb/settings` | PUT | Settings guncelle (UPSERT) |
| app_settings | `/api/kb/settings/migrate` | POST | localStorage'dan one-time migration |
| request_history | `/api/kb/history` | GET | History listele (paginated) |
| request_history | `/api/kb/history` | POST | Tek history item ekle |
| request_history | `/api/kb/history` | DELETE | Tum history'yi sil |
| request_history | `/api/kb/history/bulk` | POST | Bulk insert (migration) |
| request_history | `/api/kb/history/{id}` | DELETE | Tek history item sil |

---

## Migration Stratejisi

Frontend ilk acildiginda:

1. `initSettings()` → localStorage'daki settings'leri DB'ye migrate eder (`ON CONFLICT DO NOTHING`)
2. `migrateHistoryFromLocalStorage()` → localStorage'daki history items'i bulk insert eder
3. Basarili migration sonrasi `forge_settings_migrated=true` / `forge_history_migrated=true` flag'leri localStorage'a yazilir
4. Sonraki boot'larda migration atlanir
5. DB erisilemediyse localStorage fallback devam eder
