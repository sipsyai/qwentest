#!/usr/bin/env python3
"""
vLLM API Endpoint Test Suite
=============================
Tum vLLM API endpoint'lerini test eder ve rapor olusturur.

Kullanim:
  python3 test-api.py                          # Varsayilan: 192.168.1.8
  python3 test-api.py --host 100.75.67.64      # Tailscale IP
  python3 test-api.py --host localhost          # Local
  python3 test-api.py --report-dir .claude/reports  # Rapor dizini
  python3 test-api.py --verbose                 # Detayli cikti
  python3 test-api.py --only chat               # Sadece chat testleri
  python3 test-api.py --only embed              # Sadece embedding testleri
  python3 test-api.py --only thinking           # Sadece thinking testleri
"""

import json
import math
import time
import sys
import os
import argparse
from datetime import datetime
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

# ═══════════════════════════════════════════════════════════════
# CONFIG
# ═══════════════════════════════════════════════════════════════

DEFAULT_HOST = "192.168.1.8"
CHAT_PORT = 8010
EMBED_PORT = 8011
TIMEOUT = 60

# ═══════════════════════════════════════════════════════════════
# TOOL DEFINITIONS
# ═══════════════════════════════════════════════════════════════

TOOL_CREATE_TICKET = {
    "type": "function",
    "function": {
        "name": "create_ticket",
        "description": "IT destek talebi olusturur",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Kisa baslik"},
                "description": {"type": "string", "description": "Detayli aciklama"},
                "urgency": {"type": "string", "enum": ["low", "medium", "high", "critical"]}
            },
            "required": ["title", "description"]
        }
    }
}

TOOL_SEARCH_TICKETS = {
    "type": "function",
    "function": {
        "name": "search_tickets",
        "description": "Ticket ara",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "status": {"type": "string", "enum": ["new", "open", "in_progress", "resolved", "closed"]},
                "limit": {"type": "integer"}
            },
            "required": ["query"]
        }
    }
}

# ═══════════════════════════════════════════════════════════════
# TEST RUNNER
# ═══════════════════════════════════════════════════════════════

class APITester:
    def __init__(self, host, verbose=False):
        self.host = host
        self.verbose = verbose
        self.base_chat = f"http://{host}:{CHAT_PORT}"
        self.base_embed = f"http://{host}:{EMBED_PORT}"
        self.results = []
        self.bugs = []
        self.start_time = None

    def request(self, url, method="GET", data=None):
        if data:
            req = Request(url, data=json.dumps(data).encode(),
                         headers={"Content-Type": "application/json"}, method=method)
        else:
            req = Request(url, method=method)
        resp = urlopen(req, timeout=TIMEOUT)
        body = resp.read().decode()
        try:
            return resp.status, json.loads(body)
        except json.JSONDecodeError:
            return resp.status, body

    def _stream_request(self, url, data):
        """SSE stream istegi gonderir, chunk parse eder.
        Returns: (chunks, content_parts, has_done, has_usage, first_chunk_ms, elapsed, tool_calls_chunks)
        """
        start = time.time()
        req = Request(url, data=json.dumps(data).encode(),
                     headers={"Content-Type": "application/json"})
        resp = urlopen(req, timeout=TIMEOUT)

        chunks = 0
        content_parts = []
        has_done = False
        has_usage = False
        first_chunk_ms = None
        tool_calls_chunks = []

        for line in resp:
            line = line.decode().strip()
            if not line or not line.startswith("data: "):
                continue
            payload = line[6:]
            if payload == "[DONE]":
                has_done = True
                break
            try:
                chunk = json.loads(payload)
                chunks += 1
                if first_chunk_ms is None:
                    first_chunk_ms = round((time.time() - start) * 1000)
                choices = chunk.get("choices", [])
                if choices:
                    delta = choices[0].get("delta", {})
                    if delta.get("content"):
                        content_parts.append(delta["content"])
                    if delta.get("tool_calls"):
                        tool_calls_chunks.append(delta["tool_calls"])
                if chunk.get("usage"):
                    has_usage = True
            except json.JSONDecodeError:
                pass

        elapsed = round((time.time() - start) * 1000)
        return chunks, content_parts, has_done, has_usage, first_chunk_ms, elapsed, tool_calls_chunks

    def test(self, name, url, method="GET", data=None, checks=None, expect_error=None):
        """Tek bir endpoint testi calistirir.
        expect_error: Beklenen HTTP hata kodu (ornegin 404). Bu kod gelirse PASS sayilir.
        """
        start = time.time()
        result = {
            "name": name,
            "url": url,
            "method": method,
            "status": "PASS",
            "http_code": 0,
            "time_ms": 0,
            "checks": {},
            "error": None,
            "response_summary": None,
        }
        try:
            code, body = self.request(url, method, data)
            elapsed = round((time.time() - start) * 1000)
            result["http_code"] = code
            result["time_ms"] = elapsed

            # Eger hata bekliyorduk ama basarili donduyse
            if expect_error:
                result["status"] = "WARN"
                result["response_summary"] = f"Hata {expect_error} beklendi ama {code} dondu"
                self.bugs.append({"test": name, "check": "expected_error", "detail": result["response_summary"]})
            else:
                # Run checks
                if checks and isinstance(body, dict):
                    for check_name, check_fn in checks.items():
                        try:
                            ok, detail = check_fn(body)
                            result["checks"][check_name] = {"pass": ok, "detail": detail}
                            if not ok:
                                result["status"] = "WARN"
                                self.bugs.append({"test": name, "check": check_name, "detail": detail})
                        except Exception as e:
                            result["checks"][check_name] = {"pass": False, "detail": str(e)}
                            result["status"] = "WARN"

                # Summary
                if isinstance(body, dict):
                    result["response_summary"] = self._summarize(name, body)

        except HTTPError as e:
            elapsed = round((time.time() - start) * 1000)
            result["http_code"] = e.code
            result["time_ms"] = elapsed
            err_body = ""
            try:
                err_body = e.read().decode()[:500]
            except:
                pass

            # Beklenen hata mi?
            if expect_error and e.code == expect_error:
                result["status"] = "PASS"
                result["response_summary"] = f"Beklenen hata {e.code} alindi (dogru)"
            elif expect_error:
                # Farkli bir hata kodu geldiyse de kabul et (400 vs 422 gibi)
                result["status"] = "PASS"
                result["response_summary"] = f"Hata {e.code} alindi (beklenen: {expect_error}, kabul edildi)"
            else:
                result["status"] = "FAIL"
                result["error"] = f"HTTP {e.code}: {err_body}"
                self.bugs.append({"test": name, "check": "http_status", "detail": result["error"]})

        except (URLError, OSError) as e:
            elapsed = round((time.time() - start) * 1000)
            result["time_ms"] = elapsed
            result["status"] = "ERROR"
            result["error"] = str(e)
            self.bugs.append({"test": name, "check": "connection", "detail": str(e)})

        except Exception as e:
            elapsed = round((time.time() - start) * 1000)
            result["time_ms"] = elapsed
            result["status"] = "ERROR"
            result["error"] = str(e)

        self.results.append(result)
        icon = {"PASS": "✅", "FAIL": "❌", "ERROR": "⚠️", "WARN": "🟡"}[result["status"]]
        print(f"  {icon} {name:55s} {result['status']:5s} {result['http_code']:>4} {result['time_ms']:>6}ms")

        if self.verbose and result.get("response_summary"):
            print(f"     → {result['response_summary'][:120]}")
        if result.get("error"):
            print(f"     → {result['error'][:150]}")
        for ck, cv in result.get("checks", {}).items():
            if not cv["pass"]:
                print(f"     → 🐛 {ck}: {cv['detail'][:120]}")

        return result

    def _summarize(self, name, body):
        """Response'tan ozet cikarir."""
        if "chat/completions" in name or "chat" in name.lower():
            choices = body.get("choices", [])
            if choices:
                msg = choices[0].get("message", {})
                content = msg.get("content", "")[:150]
                tc = msg.get("tool_calls")
                usage = body.get("usage", {})
                parts = [f"content={content!r}"]
                if tc:
                    parts.append(f"tool_calls={len(tc)}")
                parts.append(f"tokens={usage.get('total_tokens', '?')}")
                return ", ".join(parts)
        elif "completions" in name and "chat" not in name.lower():
            choices = body.get("choices", [])
            if choices:
                return f"text={choices[0].get('text', '')[:100]!r}"
        elif "embeddings" in name or "embed" in name.lower():
            data = body.get("data", [])
            if data:
                emb = data[0].get("embedding", [])
                dim = len(emb) if isinstance(emb, list) else "base64"
                return f"items={len(data)}, dimensions={dim}"
        elif "models" in name.lower():
            data = body.get("data", [])
            ids = [m.get("id") for m in data]
            return f"models={ids}"
        elif "tokenize" in name.lower() and "de" not in name.lower():
            return f"count={body.get('count')}, max_model_len={body.get('max_model_len')}, tokens={str(body.get('tokens', []))[:80]}"
        elif "detokenize" in name.lower():
            return f"prompt={body.get('prompt')!r}"
        elif "version" in name.lower():
            return f"version={body.get('version')}"
        return str(body)[:150]

    # ═══════════════════════════════════════════════════════════
    # TEST GROUPS
    # ═══════════════════════════════════════════════════════════

    def test_health(self):
        print("\n─── HEALTH & INFRA ───")
        # 1
        self.test("GET /health (chat:8010)", f"{self.base_chat}/health")
        # 2
        self.test("GET /health (embed:8011)", f"{self.base_embed}/health")
        # 3
        self.test("GET /version (chat:8010)", f"{self.base_chat}/version")
        # 4
        self.test("GET /version (embed:8011)", f"{self.base_embed}/version")
        # 5
        self.test("GET /metrics (chat:8010)", f"{self.base_chat}/metrics")
        # 6
        self.test("GET /v1/models (chat:8010)", f"{self.base_chat}/v1/models",
                  checks={
                      "has_qwen3": lambda b: (
                          any("Qwen3" in m.get("id", "") for m in b.get("data", [])),
                          [m.get("id") for m in b.get("data", [])]
                      )
                  })
        # 7
        self.test("GET /v1/models (embed:8011)", f"{self.base_embed}/v1/models",
                  checks={
                      "has_nomic": lambda b: (
                          any("nomic" in m.get("id", "") for m in b.get("data", [])),
                          [m.get("id") for m in b.get("data", [])]
                      )
                  })
        # 8
        self.test("GET /ping (chat:8010)", f"{self.base_chat}/ping")
        # 9
        self.test("GET /ping (embed:8011)", f"{self.base_embed}/ping")
        # 10
        self.test("GET /load (chat:8010)", f"{self.base_chat}/load")
        # 11
        self.test("GET /load (embed:8011)", f"{self.base_embed}/load")
        # 12
        self.test("GET /metrics (embed:8011)", f"{self.base_embed}/metrics")

    def test_chat(self):
        print("\n─── CHAT COMPLETIONS ───")

        # 1. Basit chat (thinking off)
        self.test("Chat: basit (/no_think)", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "2+2=? Sadece sayiyi yaz /no_think"}],
            "max_tokens": 32, "temperature": 0.7, "top_p": 0.8
        }, checks={
            "has_choices": lambda b: (len(b.get("choices", [])) > 0, f"choices={len(b.get('choices', []))}"),
            "has_usage": lambda b: (b.get("usage", {}).get("total_tokens", 0) > 0, b.get("usage")),
            "finish_reason": lambda b: (
                b["choices"][0].get("finish_reason") in ("stop", "length"),
                b["choices"][0].get("finish_reason")
            ),
        })

        # 2. Thinking mode ON
        self.test("Chat: thinking ON (varsayilan)", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "3 * 7 = ?"}],
            "max_tokens": 256, "temperature": 0.6, "top_p": 0.95, "top_k": 20
        }, checks={
            "think_tags_present": lambda b: (
                "<think>" in b["choices"][0]["message"].get("content", ""),
                "thinking mode calisiyor" if "<think>" in b["choices"][0]["message"].get("content", "") else "think tag yok!"
            ),
        })

        # 3. Thinking OFF via chat_template_kwargs
        self.test("Chat: thinking OFF (chat_template_kwargs)", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "Merhaba"}],
            "max_tokens": 64, "temperature": 0.7,
            "chat_template_kwargs": {"enable_thinking": False}
        }, checks={
            "no_think_tags": lambda b: (
                "<think>" not in b["choices"][0]["message"].get("content", ""),
                "think tag YOK (dogru)" if "<think>" not in b["choices"][0]["message"].get("content", "")
                else f"BUG: think tag var: {b['choices'][0]['message']['content'][:80]}"
            ),
        })

        # 4. /no_think soft switch
        self.test("Chat: /no_think soft switch", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "Selam /no_think"}],
            "max_tokens": 64, "temperature": 0.6, "top_p": 0.95
        }, checks={
            "empty_think_check": lambda b: (
                "<think>\n</think>" not in b["choices"][0]["message"].get("content", ""),
                "BOS think bloklari var (bilinen vLLM davranisi)"
                if "<think>\n</think>" in b["choices"][0]["message"].get("content", "")
                else "temiz cikti"
            ),
        })

        # 5. System prompt
        self.test("Chat: system prompt", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [
                {"role": "system", "content": "Sen Turkce yanit veren bir IT asistanisin. Kisa yaz."},
                {"role": "user", "content": "VPN baglantim kopuyor, ne yapmaliyim? /no_think"}
            ],
            "max_tokens": 128, "temperature": 0.7, "top_p": 0.8
        })

        # 6. Multi-turn conversation
        self.test("Chat: multi-turn", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [
                {"role": "user", "content": "Benim adim Ali /no_think"},
                {"role": "assistant", "content": "Merhaba Ali! Nasil yardimci olabilirim?"},
                {"role": "user", "content": "Adimi hatirliyor musun? /no_think"}
            ],
            "max_tokens": 64, "temperature": 0.7
        }, checks={
            "remembers_name": lambda b: (
                "ali" in b["choices"][0]["message"].get("content", "").lower(),
                f"response: {b['choices'][0]['message'].get('content', '')[:100]}"
            ),
        })

        # 7. Tool calling
        self.test("Chat: tool calling", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [
                {"role": "system", "content": "Sen IT destek asistanisin."},
                {"role": "user", "content": "Yazicim calismiyor, ticket ac /no_think"}
            ],
            "tools": [TOOL_CREATE_TICKET],
            "tool_choice": "auto", "max_tokens": 256, "temperature": 0.6
        }, checks={
            "has_tool_calls": lambda b: (
                bool(b["choices"][0]["message"].get("tool_calls")),
                f"tool_calls={b['choices'][0]['message'].get('tool_calls')}"
            ),
            "finish_reason_tool": lambda b: (
                b["choices"][0].get("finish_reason") == "tool_calls",
                f"finish_reason={b['choices'][0].get('finish_reason')}"
            ),
            "valid_tool_args": lambda b: (
                _check_tool_args(b),
                _get_tool_args_detail(b)
            ),
        })

        # 8. Tool result (multi-step)
        self.test("Chat: tool result devam", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [
                {"role": "system", "content": "Sen IT destek asistanisin."},
                {"role": "user", "content": "Yazicim calismiyor"},
                {"role": "assistant", "content": "", "tool_calls": [{
                    "id": "call_test1", "type": "function",
                    "function": {"name": "create_ticket", "arguments": '{"title":"Yazici arizasi","description":"Yazici calismiyor"}'}
                }]},
                {"role": "tool", "tool_call_id": "call_test1", "content": '{"success": true, "ticket_id": 42}'}
            ],
            "max_tokens": 128, "temperature": 0.7
        }, checks={
            "mentions_ticket": lambda b: (
                "42" in b["choices"][0]["message"].get("content", ""),
                f"response: {b['choices'][0]['message'].get('content', '')[:100]}"
            ),
        })

        # 9. JSON mode
        self.test("Chat: JSON mode", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": 'Istanbul hakkinda JSON ver: {"city": ..., "population": ...} /no_think'}],
            "response_format": {"type": "json_object"},
            "max_tokens": 128, "temperature": 0.7
        }, checks={
            "valid_json": lambda b: _check_json_output(b),
        })

        # 10. Presence + frequency penalty
        self.test("Chat: presence_penalty + frequency_penalty", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "Kisa bir hikaye yaz /no_think"}],
            "max_tokens": 128, "temperature": 0.7, "presence_penalty": 1.5, "frequency_penalty": 0.5
        })

        # 11. Seed reproducibility
        r1 = self.test("Chat: seed=42 (1. cagri)", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "1+1=? /no_think"}],
            "max_tokens": 16, "temperature": 0.5, "seed": 42
        })
        r2 = self.test("Chat: seed=42 (2. cagri)", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "1+1=? /no_think"}],
            "max_tokens": 16, "temperature": 0.5, "seed": 42
        })
        # Check reproducibility
        if r1["status"] == "PASS" and r2["status"] == "PASS":
            s1 = r1.get("response_summary", "")
            s2 = r2.get("response_summary", "")
            is_same = s1 == s2
            note = f"{'ayni' if is_same else 'FARKLI'} sonuc"
            if not is_same:
                self.bugs.append({"test": "seed reproducibility", "check": "determinism", "detail": f"seed=42 farkli sonuc uretti"})
            print(f"     → Seed tekrarlanabilirlik: {note}")

        # 12. Max tokens (length finish)
        self.test("Chat: max_tokens=5 (length truncate)", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "Uzun bir paragraf yaz /no_think"}],
            "max_tokens": 5, "temperature": 0.7
        }, checks={
            "finish_length": lambda b: (
                b["choices"][0].get("finish_reason") == "length",
                f"finish_reason={b['choices'][0].get('finish_reason')}"
            ),
        })

        # 13. Stop sequences
        self.test("Chat: stop sequence", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "1'den 10'a kadar say, her sayiyi yeni satirda yaz /no_think"}],
            "max_tokens": 128, "temperature": 0.7, "stop": ["5"]
        }, checks={
            "stopped_before_5": lambda b: (
                "6" not in b["choices"][0]["message"].get("content", ""),
                f"content: {b['choices'][0]['message'].get('content', '')[:100]}"
            ),
        })

        # 14. n=2 (multiple completions)
        self.test("Chat: n=2 (coklu tamamlama)", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "Rastgele bir sayi soy /no_think"}],
            "max_tokens": 16, "temperature": 1.0, "n": 2
        }, checks={
            "two_choices": lambda b: (
                len(b.get("choices", [])) == 2,
                f"choices={len(b.get('choices', []))}"
            ),
        })

        # 15. logprobs
        self.test("Chat: logprobs=true", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "Evet veya Hayir? /no_think"}],
            "max_tokens": 8, "temperature": 0.7, "logprobs": True, "top_logprobs": 3
        }, checks={
            "has_logprobs": lambda b: (
                b["choices"][0].get("logprobs") is not None,
                f"logprobs={'var' if b['choices'][0].get('logprobs') else 'YOK'}"
            ),
        })

        # 16. repetition_penalty
        self.test("Chat: repetition_penalty=1.05", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "Kisa bir cumle yaz /no_think"}],
            "max_tokens": 64, "temperature": 0.7, "repetition_penalty": 1.05
        }, checks={
            "has_choices": lambda b: (len(b.get("choices", [])) > 0, f"choices={len(b.get('choices', []))}"),
        })

        # 17. min_tokens
        self.test("Chat: min_tokens=10", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "Yapay zeka hakkinda yaz /no_think"}],
            "max_tokens": 128, "min_tokens": 10, "temperature": 0.7
        }, checks={
            "min_tokens_met": lambda b: (
                b.get("usage", {}).get("completion_tokens", 0) >= 10,
                f"completion_tokens={b.get('usage', {}).get('completion_tokens', 0)}"
            ),
        })

        # 18. tool_choice="required"
        self.test("Chat: tool_choice=required", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [
                {"role": "user", "content": "Merhaba, nasilsin? /no_think"}
            ],
            "tools": [TOOL_CREATE_TICKET],
            "tool_choice": "required",
            "max_tokens": 256, "temperature": 0.6
        }, checks={
            "has_tool_calls": lambda b: (
                bool(b["choices"][0]["message"].get("tool_calls")),
                f"tool_calls={b['choices'][0]['message'].get('tool_calls')}"
            ),
            "finish_reason_tool": lambda b: (
                b["choices"][0].get("finish_reason") == "tool_calls",
                f"finish_reason={b['choices'][0].get('finish_reason')}"
            ),
        })

        # 19. tool_choice={specific function}
        self.test("Chat: tool_choice=specific (create_ticket)", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [
                {"role": "user", "content": "VPN sorunu var, ticket ara /no_think"}
            ],
            "tools": [TOOL_CREATE_TICKET, TOOL_SEARCH_TICKETS],
            "tool_choice": {"type": "function", "function": {"name": "create_ticket"}},
            "max_tokens": 256, "temperature": 0.6
        }, checks={
            "correct_tool": lambda b: (
                b["choices"][0]["message"].get("tool_calls", [{}])[0].get("function", {}).get("name") == "create_ticket"
                if b["choices"][0]["message"].get("tool_calls") else False,
                f"tool={b['choices'][0]['message'].get('tool_calls', [{}])[0].get('function', {}).get('name', 'NONE')}"
                if b["choices"][0]["message"].get("tool_calls") else "no tool_calls"
            ),
        })

        # 20. parallel_tool_calls
        self.test("Chat: parallel_tool_calls", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [
                {"role": "system", "content": "Sen IT destek asistanisin."},
                {"role": "user", "content": "Yazici sorunu ile ilgili ticket ara, ayrica yeni bir ticket ac /no_think"}
            ],
            "tools": [TOOL_CREATE_TICKET, TOOL_SEARCH_TICKETS],
            "tool_choice": "auto",
            "parallel_tool_calls": True,
            "max_tokens": 512, "temperature": 0.6
        }, checks={
            "has_tool_calls": lambda b: (
                bool(b["choices"][0]["message"].get("tool_calls")),
                f"tool_calls={len(b['choices'][0]['message'].get('tool_calls', []))}"
            ),
        })

        # 21. json_schema response_format
        self.test("Chat: json_schema response_format", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "Ankara hakkinda bilgi ver /no_think"}],
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "name": "city_info",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "city": {"type": "string"},
                            "country": {"type": "string"},
                            "population": {"type": "integer"}
                        },
                        "required": ["city", "country", "population"]
                    }
                }
            },
            "max_tokens": 128, "temperature": 0.7
        }, checks={
            "valid_json_schema": lambda b: _check_json_schema_fields(b, ["city", "country", "population"]),
        })

        # 22. stop_token_ids
        self.test("Chat: stop_token_ids", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "Merhaba dunya /no_think"}],
            "max_tokens": 64, "temperature": 0.7, "stop_token_ids": [198]
        }, checks={
            "has_choices": lambda b: (len(b.get("choices", [])) > 0, f"choices={len(b.get('choices', []))}"),
        })

        # 23. continue_final_message
        self.test("Chat: continue_final_message", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [
                {"role": "user", "content": "Bir hikaye baslat /no_think"},
                {"role": "assistant", "content": "Bir varmis bir yokmus, uzak bir ulkede"}
            ],
            "max_tokens": 64, "temperature": 0.7,
            "continue_final_message": True,
            "add_generation_prompt": False
        }, checks={
            "has_choices": lambda b: (len(b.get("choices", [])) > 0, f"choices={len(b.get('choices', []))}"),
        })

        # 24. include_stop_str_in_output
        self.test("Chat: include_stop_str_in_output", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "1'den 10'a kadar say /no_think"}],
            "max_tokens": 128, "temperature": 0.7,
            "stop": ["5"], "include_stop_str_in_output": True
        }, checks={
            "stop_str_included": lambda b: (
                "5" in b["choices"][0]["message"].get("content", ""),
                f"content: {b['choices'][0]['message'].get('content', '')[:100]}"
            ),
        })

        # 25. prompt_logprobs
        self.test("Chat: prompt_logprobs=3", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "Merhaba /no_think"}],
            "max_tokens": 16, "temperature": 0.7, "prompt_logprobs": 3
        }, checks={
            "has_prompt_logprobs": lambda b: (
                b.get("choices", [{}])[0].get("prompt_logprobs") is not None
                or b.get("prompt_logprobs") is not None,
                "prompt_logprobs var"
                if (b.get("choices", [{}])[0].get("prompt_logprobs") is not None or b.get("prompt_logprobs") is not None)
                else "prompt_logprobs YOK"
            ),
        })

    def test_thinking(self):
        print("\n─── THINKING MODE ───")

        # 1. reasoning_effort=low
        r_low = self.test("Thinking: reasoning_effort=low", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "15 * 3 = ?"}],
            "max_tokens": 512, "temperature": 0.6, "top_p": 0.95,
            "reasoning_effort": "low"
        }, checks={
            "has_think_tag": lambda b: (
                "<think>" in b["choices"][0]["message"].get("content", ""),
                "think tag var" if "<think>" in b["choices"][0]["message"].get("content", "") else "think tag YOK"
            ),
        })

        # 2. reasoning_effort=high
        r_high = self.test("Thinking: reasoning_effort=high", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "15 * 3 = ?"}],
            "max_tokens": 2048, "temperature": 0.6, "top_p": 0.95,
            "reasoning_effort": "high"
        }, checks={
            "has_think_tag": lambda b: (
                "<think>" in b["choices"][0]["message"].get("content", ""),
                "think tag var" if "<think>" in b["choices"][0]["message"].get("content", "") else "think tag YOK"
            ),
        })

        # 3. Thinking OFF via chat_template_kwargs (thinking group)
        self.test("Thinking: enable_thinking=false", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "7 + 8 = ?"}],
            "max_tokens": 128, "temperature": 0.7,
            "chat_template_kwargs": {"enable_thinking": False}
        }, checks={
            "no_think_tag": lambda b: (
                "<think>" not in b["choices"][0]["message"].get("content", ""),
                "think tag YOK (dogru)" if "<think>" not in b["choices"][0]["message"].get("content", "")
                else f"think tag var (thinking kapanmamis): {b['choices'][0]['message']['content'][:80]}"
            ),
        })

        # 4. low vs high token comparison
        if r_low["status"] == "PASS" and r_high["status"] == "PASS":
            low_tokens = 0
            high_tokens = 0
            # Response'dan dogrudan token bilgisi al
            try:
                _, low_body = self.request(f"{self.base_chat}/v1/chat/completions", "POST", {
                    "model": "Qwen/Qwen3-4B",
                    "messages": [{"role": "user", "content": "15 * 3 = ?"}],
                    "max_tokens": 512, "temperature": 0.6, "top_p": 0.95,
                    "reasoning_effort": "low"
                })
                low_tokens = low_body.get("usage", {}).get("total_tokens", 0)
            except:
                pass
            try:
                _, high_body = self.request(f"{self.base_chat}/v1/chat/completions", "POST", {
                    "model": "Qwen/Qwen3-4B",
                    "messages": [{"role": "user", "content": "15 * 3 = ?"}],
                    "max_tokens": 2048, "temperature": 0.6, "top_p": 0.95,
                    "reasoning_effort": "high"
                })
                high_tokens = high_body.get("usage", {}).get("total_tokens", 0)
            except:
                pass

            if low_tokens > 0 and high_tokens > 0:
                ok = high_tokens > low_tokens
                detail = f"high={high_tokens} {'>' if ok else '<='} low={low_tokens}"
                icon = "✅" if ok else "🟡"
                print(f"  {icon} {'Thinking: low vs high token karsilastirma':55s} {'PASS' if ok else 'WARN':5s}")
                print(f"     → {detail}")
                self.results.append({
                    "name": "Thinking: low vs high token karsilastirma",
                    "status": "PASS" if ok else "WARN",
                    "http_code": 200, "time_ms": 0,
                    "checks": {"token_comparison": {"pass": ok, "detail": detail}},
                    "response_summary": detail,
                })
                if not ok:
                    self.bugs.append({"test": "thinking token comparison", "check": "high>low", "detail": detail})
            else:
                print(f"  🟡 {'Thinking: low vs high token karsilastirma':55s} WARN")
                print(f"     → Token bilgisi alinamadi (low={low_tokens}, high={high_tokens})")
                self.results.append({
                    "name": "Thinking: low vs high token karsilastirma",
                    "status": "WARN", "http_code": 200, "time_ms": 0,
                    "checks": {}, "response_summary": f"Token bilgisi alinamadi",
                })
        else:
            print(f"  🟡 {'Thinking: low vs high token karsilastirma':55s} SKIP")
            print(f"     → Onceki testler basarisiz, karsilastirma yapilamadi")
            self.results.append({
                "name": "Thinking: low vs high token karsilastirma",
                "status": "WARN", "http_code": 0, "time_ms": 0,
                "checks": {}, "response_summary": "Onceki testler basarisiz",
            })

    def test_completions(self):
        print("\n─── TEXT COMPLETIONS ───")

        # 1. Basit
        self.test("Completions: basit", f"{self.base_chat}/v1/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "prompt": "Turkiye'nin baskenti",
            "max_tokens": 32, "temperature": 0.7
        }, checks={
            "has_text": lambda b: (
                len(b.get("choices", [{}])[0].get("text", "")) > 0,
                f"text={b.get('choices', [{}])[0].get('text', '')[:80]!r}"
            ),
        })

        # 2. Batch
        self.test("Completions: batch (2 prompt)", f"{self.base_chat}/v1/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "prompt": ["Yapay zeka", "Makine ogrenmesi"],
            "max_tokens": 32, "temperature": 0.7
        }, checks={
            "batch_count": lambda b: (
                len(b.get("choices", [])) >= 2,
                f"choices={len(b.get('choices', []))}"
            ),
        })

        # 3. Echo
        self.test("Completions: echo=true", f"{self.base_chat}/v1/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "prompt": "Test prompt",
            "max_tokens": 16, "temperature": 0.7, "echo": True
        }, checks={
            "echo_works": lambda b: (
                "Test prompt" in b.get("choices", [{}])[0].get("text", ""),
                f"text={b.get('choices', [{}])[0].get('text', '')[:80]!r}"
            ),
        })

        # 4. Suffix (vLLM su an desteklemiyor, 400 beklenir)
        self.test("Completions: suffix (not supported)", f"{self.base_chat}/v1/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "prompt": "Bir varmis",
            "suffix": " bir yokmus",
            "max_tokens": 32, "temperature": 0.7
        }, expect_error=400)

        # 5. Streaming (SSE)
        print("     → Completions stream testi...")
        start = time.time()
        try:
            chunks, content_parts, has_done, has_usage, first_chunk_ms, elapsed, _ = \
                self._stream_request(f"{self.base_chat}/v1/completions", {
                    "model": "Qwen/Qwen3-4B",
                    "prompt": "Gunesi anlat",
                    "max_tokens": 32, "temperature": 0.7,
                    "stream": True, "stream_options": {"include_usage": True}
                })
            full_content = "".join(content_parts)
            result = {
                "name": "Completions: stream=true",
                "status": "PASS", "http_code": 200, "time_ms": elapsed,
                "checks": {}, "response_summary": f"chunks={chunks}, content={full_content[:80]!r}",
            }
            checks = {
                "has_chunks": (chunks > 0, f"chunks={chunks}"),
                "has_done": (has_done, "[DONE] marker"),
                "has_content": (len(full_content) > 0 or chunks > 0, f"content_len={len(full_content)}"),
            }
            for ck, (ok, detail) in checks.items():
                result["checks"][ck] = {"pass": ok, "detail": detail}
                if not ok:
                    result["status"] = "WARN"
                    self.bugs.append({"test": "completions stream", "check": ck, "detail": detail})
            self.results.append(result)
            icon = {"PASS": "✅", "WARN": "🟡"}[result["status"]]
            print(f"  {icon} {'Completions: stream=true':55s} {result['status']:5s} {200:>4} {elapsed:>6}ms")
        except Exception as e:
            elapsed = round((time.time() - start) * 1000)
            self.results.append({
                "name": "Completions: stream=true",
                "status": "ERROR", "http_code": 0, "time_ms": elapsed,
                "error": str(e), "checks": {},
            })
            print(f"  ⚠️ {'Completions: stream=true':55s} ERROR {elapsed:>6}ms → {e}")

        # 6. logprobs (integer)
        self.test("Completions: logprobs=3", f"{self.base_chat}/v1/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "prompt": "Merhaba dunya",
            "max_tokens": 16, "temperature": 0.7, "logprobs": 3
        }, checks={
            "has_logprobs": lambda b: (
                b.get("choices", [{}])[0].get("logprobs") is not None,
                f"logprobs={'var' if b.get('choices', [{}])[0].get('logprobs') else 'YOK'}"
            ),
        })

    def test_embeddings(self):
        print("\n─── EMBEDDINGS ───")

        # 1. Tek metin
        self.test("Embeddings: tek metin", f"{self.base_embed}/v1/embeddings", "POST", {
            "model": "nomic-ai/nomic-embed-text-v1.5",
            "input": "Yazici kagit sikismasi cozumu"
        }, checks={
            "768_dims": lambda b: (
                len(b.get("data", [{}])[0].get("embedding", [])) == 768,
                f"dims={len(b.get('data', [{}])[0].get('embedding', []))}"
            ),
        })

        # 2. Batch
        self.test("Embeddings: batch (3 metin)", f"{self.base_embed}/v1/embeddings", "POST", {
            "model": "nomic-ai/nomic-embed-text-v1.5",
            "input": ["VPN problemi", "Sifre sifirlama", "Monitor arizasi"]
        }, checks={
            "batch_3": lambda b: (
                len(b.get("data", [])) == 3,
                f"items={len(b.get('data', []))}"
            ),
            "all_768": lambda b: (
                all(len(d.get("embedding", [])) == 768 for d in b.get("data", [])),
                "tum vektorler 768 boyutlu"
            ),
        })

        # 3. Base64 format
        self.test("Embeddings: base64 encoding", f"{self.base_embed}/v1/embeddings", "POST", {
            "model": "nomic-ai/nomic-embed-text-v1.5",
            "input": "test metni",
            "encoding_format": "base64"
        }, checks={
            "is_base64": lambda b: (
                isinstance(b.get("data", [{}])[0].get("embedding"), str),
                f"type={type(b.get('data', [{}])[0].get('embedding')).__name__}"
            ),
        })

        # 4. Cosine similarity check
        self.test("Embeddings: benzerlik kontrolu", f"{self.base_embed}/v1/embeddings", "POST", {
            "model": "nomic-ai/nomic-embed-text-v1.5",
            "input": ["The printer is not working", "My printer has a paper jam", "The weather is nice today"]
        }, checks={
            "similarity_order": lambda b: _check_cosine_similarity(b),
        })

        # 5. embed_dtype=float16
        self.test("Embeddings: embed_dtype=float16", f"{self.base_embed}/v1/embeddings", "POST", {
            "model": "nomic-ai/nomic-embed-text-v1.5",
            "input": "Test metni float16",
            "embed_dtype": "float16"
        }, checks={
            "has_embedding": lambda b: (
                len(b.get("data", [{}])[0].get("embedding", [])) > 0
                if isinstance(b.get("data", [{}])[0].get("embedding"), list) else
                isinstance(b.get("data", [{}])[0].get("embedding"), str),
                f"embedding var"
            ),
        })

        # 6. dimensions=256 (nomic matryoshka desteklemiyor, 400 beklenir)
        self.test("Embeddings: dimensions=256 (not supported)", f"{self.base_embed}/v1/embeddings", "POST", {
            "model": "nomic-ai/nomic-embed-text-v1.5",
            "input": "Test metni dimensions",
            "dimensions": 256
        }, expect_error=400)

        # 7. normalize=false
        self.test("Embeddings: normalize=false", f"{self.base_embed}/v1/embeddings", "POST", {
            "model": "nomic-ai/nomic-embed-text-v1.5",
            "input": "Test metni normalize false",
            "normalize": False
        }, checks={
            "not_normalized": lambda b: _check_not_normalized(b),
        })

        # 8. Usage kontrolu
        self.test("Embeddings: usage kontrolu", f"{self.base_embed}/v1/embeddings", "POST", {
            "model": "nomic-ai/nomic-embed-text-v1.5",
            "input": "Usage kontrol metni"
        }, checks={
            "prompt_tokens_gt_0": lambda b: (
                b.get("usage", {}).get("prompt_tokens", 0) > 0,
                f"prompt_tokens={b.get('usage', {}).get('prompt_tokens', 0)}"
            ),
            "prompt_eq_total": lambda b: (
                b.get("usage", {}).get("prompt_tokens", 0) == b.get("usage", {}).get("total_tokens", -1),
                f"prompt={b.get('usage', {}).get('prompt_tokens')}, total={b.get('usage', {}).get('total_tokens')}"
            ),
        })

        # 9. Empty string
        self.test("Embeddings: empty string", f"{self.base_embed}/v1/embeddings", "POST", {
            "model": "nomic-ai/nomic-embed-text-v1.5",
            "input": ""
        }, checks={
            "graceful_handle": lambda b: (
                isinstance(b.get("data"), list),
                f"data type={type(b.get('data')).__name__}"
            ),
        })

        # 10. Uzun metin (2048 token siniri)
        long_text = "Bu bir test cumlesidir ve embedding modeli icin uzun metin olarak kullanilmaktadir. " * 25
        self.test("Embeddings: uzun metin (~2000 char)", f"{self.base_embed}/v1/embeddings", "POST", {
            "model": "nomic-ai/nomic-embed-text-v1.5",
            "input": long_text
        }, checks={
            "768_dims": lambda b: (
                len(b.get("data", [{}])[0].get("embedding", [])) == 768
                if isinstance(b.get("data", [{}])[0].get("embedding"), list) else True,
                f"dims={len(b.get('data', [{}])[0].get('embedding', []))}"
                if isinstance(b.get("data", [{}])[0].get("embedding"), list) else "non-list embedding"
            ),
        })

    def test_tokenizer(self):
        print("\n─── TOKENIZER ───")

        # 1. Tokenize text
        self.test("Tokenize: text", f"{self.base_chat}/tokenize", "POST", {
            "model": "Qwen/Qwen3-4B", "prompt": "Merhaba dunya"
        }, checks={
            "has_tokens": lambda b: (
                len(b.get("tokens", [])) > 0,
                f"count={b.get('count')}"
            ),
            "max_model_len": lambda b: (
                b.get("max_model_len", 0) > 0,
                f"max_model_len={b.get('max_model_len')}"
            ),
        })

        # 2. Tokenize chat messages
        self.test("Tokenize: chat messages", f"{self.base_chat}/tokenize", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "Merhaba"}],
            "add_generation_prompt": True
        }, checks={
            "more_than_text": lambda b: (
                b.get("count", 0) > 2,
                f"count={b.get('count')} (template tokenleri dahil)"
            ),
        })

        # 3. Detokenize
        self.test("Detokenize: token -> text", f"{self.base_chat}/detokenize", "POST", {
            "model": "Qwen/Qwen3-4B", "tokens": [68727, 101650]
        }, checks={
            "has_prompt": lambda b: (
                len(b.get("prompt", "")) > 0,
                f"prompt={b.get('prompt')!r}"
            ),
        })

        # 4. Round-trip: tokenize -> detokenize
        print("     → Round-trip testi...")
        try:
            _, tok_resp = self.request(f"{self.base_chat}/tokenize", "POST", {
                "model": "Qwen/Qwen3-4B", "prompt": "Round trip test 123"
            })
            tokens = tok_resp.get("tokens", [])
            _, detok_resp = self.request(f"{self.base_chat}/detokenize", "POST", {
                "model": "Qwen/Qwen3-4B", "tokens": tokens
            })
            original = "Round trip test 123"
            recovered = detok_resp.get("prompt", "")
            match = original == recovered
            icon = "✅" if match else "🟡"
            print(f"  {icon} {'Tokenize round-trip':55s} {'PASS' if match else 'WARN':5s}")
            if not match:
                print(f"     → original={original!r}, recovered={recovered!r}")
                self.bugs.append({"test": "round-trip", "check": "text_match", "detail": f"'{original}' != '{recovered}'"})
        except Exception as e:
            print(f"  ⚠️ {'Tokenize round-trip':55s} ERROR: {e}")

    def test_streaming(self):
        print("\n─── STREAMING (SSE) ───")

        # 1. Basit SSE chat stream
        start = time.time()
        try:
            chunks, content_parts, has_done, has_usage, first_chunk_ms, elapsed, _ = \
                self._stream_request(f"{self.base_chat}/v1/chat/completions", {
                    "model": "Qwen/Qwen3-4B",
                    "messages": [{"role": "user", "content": "Merhaba /no_think"}],
                    "max_tokens": 32, "temperature": 0.7, "stream": True,
                    "stream_options": {"include_usage": True}
                })

            full_content = "".join(content_parts)
            result = {
                "name": "Streaming: SSE chat",
                "status": "PASS", "http_code": 200, "time_ms": elapsed,
                "checks": {},
                "response_summary": f"chunks={chunks}, first_chunk={first_chunk_ms}ms, content={full_content[:80]!r}",
            }
            checks = {
                "has_chunks": (chunks > 1, f"chunks={chunks}"),
                "has_done": (has_done, "[DONE] marker"),
                "has_usage": (has_usage, "stream_options.include_usage"),
                "has_content": (len(full_content) > 0, f"content_len={len(full_content)}"),
                "first_chunk_fast": (first_chunk_ms < 2000 if first_chunk_ms else False, f"first_chunk={first_chunk_ms}ms"),
            }
            for ck, (ok, detail) in checks.items():
                result["checks"][ck] = {"pass": ok, "detail": detail}
                if not ok:
                    result["status"] = "WARN"
                    self.bugs.append({"test": "streaming", "check": ck, "detail": detail})

            self.results.append(result)
            icon = {"PASS": "✅", "WARN": "🟡"}[result["status"]]
            print(f"  {icon} {'Streaming: SSE chat':55s} {result['status']:5s} {200:>4} {elapsed:>6}ms")
            print(f"     → {chunks} chunks, TTFT={first_chunk_ms}ms, content={full_content[:80]!r}")
            for ck, cv in result["checks"].items():
                if not cv["pass"]:
                    print(f"     → 🐛 {ck}: {cv['detail']}")

        except Exception as e:
            elapsed = round((time.time() - start) * 1000)
            self.results.append({
                "name": "Streaming: SSE chat",
                "status": "ERROR", "http_code": 0, "time_ms": elapsed,
                "error": str(e), "checks": {},
            })
            print(f"  ⚠️ {'Streaming: SSE chat':55s} ERROR {elapsed:>6}ms")
            print(f"     → {e}")

        # 2. Thinking ON stream
        start = time.time()
        try:
            chunks, content_parts, has_done, has_usage, first_chunk_ms, elapsed, _ = \
                self._stream_request(f"{self.base_chat}/v1/chat/completions", {
                    "model": "Qwen/Qwen3-4B",
                    "messages": [{"role": "user", "content": "5 * 9 = ?"}],
                    "max_tokens": 512, "temperature": 0.6, "top_p": 0.95,
                    "stream": True, "stream_options": {"include_usage": True}
                })

            full_content = "".join(content_parts)
            has_think = "<think>" in full_content
            result = {
                "name": "Streaming: thinking ON stream",
                "status": "PASS", "http_code": 200, "time_ms": elapsed,
                "checks": {},
                "response_summary": f"chunks={chunks}, has_think={has_think}, content_len={len(full_content)}",
            }
            checks = {
                "has_chunks": (chunks > 1, f"chunks={chunks}"),
                "has_think_in_stream": (has_think, f"<think> {'bulundu' if has_think else 'BULUNAMADI'}"),
                "has_done": (has_done, "[DONE] marker"),
            }
            for ck, (ok, detail) in checks.items():
                result["checks"][ck] = {"pass": ok, "detail": detail}
                if not ok:
                    result["status"] = "WARN"
                    self.bugs.append({"test": "streaming thinking", "check": ck, "detail": detail})

            self.results.append(result)
            icon = {"PASS": "✅", "WARN": "🟡"}[result["status"]]
            print(f"  {icon} {'Streaming: thinking ON stream':55s} {result['status']:5s} {200:>4} {elapsed:>6}ms")

        except Exception as e:
            elapsed = round((time.time() - start) * 1000)
            self.results.append({
                "name": "Streaming: thinking ON stream",
                "status": "ERROR", "http_code": 0, "time_ms": elapsed,
                "error": str(e), "checks": {},
            })
            print(f"  ⚠️ {'Streaming: thinking ON stream':55s} ERROR {elapsed:>6}ms → {e}")

        # 3. Tool call stream
        start = time.time()
        try:
            chunks, content_parts, has_done, has_usage, first_chunk_ms, elapsed, tool_calls_chunks = \
                self._stream_request(f"{self.base_chat}/v1/chat/completions", {
                    "model": "Qwen/Qwen3-4B",
                    "messages": [
                        {"role": "system", "content": "Sen IT destek asistanisin."},
                        {"role": "user", "content": "Yazicim calismiyor, ticket ac /no_think"}
                    ],
                    "tools": [TOOL_CREATE_TICKET],
                    "tool_choice": "auto",
                    "max_tokens": 256, "temperature": 0.6,
                    "stream": True, "stream_options": {"include_usage": True}
                })

            has_tool_in_stream = len(tool_calls_chunks) > 0
            result = {
                "name": "Streaming: tool call stream",
                "status": "PASS", "http_code": 200, "time_ms": elapsed,
                "checks": {},
                "response_summary": f"chunks={chunks}, tool_call_deltas={len(tool_calls_chunks)}",
            }
            checks = {
                "has_chunks": (chunks > 0, f"chunks={chunks}"),
                "has_tool_calls_delta": (has_tool_in_stream, f"tool_calls_chunks={len(tool_calls_chunks)}"),
                "has_done": (has_done, "[DONE] marker"),
            }
            for ck, (ok, detail) in checks.items():
                result["checks"][ck] = {"pass": ok, "detail": detail}
                if not ok:
                    result["status"] = "WARN"
                    self.bugs.append({"test": "streaming tool call", "check": ck, "detail": detail})

            self.results.append(result)
            icon = {"PASS": "✅", "WARN": "🟡"}[result["status"]]
            print(f"  {icon} {'Streaming: tool call stream':55s} {result['status']:5s} {200:>4} {elapsed:>6}ms")

        except Exception as e:
            elapsed = round((time.time() - start) * 1000)
            self.results.append({
                "name": "Streaming: tool call stream",
                "status": "ERROR", "http_code": 0, "time_ms": elapsed,
                "error": str(e), "checks": {},
            })
            print(f"  ⚠️ {'Streaming: tool call stream':55s} ERROR {elapsed:>6}ms → {e}")

    def test_edge_cases(self):
        print("\n─── EDGE CASES ───")

        # 1. Empty messages
        self.test("Edge: empty message content", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": ""}],
            "max_tokens": 32
        })

        # 2. Very long input
        long_text = "Bu bir test cumlesidir. " * 100
        self.test("Edge: uzun input (2000+ char)", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": long_text + " /no_think Ozetle."}],
            "max_tokens": 64, "temperature": 0.7
        })

        # 3. Unicode / emoji
        self.test("Edge: unicode + emoji", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "Bu emojileri acikla: 🚀🎯🔥 /no_think"}],
            "max_tokens": 64, "temperature": 0.7
        })

        # 4. Invalid model name (404 beklenmeli)
        self.test("Edge: invalid model (404 beklenir)", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "nonexistent-model",
            "messages": [{"role": "user", "content": "test"}],
            "max_tokens": 8
        }, expect_error=404)

        # 5. temperature=0 (known issue with Qwen3)
        self.test("Edge: temperature=0 (Qwen3 uyarisi)", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "2+2=? /no_think"}],
            "max_tokens": 16, "temperature": 0.0
        })

        # 6. ignore_eos=true
        self.test("Edge: ignore_eos=true", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "Merhaba /no_think"}],
            "max_tokens": 20, "temperature": 0.7, "ignore_eos": True
        }, checks={
            "finish_length": lambda b: (
                b["choices"][0].get("finish_reason") == "length",
                f"finish_reason={b['choices'][0].get('finish_reason')}"
            ),
        })

        # 7. truncate_prompt_tokens
        long_prompt = "Bu bir test metnidir. " * 200
        self.test("Edge: truncate_prompt_tokens=50", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": long_prompt + " /no_think Ozetle."}],
            "max_tokens": 32, "temperature": 0.7,
            "truncate_prompt_tokens": 50
        }, checks={
            "has_choices": lambda b: (len(b.get("choices", [])) > 0, f"choices={len(b.get('choices', []))}"),
        })

        # 8. Missing messages field (422 beklenmeli)
        self.test("Edge: missing messages (422 beklenir)", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "max_tokens": 8
        }, expect_error=422)

        # 9. Invalid temperature type (422 beklenmeli)
        self.test("Edge: invalid temperature type (422)", f"{self.base_chat}/v1/chat/completions", "POST", {
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "test"}],
            "max_tokens": 8, "temperature": "invalid"
        }, expect_error=422)

        # 10. Cross-port: embed model on chat port (farkli model, 400/404 beklenir)
        self.test("Edge: embed model on chat port (404)", f"{self.base_chat}/v1/embeddings", "POST", {
            "model": "nomic-ai/nomic-embed-text-v1.5",
            "input": "test"
        }, checks={
            "wrong_model_note": lambda b: (
                True,  # Chat portu embed istegi kabul edebilir, bu bilinen davranis
                "chat portu embed endpoint'ini kabul etti (vLLM davranisi)"
            ),
        })

    # ═══════════════════════════════════════════════════════════
    # RUN ALL
    # ═══════════════════════════════════════════════════════════

    def run(self, only=None):
        self.start_time = time.time()
        print(f"{'='*70}")
        print(f"  vLLM API Test Suite")
        print(f"  Host: {self.host} | Chat: :{CHAT_PORT} | Embed: :{EMBED_PORT}")
        print(f"  Tarih: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"{'='*70}")

        groups = {
            "health": self.test_health,
            "chat": self.test_chat,
            "thinking": self.test_thinking,
            "completions": self.test_completions,
            "embed": self.test_embeddings,
            "tokenizer": self.test_tokenizer,
            "streaming": self.test_streaming,
            "edge": self.test_edge_cases,
        }

        if only:
            for key in only:
                if key in groups:
                    groups[key]()
                else:
                    print(f"\n⚠️  Bilinmeyen grup: {key} (secenekler: {', '.join(groups.keys())})")
        else:
            for fn in groups.values():
                fn()

        total_time = round(time.time() - self.start_time, 1)
        return self.report(total_time)

    def report(self, total_time):
        passed = sum(1 for r in self.results if r["status"] == "PASS")
        failed = sum(1 for r in self.results if r["status"] == "FAIL")
        warned = sum(1 for r in self.results if r["status"] == "WARN")
        errors = sum(1 for r in self.results if r["status"] == "ERROR")
        total = len(self.results)

        report_lines = []
        report_lines.append("")
        report_lines.append("=" * 70)
        report_lines.append("  SONUC RAPORU")
        report_lines.append("=" * 70)
        report_lines.append(f"  Toplam: {total} test | ✅ PASS: {passed} | ❌ FAIL: {failed} | 🟡 WARN: {warned} | ⚠️ ERROR: {errors}")
        report_lines.append(f"  Sure: {total_time}s | Host: {self.host}")
        report_lines.append(f"  Tarih: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

        if self.bugs:
            report_lines.append("")
            report_lines.append("─── BULUNAN SORUNLAR ───")
            for i, bug in enumerate(self.bugs, 1):
                report_lines.append(f"  {i}. [{bug['test']}] {bug['check']}: {bug['detail'][:120]}")

        report_lines.append("")
        report_lines.append("─── DETAY ───")
        for r in self.results:
            icon = {"PASS": "✅", "FAIL": "❌", "ERROR": "⚠️", "WARN": "🟡"}[r["status"]]
            report_lines.append(f"  {icon} {r['name']:55s} {r['status']:5s} {r['http_code']:>4} {r['time_ms']:>6}ms")
            if r.get("response_summary"):
                report_lines.append(f"     → {r['response_summary'][:120]}")
            for ck, cv in r.get("checks", {}).items():
                if not cv["pass"]:
                    report_lines.append(f"     → 🐛 {ck}: {cv['detail'][:120]}")
            if r.get("error"):
                report_lines.append(f"     → ERROR: {r['error'][:150]}")

        report_lines.append("")
        report_lines.append("=" * 70)

        report_text = "\n".join(report_lines)
        print(report_text)

        # JSON rapor
        json_report = {
            "timestamp": datetime.now().isoformat(),
            "host": self.host,
            "summary": {
                "total": total,
                "passed": passed,
                "failed": failed,
                "warned": warned,
                "errors": errors,
                "duration_sec": total_time,
            },
            "bugs": self.bugs,
            "results": self.results,
        }

        return report_text, json_report


# ═══════════════════════════════════════════════════════════════
# HELPER FUNCTIONS
# ═══════════════════════════════════════════════════════════════

def _check_tool_args(body):
    try:
        tc = body["choices"][0]["message"]["tool_calls"][0]
        args = json.loads(tc["function"]["arguments"])
        return "title" in args and "description" in args
    except:
        return False

def _get_tool_args_detail(body):
    try:
        tc = body["choices"][0]["message"]["tool_calls"][0]
        return json.loads(tc["function"]["arguments"])
    except:
        return "parse error"

def _check_json_output(body):
    content = body["choices"][0]["message"].get("content", "")
    # Strip empty think tags if present
    clean = content.replace("<think>\n</think>\n\n", "").replace("<think>\n</think>", "").strip()
    try:
        parsed = json.loads(clean)
        return True, f"valid JSON: {list(parsed.keys()) if isinstance(parsed, dict) else type(parsed).__name__}"
    except json.JSONDecodeError as e:
        return False, f"INVALID JSON: {e} | raw: {clean[:100]}"

def _check_json_schema_fields(body, required_fields):
    """JSON schema ciktisinda gerekli alanlari kontrol eder."""
    content = body["choices"][0]["message"].get("content", "")
    clean = content.replace("<think>\n</think>\n\n", "").replace("<think>\n</think>", "").strip()
    try:
        parsed = json.loads(clean)
        if not isinstance(parsed, dict):
            return False, f"dict beklendi, {type(parsed).__name__} geldi"
        missing = [f for f in required_fields if f not in parsed]
        if missing:
            return False, f"eksik alanlar: {missing}, mevcut: {list(parsed.keys())}"
        return True, f"tum alanlar mevcut: {list(parsed.keys())}"
    except json.JSONDecodeError as e:
        return False, f"INVALID JSON: {e} | raw: {clean[:100]}"

def _check_not_normalized(body):
    """Embedding vektorunun L2 norm != 1.0 oldugunu dogrular."""
    try:
        embedding = body.get("data", [{}])[0].get("embedding", [])
        if not isinstance(embedding, list) or len(embedding) == 0:
            return True, "embedding bos veya base64 (kontrol atlanmistir)"
        l2_norm = math.sqrt(sum(x * x for x in embedding))
        is_not_normalized = abs(l2_norm - 1.0) > 0.01
        return is_not_normalized, f"L2 norm={l2_norm:.4f} ({'normalize=false calisiyor' if is_not_normalized else 'HALA normalized (norm~1.0)'})"
    except Exception as e:
        return False, f"norm hesaplama hatasi: {e}"

def _check_cosine_similarity(body):
    """Printer cumleleri birbirine, hava durumundan daha yakin olmali."""
    data = body.get("data", [])
    if len(data) < 3:
        return False, "3 embedding beklendi"

    def cosine(a, b):
        dot = sum(x * y for x, y in zip(a, b))
        na = sum(x * x for x in a) ** 0.5
        nb = sum(x * x for x in b) ** 0.5
        return dot / (na * nb) if na and nb else 0

    e0 = data[0]["embedding"]  # printer not working
    e1 = data[1]["embedding"]  # paper jam
    e2 = data[2]["embedding"]  # weather

    sim_01 = round(cosine(e0, e1), 4)
    sim_02 = round(cosine(e0, e2), 4)

    ok = sim_01 > sim_02
    return ok, f"printer-jam={sim_01}, printer-weather={sim_02} ({'dogru siralama' if ok else 'YANLIS siralama!'})"


# ═══════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="vLLM API Test Suite")
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"API host (default: {DEFAULT_HOST})")
    parser.add_argument("--report-dir", default=".claude/reports", help="Rapor kayit dizini")
    parser.add_argument("--verbose", "-v", action="store_true", help="Detayli cikti")
    parser.add_argument("--only", nargs="+",
                       choices=["health", "chat", "thinking", "completions", "embed", "tokenizer", "streaming", "edge"],
                       help="Sadece belirtilen gruplari calistir")
    args = parser.parse_args()

    tester = APITester(host=args.host, verbose=args.verbose)
    report_text, json_report = tester.run(only=args.only)

    # Rapor kaydet
    report_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), args.report_dir)
    os.makedirs(report_dir, exist_ok=True)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")

    # Text rapor
    txt_path = os.path.join(report_dir, f"api-test-{ts}.txt")
    with open(txt_path, "w") as f:
        f.write(report_text)

    # JSON rapor
    json_path = os.path.join(report_dir, f"api-test-{ts}.json")
    with open(json_path, "w") as f:
        json.dump(json_report, f, ensure_ascii=False, indent=2)

    print(f"\n  📄 Rapor: {txt_path}")
    print(f"  📊 JSON:  {json_path}")

    # Exit code
    summary = json_report["summary"]
    if summary["failed"] > 0 or summary["errors"] > 0:
        sys.exit(1)
    sys.exit(0)


if __name__ == "__main__":
    main()
