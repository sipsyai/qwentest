# Forge AI Studio - Proje Rehberi

## Genel Bakis
vLLM uzerinde calisan Qwen3-4B ve Nomic Embed modelleri icin React tabanli AI arabirimi.

## Proje Yapisi
- `forge-ai-studio/` - Ana React uygulamasi (Vite + TypeScript)
  - `pages/` - Playground, Models, ModelDetail, Embeddings, Datasets, History, Settings
  - `services/` - vllm.ts, vectorStore.ts, rag.ts, markdown.ts, history.ts, mockData.ts
  - `components/` - Sidebar.tsx
- `docs/api/` - vLLM API dokumantasyonu (chat-completions, embeddings, completions, tool-calling, tokenizer, qwen3-thinking, health, models)
- `docs/app/` - Uygulama dokumantasyonu
- `test-api.py` - API test scripti (health, chat, thinking, completions, embed, tokenizer, streaming, edge)

## Servisler
- **vllm.ts**: Chat completion stream, embedding generation, model listesi
- **vectorStore.ts**: Client-side vector store (localStorage, cosine similarity)
- **rag.ts**: RAG pipeline (embed query → search → context injection)
- **markdown.ts**: Think tag parser + markdown renderer
- **history.ts**: Chat/embedding istek loglamasi (localStorage)
- **mockData.ts**: Test/demo verileri

## Sayfalar
- **Playground**: Chat arayuzu, streaming, think mode, RAG mode
- **Models**: Model listesi ve detaylari
- **ModelDetail**: Tek model detay sayfasi
- **Embeddings**: Embedding olusturma + Knowledge Base kaydetme
- **Datasets**: Strapi veri cekme, preset endpoints, embed & save
- **History**: Istek gecmisi goruntuleme
- **Settings**: API URL, model, parametre ayarlari

## Dev Ortami
- Chat API: port 8010 (proxy: /api/chat)
- Embed API: port 8011 (proxy: /api/embed)
- Strapi: strapi.sipsy.ai (proxy: /api/strapi)
- Dev server: port 3000

## Slash Komutlari
- `/test-api` - vLLM API testlerini calistir ve rapor olustur
- `/commit-push` - Commit + push + CHANGELOG + docs + CLAUDE.md otomatik guncelle

## Teknoloji Stack
- React 19 + TypeScript + Vite
- React Router DOM (SPA routing)
- Lucide React (ikonlar)
- localStorage (state persistence)
