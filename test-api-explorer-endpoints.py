#!/usr/bin/env python3
"""
API Explorer — Full Endpoint Test Suite
Tests all 35 endpoints defined in apiCatalog.ts
"""
import json
import time
import uuid
import requests

KB = "http://localhost:8833/api/kb"
CHAT = "http://localhost:3000/api/chat"
EMBED = "http://localhost:3000/api/embed"

# Use direct vLLM URLs as fallback
CHAT_DIRECT = "http://192.168.1.8:8010/v1"
EMBED_DIRECT = "http://192.168.1.8:8011/v1"

results = []
created_ids = {}  # track IDs for cleanup

def test(name, method, url, **kwargs):
    """Run a single test and record result."""
    expect = kwargs.pop("expect", 200)
    skip_json = kwargs.pop("skip_json", False)
    t0 = time.time()
    try:
        r = getattr(requests, method.lower())(url, timeout=15, **kwargs)
        elapsed = round((time.time() - t0) * 1000)
        ok = r.status_code == expect
        try:
            body = r.json() if not skip_json else r.text[:200]
        except:
            body = r.text[:300]
        status_str = f"{r.status_code}"
        results.append({
            "name": name,
            "ok": ok,
            "status": r.status_code,
            "elapsed_ms": elapsed,
            "detail": str(body)[:200] if ok else f"Expected {expect}, got {r.status_code}: {str(body)[:200]}"
        })
        return ok, r
    except Exception as e:
        elapsed = round((time.time() - t0) * 1000)
        results.append({
            "name": name,
            "ok": False,
            "status": 0,
            "elapsed_ms": elapsed,
            "detail": str(e)[:200]
        })
        return False, None

def sep(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")

# ==================== KB Stats ====================
sep("KB Stats")

ok, r = test("GET /api/kb/stats", "GET", f"{KB}/stats")
if ok:
    d = r.json()
    print(f"  total={d.get('total')}, sources={d.get('source_labels')}")

# ==================== Settings ====================
sep("Settings")

ok, r = test("GET /api/kb/settings", "GET", f"{KB}/settings")
if ok:
    print(f"  keys: {list(r.json().get('settings', {}).keys())[:5]}...")

ok, r = test("PUT /api/kb/settings", "PUT", f"{KB}/settings",
    json={"settings": {"_test_key": "test_value_123"}})
if ok:
    s = r.json().get("settings", {})
    assert s.get("_test_key") == "test_value_123", "Setting not persisted"
    print(f"  _test_key = {s.get('_test_key')}")

# Clean up test setting
test("PUT /api/kb/settings (cleanup)", "PUT", f"{KB}/settings",
    json={"settings": {"_test_key": ""}})

# ==================== Documents ====================
sep("KB Documents")

ok, r = test("GET /api/kb/documents", "GET", f"{KB}/documents", params={"limit": 3})
if ok:
    d = r.json()
    print(f"  total={d.get('total')}, page={d.get('page')}, returned={len(d.get('data', []))}")

# Add a test document (with dummy 768-dim embedding)
dummy_embed = [0.01] * 768
ok, r = test("POST /api/kb/documents", "POST", f"{KB}/documents",
    json={"documents": [{
        "text": f"API Explorer test document {uuid.uuid4().hex[:8]}",
        "embedding": dummy_embed,
        "source": "test",
        "source_label": "API Explorer Test"
    }]})
if ok:
    print(f"  added: {r.json()}")

# Get the doc we just created to find its ID
ok, r = test("GET /api/kb/documents (filter)", "GET", f"{KB}/documents",
    params={"source_label": "API Explorer Test", "limit": 1})
if ok:
    docs = r.json().get("data", [])
    if docs:
        created_ids["doc"] = docs[0]["id"]
        print(f"  found test doc: {created_ids['doc']}")

# ==================== Search ====================
sep("Search")

ok, r = test("POST /api/kb/search", "POST", f"{KB}/search",
    json={"embedding": dummy_embed, "top_k": 3, "threshold": 0.0})
if ok:
    res = r.json().get("results", [])
    print(f"  results={len(res)}, time={r.json().get('search_time_ms')}ms")
    if res:
        print(f"  top: sim={res[0].get('similarity', 'N/A'):.4f}, text={res[0].get('text', '')[:60]}")

# ==================== Document Cleanup ====================
sep("Document Cleanup")

if "doc" in created_ids:
    ok, r = test("DELETE /api/kb/documents/{doc_id}", "DELETE", f"{KB}/documents/{created_ids['doc']}")
    if ok:
        print(f"  deleted: {created_ids['doc']}")

# Bulk delete test (create 2 docs, then bulk delete)
docs_to_delete = []
for i in range(2):
    ok, r = test(f"POST /api/kb/documents (bulk prep {i})", "POST", f"{KB}/documents",
        json={"documents": [{
            "text": f"Bulk delete test {uuid.uuid4().hex}",
            "embedding": dummy_embed,
            "source": "test",
            "source_label": "Bulk Delete Test"
        }]})

ok, r = test("GET docs for bulk delete", "GET", f"{KB}/documents",
    params={"source_label": "Bulk Delete Test", "limit": 10})
if ok:
    docs_to_delete = [d["id"] for d in r.json().get("data", [])]
    if docs_to_delete:
        ok, r = test("POST /api/kb/documents/bulk-delete", "POST", f"{KB}/documents/bulk-delete",
            json={"ids": docs_to_delete})
        if ok:
            print(f"  bulk deleted: {r.json()}")

# ==================== History ====================
sep("History")

hist_id = f"test_hist_{uuid.uuid4().hex[:8]}"

ok, r = test("POST /api/kb/history", "POST", f"{KB}/history",
    json={
        "id": hist_id, "method": "GET", "endpoint": "/api/kb/stats",
        "model": "test", "timestamp": "02/19/2026, 01:00:00 PM",
        "duration": "0.1s", "status": 200, "status_text": "OK",
        "preview": "test preview",
        "request_payload": {"test": True},
        "response_payload": {"result": "ok"},
    })
if ok:
    print(f"  added: {hist_id}")

# Bulk add
hist_id2 = f"test_hist_{uuid.uuid4().hex[:8]}"
ok, r = test("POST /api/kb/history/bulk", "POST", f"{KB}/history/bulk",
    json=[{
        "id": hist_id2, "method": "POST", "endpoint": "/v1/chat/completions",
        "model": "Qwen/Qwen3-4B", "timestamp": "02/19/2026, 02:00:00 PM",
        "duration": "1.5s", "status": 200
    }])
if ok:
    print(f"  bulk added: {r.json()}")

ok, r = test("GET /api/kb/history", "GET", f"{KB}/history", params={"limit": 5})
if ok:
    d = r.json()
    print(f"  total={d.get('total')}, returned={len(d.get('data', []))}")

ok, r = test("GET /api/kb/history/{item_id}", "GET", f"{KB}/history/{hist_id}")
if ok:
    d = r.json()
    print(f"  detail: method={d.get('method')}, endpoint={d.get('endpoint')}")
    print(f"  request_payload={d.get('request_payload')}")

ok, r = test("DELETE /api/kb/history/{item_id}", "DELETE", f"{KB}/history/{hist_id}")
if ok:
    print(f"  deleted: {hist_id}")

ok, r = test("DELETE /api/kb/history/{item_id} (2)", "DELETE", f"{KB}/history/{hist_id2}")
if ok:
    print(f"  deleted: {hist_id2}")

# ==================== Datasets ====================
sep("Datasets")

ok, r = test("GET /api/kb/datasets", "GET", f"{KB}/datasets")
if ok:
    d = r.json()
    print(f"  total={d.get('total')}, datasets={len(d.get('data', []))}")

# Create a test dataset
ok, r = test("POST /api/kb/datasets", "POST", f"{KB}/datasets",
    json={
        "name": f"Test Dataset {uuid.uuid4().hex[:6]}",
        "url": "https://jsonplaceholder.typicode.com/posts",
        "method": "GET",
        "array_path": "",
        "extract_fields": ["id", "title"],
    })
if ok:
    ds = r.json()
    created_ids["dataset"] = ds.get("id")
    print(f"  created: {created_ids['dataset']}, name={ds.get('name')}")

if "dataset" in created_ids:
    ds_id = created_ids["dataset"]

    ok, r = test("GET /api/kb/datasets/{ds_id}", "GET", f"{KB}/datasets/{ds_id}")
    if ok:
        print(f"  get: name={r.json().get('name')}")

    ok, r = test("PUT /api/kb/datasets/{ds_id}", "PUT", f"{KB}/datasets/{ds_id}",
        json={"name": "Updated Test Dataset"})
    if ok:
        print(f"  updated: name={r.json().get('name')}")

    ok, r = test("POST /api/kb/datasets/{ds_id}/fetch", "POST", f"{KB}/datasets/{ds_id}/fetch",
        json={})
    if ok:
        d = r.json()
        print(f"  fetch: status={d.get('status')}, elapsed={d.get('elapsed_ms')}ms")
        data = d.get("data")
        if isinstance(data, list):
            print(f"  fetched {len(data)} items")
        elif isinstance(data, dict):
            print(f"  fetched keys: {list(data.keys())[:5]}")

# ==================== Dataset Records ====================
sep("Dataset Records")

ok, r = test("GET /api/kb/dataset-records", "GET", f"{KB}/dataset-records", params={"limit": 3})
if ok:
    d = r.json()
    print(f"  total={d.get('total')}, returned={len(d.get('data', []))}")

if "dataset" in created_ids:
    ds_id = created_ids["dataset"]

    # Bulk create records
    rec_data = [
        {"dataset_id": ds_id, "data": {"title": "Test Post 1", "body": "Lorem ipsum"}, "json_path": "$", "label": "test"},
        {"dataset_id": ds_id, "data": {"title": "Test Post 2", "body": "Dolor sit amet"}, "json_path": "$", "label": "test"},
    ]
    ok, r = test("POST /api/kb/dataset-records (bulk)", "POST", f"{KB}/dataset-records",
        json={"records": rec_data})
    if ok:
        print(f"  bulk created: {r.json()}")

    # List all records for dataset
    ok, r = test("GET /api/kb/dataset-records/all", "GET", f"{KB}/dataset-records/all",
        params={"dataset_id": ds_id})
    if ok:
        d = r.json()
        recs = d.get("data", [])
        print(f"  all records: {len(recs)}")
        if recs:
            created_ids["record"] = recs[0]["id"]
            if len(recs) > 1:
                created_ids["record2"] = recs[1]["id"]

    # Delete single record
    if "record" in created_ids:
        ok, r = test("DELETE /api/kb/dataset-records/{record_id}", "DELETE",
            f"{KB}/dataset-records/{created_ids['record']}")
        if ok:
            print(f"  deleted record: {created_ids['record']}")

    # Bulk delete
    if "record2" in created_ids:
        ok, r = test("POST /api/kb/dataset-records/bulk-delete", "POST",
            f"{KB}/dataset-records/bulk-delete",
            json={"ids": [created_ids["record2"]]})
        if ok:
            print(f"  bulk deleted: {r.json()}")

# ==================== Agents ====================
sep("Agents")

ok, r = test("GET /api/kb/agents", "GET", f"{KB}/agents")
if ok:
    d = r.json()
    print(f"  total={d.get('total')}, agents={len(d.get('data', []))}")

ok, r = test("GET /api/kb/agents/tools", "GET", f"{KB}/agents/tools")
if ok:
    tools = r.json().get("tools", [])
    print(f"  available tools: {[t['name'] for t in tools]}")

# Create test agent
ok, r = test("POST /api/kb/agents", "POST", f"{KB}/agents",
    json={
        "name": f"Test Agent {uuid.uuid4().hex[:6]}",
        "description": "API Explorer test agent",
        "config": {
            "selectedModel": "Qwen/Qwen3-4B",
            "promptTemplate": "Answer this question: {{question}}",
            "systemPrompt": "You are a test assistant.",
            "agentMode": "simple",
            "variables": [{"name": "question", "label": "Question", "defaultValue": "Hello"}],
            "temperature": 0.7,
            "topP": 0.9,
            "maxTokens": 256,
            "enabledTools": [],
            "maxIterations": 5,
        }
    })
if ok:
    agent = r.json()
    created_ids["agent"] = agent.get("id")
    print(f"  created: {created_ids['agent']}, name={agent.get('name')}")

if "agent" in created_ids:
    agent_id = created_ids["agent"]

    ok, r = test("GET /api/kb/agents/{agent_id}", "GET", f"{KB}/agents/{agent_id}")
    if ok:
        print(f"  get: name={r.json().get('name')}")

    ok, r = test("PUT /api/kb/agents/{agent_id}", "PUT", f"{KB}/agents/{agent_id}",
        json={"name": "Updated Test Agent"})
    if ok:
        print(f"  updated: name={r.json().get('name')}")

    # Run agent (SSE) — just test the connection, read a few chunks
    print("  Running agent (SSE stream)...")
    try:
        r = requests.post(f"{KB}/agents/{agent_id}/run",
            json={"variables": {"question": "What is 2+2?"}, "stream": True},
            stream=True, timeout=30)
        chunks = []
        for i, line in enumerate(r.iter_lines(decode_unicode=True)):
            if line:
                chunks.append(line)
            if i > 20:
                break
        ok = r.status_code == 200
        results.append({
            "name": "POST /api/kb/agents/{agent_id}/run (SSE)",
            "ok": ok,
            "status": r.status_code,
            "elapsed_ms": 0,
            "detail": f"Got {len(chunks)} SSE lines" + (f", first: {chunks[0][:100]}" if chunks else "")
        })
        print(f"  SSE: {len(chunks)} lines received")
    except Exception as e:
        results.append({
            "name": "POST /api/kb/agents/{agent_id}/run (SSE)",
            "ok": False, "status": 0, "elapsed_ms": 0,
            "detail": str(e)[:200]
        })
        print(f"  SSE error: {e}")

# ==================== Workflows ====================
sep("Workflows")

ok, r = test("GET /api/kb/workflows", "GET", f"{KB}/workflows")
if ok:
    d = r.json()
    print(f"  total={d.get('total')}, workflows={len(d.get('data', []))}")

# Create test workflow
ok, r = test("POST /api/kb/workflows", "POST", f"{KB}/workflows",
    json={
        "name": f"Test Workflow {uuid.uuid4().hex[:6]}",
        "description": "API Explorer test workflow",
        "steps": []
    })
if ok:
    wf = r.json()
    created_ids["workflow"] = wf.get("id")
    print(f"  created: {created_ids['workflow']}, name={wf.get('name')}")

if "workflow" in created_ids:
    wf_id = created_ids["workflow"]

    ok, r = test("GET /api/kb/workflows/{wf_id}", "GET", f"{KB}/workflows/{wf_id}")
    if ok:
        print(f"  get: name={r.json().get('name')}")

    ok, r = test("PUT /api/kb/workflows/{wf_id}", "PUT", f"{KB}/workflows/{wf_id}",
        json={"name": "Updated Test Workflow"})
    if ok:
        print(f"  updated: name={r.json().get('name')}")

# ==================== Chat Completions (vLLM) ====================
sep("Chat Completions (vLLM)")

# Try proxy first, fallback to direct
chat_base = CHAT
ok, r = test("GET /api/chat/models", "GET", f"{chat_base}/models")
if not ok:
    chat_base = CHAT_DIRECT
    ok, r = test("GET /api/chat/models (direct)", "GET", f"{chat_base}/models")
if ok:
    models = r.json().get("data", [])
    print(f"  models: {[m['id'] for m in models]}")

# Non-streaming text completion
ok, r = test("POST /api/chat/completions (text)", "POST", f"{chat_base}/completions",
    json={
        "model": "Qwen/Qwen3-4B",
        "prompt": "The capital of Turkey is",
        "max_tokens": 30,
        "temperature": 0.3,
        "stream": False
    })
if ok:
    choices = r.json().get("choices", [])
    if choices:
        print(f"  completion: {choices[0].get('text', '')[:80]}")

# Streaming chat completion
print("  Running chat completion (SSE stream)...")
try:
    r = requests.post(f"{chat_base}/chat/completions",
        json={
            "model": "Qwen/Qwen3-4B",
            "messages": [
                {"role": "system", "content": "You are helpful. Reply briefly."},
                {"role": "user", "content": "What is 2+2? Reply in one word."}
            ],
            "temperature": 0.3,
            "max_tokens": 50,
            "stream": True,
            "chat_template_kwargs": {"enable_thinking": False}
        },
        stream=True, timeout=30)
    content = ""
    chunk_count = 0
    for line in r.iter_lines(decode_unicode=True):
        if line and line.startswith("data: ") and line != "data: [DONE]":
            try:
                d = json.loads(line[6:])
                delta = d.get("choices", [{}])[0].get("delta", {})
                c = delta.get("content", "")
                if c:
                    content += c
                chunk_count += 1
            except:
                pass
    ok = r.status_code == 200 and len(content) > 0
    results.append({
        "name": "POST /api/chat/chat/completions (SSE)",
        "ok": ok,
        "status": r.status_code,
        "elapsed_ms": 0,
        "detail": f"{chunk_count} chunks, content: {content[:100]}"
    })
    print(f"  SSE: {chunk_count} chunks, reply: {content[:80]}")
except Exception as e:
    results.append({
        "name": "POST /api/chat/chat/completions (SSE)",
        "ok": False, "status": 0, "elapsed_ms": 0,
        "detail": str(e)[:200]
    })

# ==================== Embeddings (vLLM) ====================
sep("Embeddings (vLLM)")

embed_base = EMBED
ok, r = test("GET /api/embed/models", "GET", f"{embed_base}/models")
if not ok:
    embed_base = EMBED_DIRECT
    ok, r = test("GET /api/embed/models (direct)", "GET", f"{embed_base}/models")
if ok:
    models = r.json().get("data", [])
    print(f"  models: {[m['id'] for m in models]}")

ok, r = test("POST /api/embed/embeddings", "POST", f"{embed_base}/embeddings",
    json={
        "model": "nomic-ai/nomic-embed-text-v1.5",
        "input": ["How to reset password?", "What is the weather today?"]
    })
if ok:
    d = r.json()
    emb_data = d.get("data", [])
    print(f"  generated {len(emb_data)} embeddings")
    if emb_data:
        vec = emb_data[0].get("embedding", [])
        print(f"  dim={len(vec)}, first 5: {vec[:5]}")
    usage = d.get("usage", {})
    print(f"  usage: {usage}")

# ==================== Cleanup ====================
sep("Cleanup")

# Delete test workflow
if "workflow" in created_ids:
    ok, r = test("DELETE /api/kb/workflows/{wf_id}", "DELETE", f"{KB}/workflows/{created_ids['workflow']}")
    if ok: print(f"  deleted workflow: {created_ids['workflow']}")

# Delete test agent
if "agent" in created_ids:
    ok, r = test("DELETE /api/kb/agents/{agent_id}", "DELETE", f"{KB}/agents/{created_ids['agent']}")
    if ok: print(f"  deleted agent: {created_ids['agent']}")

# Delete test dataset (cascade deletes records too)
if "dataset" in created_ids:
    ok, r = test("DELETE /api/kb/datasets/{ds_id}", "DELETE", f"{KB}/datasets/{created_ids['dataset']}")
    if ok: print(f"  deleted dataset: {created_ids['dataset']}")

# ==================== Report ====================
sep("FINAL REPORT")

passed = sum(1 for r in results if r["ok"])
failed = sum(1 for r in results if not r["ok"])
total = len(results)

print(f"\n  Total: {total}  |  Passed: {passed}  |  Failed: {failed}\n")

for r in results:
    icon = "✅" if r["ok"] else "❌"
    ms = f"{r['elapsed_ms']}ms" if r["elapsed_ms"] else ""
    print(f"  {icon} [{r['status']}] {r['name']}  {ms}")
    if not r["ok"]:
        print(f"     ↳ {r['detail']}")

if failed:
    print(f"\n  ⚠️  {failed} test(s) FAILED")
else:
    print(f"\n  🎉 All {total} tests PASSED!")
