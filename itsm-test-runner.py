#!/usr/bin/env python3
"""
ITSM Agent Test Runner — 50 Senaryo
Çıktı: itsm-test-results.json + terminale özet
"""

import urllib.request
import json
import re
import time
import sys
import os
from datetime import datetime

# ─── Config ────────────────────────────────────────────────────────────────
BASE        = "http://localhost:8833"
AGENT_ID    = "633417ad-767c-47e6-b77d-db035d663706"
SCENARIOS_F = os.path.join(os.path.dirname(__file__), "itsm-scenarios.json")
RESULTS_F   = os.path.join(os.path.dirname(__file__), "itsm-test-results.json")
TIMEOUT     = 90   # saniye / istek
DELAY       = 0.5  # istek arası bekleme (rate-limit koruması)

# ─── Check fonksiyonları ────────────────────────────────────────────────────
CHECKS = {
    "no_email": lambda t: not bool(
        re.search(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', t)
    ),
    "no_chinese": lambda t: not bool(
        re.search(r'[\u4e00-\u9fff\u3400-\u4dbf\u20000-\u2a6df]', t)
    ),
    "has_turkish": lambda t: bool(
        re.search(r'[ğüşöçıİĞÜŞÖÇ]', t)
    ),
    "has_content": lambda t: len(t.strip()) > 30,
    "no_url": lambda t: not bool(re.search(r'https?://', t)),
    "fallback": lambda t: any(k in t.lower() for k in [
        "bilgi tabanımda", "bulamadım", "yeterli bilgi",
        "kapsam", "it destek", "ilgili değil"
    ]),
}

CHECK_LABELS = {
    "no_email":   "Email yok",
    "no_chinese": "Çince yok",
    "has_turkish":"Türkçe var",
    "has_content":"İçerik var",
    "no_url":     "URL yok",
    "fallback":   "Fallback mesajı",
}

# ─── SSE okuyucu ────────────────────────────────────────────────────────────
def run_agent(question: str) -> tuple[str, float]:
    payload = json.dumps({
        "agentId": AGENT_ID,
        "messages": [{"role": "user", "content": question}],
        "variables": {}
    }).encode()

    req = urllib.request.Request(
        f"{BASE}/api/kb/agents/{AGENT_ID}/run",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "text/event-stream"
        },
        method="POST"
    )

    full = ""
    current_event = None
    t0 = time.time()

    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            for line in r:
                decoded = line.decode("utf-8").strip()
                if decoded.startswith("event: "):
                    current_event = decoded[7:]
                elif decoded.startswith("data: "):
                    chunk = decoded[6:]
                    if chunk == "[DONE]":
                        break
                    try:
                        obj = json.loads(chunk)
                        if current_event == "stream" and "content" in obj:
                            full += obj["content"]
                        elif "choices" in obj:
                            delta = obj["choices"][0].get("delta", {}).get("content", "")
                            full += delta
                    except Exception:
                        pass
    except Exception as e:
        return f"[ERROR: {e}]", time.time() - t0

    return full, time.time() - t0


# ─── Ana test döngüsü ────────────────────────────────────────────────────────
def run_all():
    with open(SCENARIOS_F, encoding="utf-8") as f:
        scenarios = json.load(f)

    print(f"\n{'='*70}")
    print(f"  ITSM Agent Test Runner — {len(scenarios)} senaryo")
    print(f"  Agent  : {AGENT_ID}")
    print(f"  Başlangıç: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*70}\n")

    results = []
    passed  = 0
    failed  = 0

    for i, sc in enumerate(scenarios, 1):
        sid      = sc["id"]
        cat      = sc["category"]
        question = sc["question"]
        checks   = sc["checks"]

        print(f"[{i:02d}/{len(scenarios)}] {sid} — {cat}")
        print(f"  Soru: {question[:80]}{'...' if len(question) > 80 else ''}")

        answer, elapsed = run_agent(question)

        # Her check'i uygula
        check_results = {}
        failed_checks = []
        for ck in checks:
            fn = CHECKS.get(ck)
            if fn is None:
                check_results[ck] = None
                continue
            ok = fn(answer)
            check_results[ck] = ok
            if not ok:
                failed_checks.append(ck)

        scenario_pass = len(failed_checks) == 0

        if scenario_pass:
            passed += 1
            status = "✅ PASS"
        else:
            failed += 1
            status = "❌ FAIL"

        # Terminale özet
        check_str = "  ".join(
            f"{'✓' if v else '✗'} {CHECK_LABELS.get(k, k)}"
            for k, v in check_results.items()
        )
        print(f"  {status}  ({elapsed:.1f}s)  {check_str}")

        if not scenario_pass:
            print(f"  ⚠️  Başarısız: {failed_checks}")
            # İlk 200 karakter göster
            snippet = answer[:200].replace("\n", " ")
            print(f"  Yanıt: {snippet}{'...' if len(answer) > 200 else ''}")

        print()

        # Sonucu kaydet
        results.append({
            "id":           sid,
            "category":     cat,
            "question":     question,
            "answer":       answer,
            "answer_len":   len(answer),
            "elapsed_sec":  round(elapsed, 2),
            "checks":       check_results,
            "failed_checks":failed_checks,
            "pass":         scenario_pass,
        })

        time.sleep(DELAY)

    # ─── Özet ──────────────────────────────────────────────────────────────
    total = len(scenarios)
    pct   = 100 * passed // total

    print(f"{'='*70}")
    print(f"  ÖZET")
    print(f"{'='*70}")
    print(f"  Toplam   : {total}")
    print(f"  Geçti    : {passed}  ✅")
    print(f"  Kaldı    : {failed}  ❌")
    print(f"  Başarı   : %{pct}")
    print()

    # Kategorilere göre breakdown
    cat_stats: dict[str, dict] = {}
    for r in results:
        c = r["category"]
        if c not in cat_stats:
            cat_stats[c] = {"pass": 0, "fail": 0}
        if r["pass"]:
            cat_stats[c]["pass"] += 1
        else:
            cat_stats[c]["fail"] += 1

    print("  Kategoriye Göre:")
    for cat, st in sorted(cat_stats.items()):
        tot = st["pass"] + st["fail"]
        print(f"    {cat:30s}  {st['pass']}/{tot}  {'✅' * st['pass']}{'❌' * st['fail']}")

    print()

    # Başarısız senaryolar
    failures = [r for r in results if not r["pass"]]
    if failures:
        print("  Başarısız Senaryolar:")
        for r in failures:
            print(f"    {r['id']} — {r['category']} — Başarısız: {r['failed_checks']}")
    else:
        print("  🎉 Tüm senaryolar geçti!")

    print(f"{'='*70}\n")

    # JSON kaydet
    output = {
        "run_at":    datetime.now().isoformat(),
        "agent_id":  AGENT_ID,
        "summary": {
            "total":   total,
            "passed":  passed,
            "failed":  failed,
            "percent": pct,
        },
        "category_breakdown": cat_stats,
        "results": results,
    }

    with open(RESULTS_F, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"  Sonuçlar kaydedildi: {RESULTS_F}\n")
    return pct


if __name__ == "__main__":
    score = run_all()
    sys.exit(0 if score == 100 else 1)
