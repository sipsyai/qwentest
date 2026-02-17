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

### 4. `datasets` - Dataset Tanimlari

Kullanicinin ekledigi REST API dataset kaynaklari.

| Kolon | Tip | Constraint | Aciklama |
|-------|-----|-----------|----------|
| `id` | SERIAL | PRIMARY KEY | Otomatik artan ID |
| `name` | VARCHAR(255) | NOT NULL | Dataset adi |
| `url` | TEXT | NOT NULL | API endpoint URL |
| `method` | VARCHAR(10) | NOT NULL, DEFAULT 'GET' | HTTP method: `GET` veya `POST` |
| `token` | TEXT | DEFAULT '' | Bearer token (opsiyonel) |
| `headers` | JSONB | DEFAULT '{}' | Custom HTTP headers |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Olusturulma zamani |
| `updated_at` | TIMESTAMPTZ | DEFAULT NOW() | Son guncelleme zamani |

---

### 5. `dataset_records` - Kaydedilen Dataset Kayitlari

Dataset'lerden secilip kaydedilen JSON kayitlari.

| Kolon | Tip | Constraint | Aciklama |
|-------|-----|-----------|----------|
| `id` | SERIAL | PRIMARY KEY | Otomatik artan ID |
| `dataset_id` | INTEGER | NOT NULL, FK → datasets(id) ON DELETE CASCADE | Ait oldugu dataset |
| `data` | JSONB | NOT NULL | Kaydedilen JSON verisi |
| `json_path` | TEXT | DEFAULT '' | JSON drill-down path (orn. "data.items[0]") |
| `label` | VARCHAR(255) | DEFAULT '' | Kullanici etiketi |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() | Olusturulma zamani |

**Indexler:**
- `idx_dataset_records_dataset_id` - Index on `dataset_id` - FK lookup icin

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
+------------------+     +--------------------+   | status_text      |
|    datasets      |     | dataset_records    |   | preview          |
+------------------+     +--------------------+   | created_at       |
| id (SERIAL) PK   |←1:N| id (SERIAL) PK    |   +------------------+
| name             |     | dataset_id (FK)    |
| url              |     | data (JSONB)       |
| method           |     | json_path          |
| token            |     | label              |
| headers (JSONB)  |     | created_at         |
| created_at       |     +--------------------+
| updated_at       |       ON DELETE CASCADE
+------------------+
```

**Iliski yapisi:**

- `kb_documents`, `app_settings`, `request_history`: Bagimsiz tablolar (FK yok)
- `datasets` ←1:N→ `dataset_records`: Foreign key (`dataset_id` → `datasets.id`, CASCADE delete)

**Concern bazli ayrim:**
- `kb_documents`: Veri katmani (RAG icin embedding'ler)
- `app_settings`: Konfigurasyon katmani (UI settings persistence)
- `request_history`: Gozlemlenebilirlik katmani (API istek loglari)
- `datasets` + `dataset_records`: Dataset katmani (REST API kaynaklari + kaydedilen kayitlar)

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
| request_history | `/api/kb/history` | GET | History listele (paginated) |
| request_history | `/api/kb/history` | POST | Tek history item ekle |
| request_history | `/api/kb/history` | DELETE | Tum history'yi sil |
| request_history | `/api/kb/history/bulk` | POST | Bulk insert (migration) |
| request_history | `/api/kb/history/{id}` | DELETE | Tek history item sil |
| datasets | `/api/kb/datasets` | GET | Tum dataset'leri listele |
| datasets | `/api/kb/datasets` | POST | Yeni dataset olustur |
| datasets | `/api/kb/datasets/{id}` | PUT | Dataset guncelle |
| datasets | `/api/kb/datasets/{id}` | DELETE | Dataset sil (CASCADE) |
| datasets | `/api/kb/datasets/fetch` | POST | URL'den veri cek (proxy) |
| dataset_records | `/api/kb/datasets/{id}/records` | GET | Dataset kayitlarini listele |
| dataset_records | `/api/kb/datasets/{id}/records` | POST | Kayit kaydet |
| dataset_records | `/api/kb/datasets/{id}/records` | DELETE | Tum kayitlari sil |
| dataset_records | `/api/kb/records/{id}` | DELETE | Tek kayit sil |

---

## Migration Stratejisi

Settings ve history verileri dogrudan PostgreSQL'de persist edilir. localStorage kullanilmaz.

- `initSettings()` → DB'den settings'leri yukler, in-memory cache'e yazar
- `datasets` ve `dataset_records` tablolari otomatik olusturulur (CREATE TABLE IF NOT EXISTS)
