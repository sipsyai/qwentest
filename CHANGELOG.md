# Changelog

Tum onemli degisiklikler bu dosyada belgelenir.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

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
