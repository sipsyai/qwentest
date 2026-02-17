# Test Coverage Analysis

**Date:** 2026-02-17
**Scope:** Full codebase — frontend (forge-ai-studio), backend (kb-service), integration tests (test-api.py)

---

## Current State

### What exists

| Layer | Test file | Type | Coverage |
|-------|-----------|------|----------|
| vLLM API | `test-api.py` (1512 lines) | Integration/smoke tests | 74 tests across 8 groups |
| Frontend (TypeScript/React) | *none* | — | 0% |
| Backend (FastAPI/Python) | *none* | — | 0% |

The **only** test file is `test-api.py`, a hand-rolled integration suite using Python's `urllib` that hits live vLLM endpoints. It requires running vLLM servers and tests: health checks, chat completions, thinking mode, text completions, embeddings, tokenizer, SSE streaming, and edge cases.

There are **zero unit tests** for either the frontend or the backend. No test runner (vitest, jest, pytest) is configured. No test scripts exist in `package.json`.

---

## Gap Analysis

### 1. Frontend Unit Tests — CRITICAL (0% coverage)

**No testing framework is installed.** The `forge-ai-studio/package.json` has no vitest/jest dependency and no `test` script. This is the highest-priority gap.

#### 1a. Pure utility functions (highest ROI, easiest to test)

These functions have zero external dependencies and are ideal candidates for unit tests:

| File | Functions | Why it matters |
|------|-----------|----------------|
| `services/markdown.ts` | `parseThinkTags()`, `renderMarkdownToHTML()` | Core rendering logic, XSS protection claims, streaming-safe partial tag parsing |
| `services/embedUtils.ts` | `getNestedValue()`, `recordToText()`, `batchArray()` | Data transformation for embed pipeline; edge cases with nested paths and null values |
| `services/agentsApi.ts` | `extractVariables()` | Template variable extraction; must correctly exclude `{{context}}` |

**Specific test cases needed:**

`parseThinkTags()`:
- Input with no think tags → `thinking: null`
- Completed `<think>...</think>` → extracts thinking, strips from content
- Partial/unclosed `<think>` (streaming) → returns partial thinking, cleans content
- Empty `<think></think>` → `thinking: null`
- Multiple think tags in sequence
- Think tags with surrounding content before and after

`renderMarkdownToHTML()`:
- XSS: `<script>alert(1)</script>` must be escaped
- Code blocks with language hint (` ```js ... ``` `)
- Inline code, headings (h1–h3), bold/italic/bold-italic
- Nested formatting edge cases
- Blockquotes (uses `&gt;` after HTML escaping)
- Ordered and unordered lists
- Links: `[text](url)` with proper `target="_blank"` and `rel="noopener"`
- Empty input → empty string

`getNestedValue()`:
- Simple path: `getNestedValue({a: 1}, "a")` → `1`
- Dot path: `getNestedValue({a: {b: 2}}, "a.b")` → `2`
- Missing intermediate: `getNestedValue({a: 1}, "a.b.c")` → `undefined`
- Null object → `undefined`

`recordToText()`:
- With `extract_fields` → formatted `"field: value\n..."` output
- Without `extract_fields` → JSON.stringify fallback
- With `extract_fields` but all values null → JSON.stringify fallback
- Object values in fields → JSON.stringify of nested object

`batchArray()`:
- Even split: 6 items, batch size 3 → 2 batches
- Uneven: 7 items, batch size 3 → 3 batches (last has 1)
- Empty array → empty result
- Batch size larger than array → single batch

`extractVariables()`:
- `"Hello {{name}}, your {{role}}"` → `["name", "role"]`
- `"Use {{context}} wisely"` → `[]` (context is reserved)
- `"{{a}} and {{a}}"` → `["a"]` (deduplication)
- No variables → `[]`

#### 1b. RAG pipeline logic (`services/rag.ts`)

The `buildMessages()` function (not exported, but testable via `executeRAGPipeline` or by exporting it) contains critical branching logic:

- `{{context}}` placeholder in user prompt → injects docs there, leaves system prompt untouched
- No placeholder → appends "Retrieved Context" block to system prompt
- No docs + placeholder → replaces with "(No relevant context found)"
- No docs, no placeholder → messages pass through unchanged
- Doc preview truncation at 300 chars
- Similarity percentage formatting

**Recommendation:** Export `buildMessages` for direct unit testing.

#### 1c. `fetchWithFallback()` in `services/vllm.ts`

Critical resilience logic with nuanced conditions:
- Primary succeeds → returns primary response
- Primary throws `TypeError` (network error) → retries with fallback
- Primary throws non-TypeError → does not fallback, re-throws
- Fallback URL empty or same as primary → does not retry
- Abort signal already fired → does not retry

#### 1d. SSE stream parsing (`streamChatCompletion`, `runAgent`)

Both `vllm.ts` and `agentsApi.ts` contain manual SSE parsers. Test coverage should verify:
- Correct chunk reassembly from partial `data:` lines
- `[DONE]` marker detection
- JSON parse error resilience for incomplete chunks
- AbortSignal handling
- Error payload forwarding

---

### 2. Backend Unit/Integration Tests — CRITICAL (0% coverage)

**No pytest is configured.** The `kb-service/` has `requirements.txt` but no test dependencies, no `conftest.py`, no test files.

#### 2a. FastAPI endpoint tests (highest priority)

Use `pytest` + `httpx` + `pytest-asyncio` with FastAPI's `TestClient` or async `AsyncClient`. These do not require a live database if mocked, or can use a test PostgreSQL instance.

| Endpoint group | Endpoints | Test cases needed |
|----------------|-----------|-------------------|
| KB Documents | POST/GET/DELETE `/api/kb/documents`, bulk-delete, clear | CRUD lifecycle, duplicate detection (md5 dedup), pagination, source filtering |
| Search | POST `/api/kb/search` | Cosine similarity ordering, threshold filtering, source_label filtering, empty results |
| Settings | GET/PUT `/api/kb/settings` | Read/write cycle, upsert behavior |
| History | GET/POST/DELETE `/api/kb/history`, bulk, detail | Pagination, JSONB payload storage/retrieval, 404 on missing, clear all |
| Datasets | Full CRUD + fetch proxy | Creation, partial updates, cascade delete (records), fetch proxy (mock external URL) |
| Dataset Records | CRUD + bulk | Bulk insert with dedup, pagination, filtering by dataset_id |
| Agents | Full CRUD + run | Creation, update, delete, 404 handling |
| Agent Run | POST `/api/kb/agents/{id}/run` | Template resolution, variable merging, RAG integration, streaming vs non-streaming, history logging |

#### 2b. Backend utility functions

| Function | Location | Test cases |
|----------|----------|------------|
| `resolve_template()` | `main.py:864` | Variable substitution, `{{context}}` preservation, missing variable → empty string |
| `resolve_vllm_url()` | `main.py:847` | Proxy path skipping (`/api/chat` → use fallback/default), real URL preference |
| `_row_to_dataset_response()` | `main.py:420` | JSON string vs dict parsing for headers/extract_fields/raw_data |
| `_row_to_agent_response()` | `main.py:733` | Config JSON string vs dict handling |

#### 2c. Database schema/migration tests

Verify `init_db()` is idempotent — running it twice should not fail. Test index creation guards, column migration (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`).

---

### 3. Existing test-api.py Gaps

The integration suite is good for vLLM API testing but has gaps:

#### Not tested at all
- **KB Service API** (port 8833) — zero endpoint coverage
- **Agent run endpoint** — no integration test
- **RAG end-to-end** — no test that chains embed → search → chat
- **CORS headers** — no verification
- **Concurrent requests** — no load/stress tests
- **Response time SLAs** — only TTFT < 2s for streaming

#### Partially tested
- **Streaming**: No streaming test for `reasoning_effort`, JSON mode, `n=2`
- **Embeddings**: No large batch test (100+ texts), no token-based input test
- **Chat**: No `tool_choice="none"`, no `guided_json`/`guided_regex`, no `best_of`
- **Error handling**: No malformed JSON body test, no `max_tokens > max_model_len` test

---

### 4. Component/Page Tests — LOW PRIORITY (0% coverage)

React component tests would be valuable but are lower priority than the service layer. If pursued:

- Use `@testing-library/react` + `vitest` + `jsdom`
- Focus on the Playground page (most complex): message rendering, stream handling, parameter controls
- Agents page: run modal flow, variable input, markdown output rendering
- Sidebar: navigation state, active route highlighting

---

## Prioritized Recommendations

### Phase 1: Set up testing infrastructure

1. **Frontend**: Install vitest + @testing-library/react, add `test` script to `package.json`, configure `vitest.config.ts`
2. **Backend**: Add pytest + pytest-asyncio + httpx to `requirements.txt`, create `kb-service/tests/` directory with `conftest.py`

### Phase 2: Unit tests for pure functions (highest ROI)

3. `markdown.ts` — `parseThinkTags` and `renderMarkdownToHTML` (XSS is a security concern)
4. `embedUtils.ts` — `getNestedValue`, `recordToText`, `batchArray`
5. `agentsApi.ts` — `extractVariables`
6. `main.py` — `resolve_template`, `resolve_vllm_url`

### Phase 3: Backend API tests

7. KB Documents CRUD + search (with a test database)
8. Settings, History, Datasets, Agents CRUD
9. Agent Run endpoint (mock vLLM, verify template resolution + history logging)

### Phase 4: Frontend service layer tests

10. `fetchWithFallback` with mocked fetch
11. SSE stream parsing in `streamChatCompletion` and `runAgent`
12. RAG pipeline `buildMessages` logic

### Phase 5: Extend test-api.py

13. Add KB Service API integration tests
14. Add agent run integration tests
15. Add RAG end-to-end integration test

---

## Estimated Coverage Impact

| Phase | New tests (est.) | Code covered |
|-------|-----------------|--------------|
| Phase 2 | ~40 test cases | 6 pure functions across 4 files |
| Phase 3 | ~60 test cases | All 25+ FastAPI endpoints |
| Phase 4 | ~20 test cases | 3 service modules (vllm.ts, agentsApi.ts, rag.ts) |
| Phase 5 | ~15 test cases | KB + agent integration paths |

Total: ~135 new test cases would bring meaningful coverage across the entire stack.
