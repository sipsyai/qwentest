#!/usr/bin/env python3
"""
ITSM Chatbot Test Runner — 25 Son Kullanıcı Senaryosu
Workflow "ITSM Destek Hattı" üzerinden test eder.
Çıktı: itsm-chatbot-test-results.json + terminale özet
"""

import urllib.request
import json
import re
import time
import sys
import os
import unicodedata
from datetime import datetime

# ─── Config ────────────────────────────────────────────────────────────────
BASE         = "http://localhost:8833"
WORKFLOW_ID  = "cc736a1d-d7a5-4a5d-a9a1-81415f26b235"  # ITSM Destek Hattı
SCENARIOS_F  = os.path.join(os.path.dirname(__file__), "itsm-chatbot-scenarios.json")
RESULTS_F    = os.path.join(os.path.dirname(__file__), "itsm-chatbot-test-results.json")
TIMEOUT      = 120   # saniye / istek (workflow 2 step, daha uzun sürebilir)
DELAY        = 1.0   # istek arası bekleme

# ─── Turkish normalization for fuzzy matching ─────────────────────────────────
def normalize_turkish(text: str) -> str:
    """Normalize Turkish text: lowercase + strip accents for fuzzy comparison."""
    text = text.lower()
    # Turkish-specific: ı→i, ş→s, ç→c, ğ→g, ö→o, ü→u, İ→i
    tr_map = str.maketrans("ıİşŞçÇğĞöÖüÜ", "iisscccgoouU")
    text = text.translate(tr_map)
    # Strip remaining unicode accents
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c))


# ─── Check fonksiyonları ────────────────────────────────────────────────────
CHECKS = {
    "no_email": lambda t: not bool(
        re.search(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', t)
    ),
    "no_chinese": lambda t: not bool(
        re.search(r'[\u4e00-\u9fff\u3400-\u4dbf\U00020000-\U0002a6df]', t)
    ),
    "has_turkish": lambda t: bool(
        re.search(r'[ğüşöçıİĞÜŞÖÇ]', t)
    ),
    "has_content": lambda t: len(t.strip()) > 50,
    "has_form_reference": lambda t: bool(
        re.search(r'(?i)(form|formu|formuler|şablon)', t)
    ),
    "is_out_of_scope": lambda t: any(k in t.lower() for k in [
        "bilgi tabanımda", "bulamadım", "yeterli bilgi",
        "kapsam", "it destek", "ilgili değil", "bu konuda"
    ]),
}

# Parametric checks (need extra data from scenario)
def check_form_match(answer: str, expected_form: str | None) -> bool:
    """Fuzzy match: expected_form must appear in answer (Turkish-normalized)."""
    if expected_form is None:
        return True
    norm_answer = normalize_turkish(answer)
    norm_form = normalize_turkish(expected_form)
    return norm_form in norm_answer


def check_has_keywords(answer: str, expected_keywords: list, min_ratio: float = 0.5) -> bool:
    """At least 50% of expected keywords must appear in answer."""
    if not expected_keywords:
        return True
    answer_lower = answer.lower()
    found = sum(1 for kw in expected_keywords if kw.lower() in answer_lower)
    return found / len(expected_keywords) >= min_ratio


def keyword_ratio(answer: str, expected_keywords: list) -> float:
    """Return the ratio of found keywords (0.0–1.0)."""
    if not expected_keywords:
        return 1.0
    answer_lower = answer.lower()
    found = sum(1 for kw in expected_keywords if kw.lower() in answer_lower)
    return found / len(expected_keywords)


CHECK_LABELS = {
    "no_email":          "Email yok",
    "no_chinese":        "Çince yok",
    "has_turkish":       "Türkçe var",
    "has_content":       "İçerik yeterli",
    "has_form_reference":"Form referansı",
    "is_out_of_scope":   "Kapsam dışı tespiti",
    "form_match":        "Form eşleşmesi",
    "has_keywords":      "Anahtar kelimeler",
}

# ─── SSE Workflow Runner ───────────────────────────────────────────────────
def run_workflow(question: str) -> dict:
    """
    Workflow'u çalıştırır, step çıktılarını ve final yanıtı döner.
    Returns: {steps: [{step_id, output, elapsed}], final_output, total_elapsed, error}
    """
    payload = json.dumps({
        "variables": {"soru": question}
    }).encode()

    req = urllib.request.Request(
        f"{BASE}/api/kb/workflows/{WORKFLOW_ID}/run",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept": "text/event-stream"
        },
        method="POST"
    )

    steps = []
    current_step_id = None
    current_step_text = ""
    final_output = ""
    t0 = time.time()

    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            current_event = None
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

                        if current_event == "step_start":
                            current_step_id = obj.get("step_id", "")
                            current_step_text = ""

                        elif current_event == "stream":
                            content = obj.get("content", "")
                            current_step_text += content
                            final_output = current_step_text  # son step'in çıktısı = final

                        elif current_event == "step_done":
                            step_output = obj.get("output_preview", current_step_text)
                            steps.append({
                                "step_id": current_step_id or obj.get("step_id", ""),
                                "output": step_output,
                                "output_len": len(step_output),
                            })
                            current_step_text = ""

                        elif current_event == "error":
                            return {
                                "steps": steps,
                                "final_output": f"[ERROR: {obj.get('message', 'unknown')}]",
                                "total_elapsed": time.time() - t0,
                                "error": True,
                            }

                    except Exception:
                        pass
    except Exception as e:
        return {
            "steps": steps,
            "final_output": f"[NETWORK_ERROR: {e}]",
            "total_elapsed": time.time() - t0,
            "error": True,
        }

    # Eğer step_done event'lerinden son step'in çıktısını alamadıysak,
    # stream'den biriken text'i kullan
    if not final_output and steps:
        final_output = steps[-1].get("output", "")

    return {
        "steps": steps,
        "final_output": final_output,
        "total_elapsed": time.time() - t0,
        "error": False,
    }


# ─── Ana test döngüsü ────────────────────────────────────────────────────────
def run_all():
    with open(SCENARIOS_F, encoding="utf-8") as f:
        scenarios = json.load(f)

    print(f"\n{'='*74}")
    print(f"  ITSM Chatbot Test Runner — {len(scenarios)} senaryo")
    print(f"  Workflow : ITSM Destek Hattı ({WORKFLOW_ID[:8]}...)")
    print(f"  Başlangıç: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*74}\n")

    results = []
    passed = 0
    failed = 0

    for i, sc in enumerate(scenarios, 1):
        sid       = sc["id"]
        cat       = sc["category"]
        diff      = sc["difficulty"]
        tone      = sc["user_tone"]
        question  = sc["question"]
        checks    = sc["checks"]
        exp_form  = sc.get("expected_form")
        exp_kw    = sc.get("expected_keywords", [])

        print(f"[{i:02d}/{len(scenarios)}] {sid} — {cat} ({diff}/{tone})")
        print(f"  Soru: {question[:90]}{'...' if len(question) > 90 else ''}")

        result = run_workflow(question)
        answer = result["final_output"]
        elapsed = result["total_elapsed"]
        step_count = len(result["steps"])

        # Check'leri uygula
        check_results = {}
        failed_checks = []
        for ck in checks:
            # Parametric checks
            if ck == "form_match":
                ok = check_form_match(answer, exp_form)
                check_results[ck] = ok
                if not ok:
                    failed_checks.append(ck)
                continue
            if ck == "has_keywords":
                ok = check_has_keywords(answer, exp_kw)
                check_results[ck] = ok
                if not ok:
                    failed_checks.append(ck)
                continue
            # Standard checks
            fn = CHECKS.get(ck)
            if fn is None:
                check_results[ck] = None
                continue
            ok = fn(answer)
            check_results[ck] = ok
            if not ok:
                failed_checks.append(ck)

        # Keyword detail tracking
        kw_ratio = keyword_ratio(answer, exp_kw)
        kw_found = []
        kw_missing = []
        answer_lower = answer.lower()
        for kw in exp_kw:
            if kw.lower() in answer_lower:
                kw_found.append(kw)
            else:
                kw_missing.append(kw)

        scenario_pass = len(failed_checks) == 0 and not result.get("error")

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
            if v is not None
        )
        print(f"  {status}  ({elapsed:.1f}s, {step_count} step)  {check_str}")

        if exp_form and "form_match" in check_results:
            fm_ok = check_results["form_match"]
            print(f"  {'✓' if fm_ok else '✗'} Form: {exp_form}")

        if kw_found:
            print(f"  🔑 Bulunan: {kw_found}  ({kw_ratio:.0%})")
        if kw_missing:
            print(f"  ⚠️  Eksik keyword: {kw_missing}")

        if not scenario_pass:
            if failed_checks:
                print(f"  ❌ Başarısız check: {failed_checks}")
            snippet = answer[:250].replace("\n", " ")
            print(f"  Yanıt: {snippet}{'...' if len(answer) > 250 else ''}")

        print()

        # Sonucu kaydet
        results.append({
            "id":             sid,
            "category":       cat,
            "difficulty":     diff,
            "user_tone":      tone,
            "question":       question,
            "expected_form":  exp_form,
            "answer":         answer,
            "answer_len":     len(answer),
            "elapsed_sec":    round(elapsed, 2),
            "step_count":     step_count,
            "step_details":   [{"step_id": s["step_id"], "output_len": s["output_len"]} for s in result["steps"]],
            "checks":         check_results,
            "failed_checks":  failed_checks,
            "keywords_found": kw_found,
            "keywords_missing": kw_missing,
            "keyword_ratio":  round(kw_ratio, 2),
            "form_match":     check_results.get("form_match"),
            "pass":           scenario_pass,
            "error":          result.get("error", False),
        })

        time.sleep(DELAY)

    # ─── Özet ──────────────────────────────────────────────────────────────
    total = len(scenarios)
    pct = 100 * passed // total if total > 0 else 0

    # Quality score calculation
    form_results = [r for r in results if r["expected_form"] is not None]
    correct_forms = sum(1 for r in form_results if r.get("form_match") is True)
    total_with_forms = len(form_results)
    form_accuracy = correct_forms / total_with_forms if total_with_forms > 0 else 0

    all_kw_ratios = [r["keyword_ratio"] for r in results if r.get("keyword_ratio") is not None]
    avg_kw_ratio = sum(all_kw_ratios) / len(all_kw_ratios) if all_kw_ratios else 0

    all_elapsed = [r["elapsed_sec"] for r in results]
    avg_elapsed = sum(all_elapsed) / len(all_elapsed) if all_elapsed else 0

    all_lengths = [r["answer_len"] for r in results]
    avg_length = sum(all_lengths) / len(all_lengths) if all_lengths else 0

    quality_score = {
        "form_accuracy": round(form_accuracy, 2),
        "keyword_coverage": round(avg_kw_ratio, 2),
        "avg_response_time": round(avg_elapsed, 1),
        "avg_response_length": round(avg_length),
    }

    print(f"{'='*74}")
    print(f"  ÖZET — ITSM Chatbot Test")
    print(f"{'='*74}")
    print(f"  Toplam    : {total}")
    print(f"  Geçti     : {passed}  ✅")
    print(f"  Kaldı     : {failed}  ❌")
    print(f"  Başarı    : %{pct}")
    print()

    print("  Kalite Metrikleri:")
    print(f"    Form Doğruluğu     : {correct_forms}/{total_with_forms}  ({form_accuracy:.0%})")
    print(f"    Keyword Kapsama    : {avg_kw_ratio:.0%}")
    print(f"    Ort. Yanıt Süresi  : {avg_elapsed:.1f}s")
    print(f"    Ort. Yanıt Uzunluğu: {avg_length:.0f} karakter")
    print()

    # Kategoriye göre breakdown
    cat_stats: dict[str, dict] = {}
    for r in results:
        c = r["category"]
        if c not in cat_stats:
            cat_stats[c] = {"pass": 0, "fail": 0, "avg_time": []}
        if r["pass"]:
            cat_stats[c]["pass"] += 1
        else:
            cat_stats[c]["fail"] += 1
        cat_stats[c]["avg_time"].append(r["elapsed_sec"])

    print("  Kategoriye Göre:")
    for cat, st in sorted(cat_stats.items()):
        tot = st["pass"] + st["fail"]
        avg = sum(st["avg_time"]) / len(st["avg_time"])
        print(f"    {cat:22s}  {st['pass']}/{tot}  avg {avg:.1f}s  {'✅' * st['pass']}{'❌' * st['fail']}")
    print()

    # Zorluk seviyesine göre
    diff_stats: dict[str, dict] = {}
    for r in results:
        d = r["difficulty"]
        if d not in diff_stats:
            diff_stats[d] = {"pass": 0, "fail": 0}
        if r["pass"]:
            diff_stats[d]["pass"] += 1
        else:
            diff_stats[d]["fail"] += 1

    print("  Zorluk Seviyesine Göre:")
    for diff in ["easy", "medium", "hard"]:
        if diff in diff_stats:
            st = diff_stats[diff]
            tot = st["pass"] + st["fail"]
            print(f"    {diff:10s}  {st['pass']}/{tot}")
    print()

    # Başarısız senaryolar
    failures = [r for r in results if not r["pass"]]
    if failures:
        print("  Başarısız Senaryolar:")
        for r in failures:
            reason = r["failed_checks"] if r["failed_checks"] else "error"
            print(f"    {r['id']} — {r['category']} ({r['difficulty']}) — {reason}")
    else:
        print("  🎉 Tüm senaryolar geçti!")

    print(f"\n{'='*74}\n")

    # JSON kaydet
    output = {
        "run_at":     datetime.now().isoformat(),
        "workflow_id": WORKFLOW_ID,
        "workflow_name": "ITSM Destek Hattı",
        "summary": {
            "total":   total,
            "passed":  passed,
            "failed":  failed,
            "percent": pct,
        },
        "quality_score": quality_score,
        "category_breakdown": {k: {"pass": v["pass"], "fail": v["fail"]} for k, v in cat_stats.items()},
        "difficulty_breakdown": diff_stats,
        "results": results,
    }

    with open(RESULTS_F, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    # Also save timestamped copy for history
    ts = datetime.now().strftime("%Y-%m-%dT%H%M")
    ts_file = os.path.join(os.path.dirname(__file__), f"itsm-chatbot-test-results-{ts}.json")
    with open(ts_file, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"  Sonuçlar kaydedildi: {RESULTS_F}")
    print(f"  Kopya: {ts_file}\n")
    return pct


if __name__ == "__main__":
    score = run_all()
    sys.exit(0 if score >= 80 else 1)
