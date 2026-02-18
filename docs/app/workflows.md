# Workflows Sayfası

`/workflows` — Pipeline Builder + Agent Runner

## Tab Yapısı

### Pipeline Builder
Agentları sıralı adımlarla zincirleyen pipeline oluşturma ve çalıştırma arayüzü.

- **Sol panel**: Workflow listesi + New Workflow butonu
- **Merkez**: Step kartları (agent seç, variable mapping, execution output)
- **Sağ panel**: Agent Palette — mevcut agentlar ve veri akışı referansı

**Variable Mapping Syntax:**
| Token | Anlamı |
|-------|--------|
| `{{prev_output}}` | Bir önceki adımın çıktısı |
| `{{step:id}}` | Belirli adımın çıktısı |
| `{{input:key}}` | Runtime kullanıcı girişi (modal ile) |
| `text` | Literal değer |

### Agent Runner
Herhangi bir agentı doğrudan çalıştırmak için 3-panel workspace.

- **Sol panel**: Tüm agentlar (SIMPLE / REACT rozeti)
- **Merkez**: Variable inputs + Run/Stop + ReAct step tracker + final answer
- **Sağ panel**: Tool Registry (ACTIVE highlight) / Agent Config (system prompt, params)

**Desteklenen modlar:**
- `agentMode: 'react'` + `enabledTools` varsa → ReAct runner (iteration tracking, tool calls)
- Diğerleri → Simple SSE stream runner

## Backend

- `GET /api/kb/workflows` — liste
- `POST /api/kb/workflows` — oluştur
- `PUT /api/kb/workflows/{id}` — güncelle
- `DELETE /api/kb/workflows/{id}` — sil
- `POST /api/kb/workflows/{id}/run` — çalıştır (`body: { variables: {} }`)

## İlgili Dosyalar

- `forge-ai-studio/pages/Workflows.tsx` — sayfa bileşeni
- `forge-ai-studio/services/workflowApi.ts` — API client
- `kb-service/main.py` — run_workflow endpoint
- `kb-service/models.py` — WorkflowRunRequest, WorkflowResponse
