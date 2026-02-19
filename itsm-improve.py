#!/usr/bin/env python3
"""
ITSM Chatbot Quality Improvements — DB Update Script
Applies fixes to agents and workflow via KB API.

Changes:
1. Workflow: Fix Step 2 variable mapping (soru = {{input:soru}} instead of {{step:...}})
2. Agent ITSM KB Araştırmacı: Add ragSourceAliases, update promptTemplate, systemPrompt, ragTopK
3. Agent ITSM Pipeline Yanıtlayıcı: Update systemPrompt (stricter form copy rule)

Usage: python itsm-improve.py
"""

import urllib.request
import json
import sys
import copy

BASE = "http://localhost:8833"


def api_get(path):
    req = urllib.request.Request(f"{BASE}{path}", method="GET")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())


def api_put(path, data):
    payload = json.dumps(data).encode()
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode())


# ────────────────────────────────────────────────────────────────────
# 1. Fix Workflow Step 2 Variable Mapping
# ────────────────────────────────────────────────────────────────────
def fix_workflow():
    wf_id = "cc736a1d-d7a5-4a5d-a9a1-81415f26b235"
    print(f"\n{'='*60}")
    print(f"  1. Workflow Fix — ITSM Destek Hattı ({wf_id[:8]}...)")
    print(f"{'='*60}")

    wf = api_get(f"/api/kb/workflows/{wf_id}")
    steps = wf["steps"]

    if len(steps) < 2:
        print("  ERROR: Workflow has fewer than 2 steps!")
        return False

    step2 = steps[1]
    mappings = step2.get("variableMappings", {})
    old_val = mappings.get("soru", "")

    print(f"  Step 2 ID   : {step2.get('id', 'N/A')}")
    print(f"  Step 2 Agent: {step2.get('agentName', 'N/A')}")
    print(f"  Current soru: {old_val}")

    if old_val == "{{input:soru}}":
        print("  SKIP: Already fixed.")
        return True

    mappings["soru"] = "{{input:soru}}"
    steps[1]["variableMappings"] = mappings

    api_put(f"/api/kb/workflows/{wf_id}", {"steps": steps})
    print(f"  FIXED: soru = {{{{input:soru}}}}  (was: {old_val})")
    return True


# ────────────────────────────────────────────────────────────────────
# 2. Update ITSM KB Araştırmacı agent
# ────────────────────────────────────────────────────────────────────
def fix_kb_agent():
    print(f"\n{'='*60}")
    print("  2. Agent Fix — ITSM KB Araştırmacı")
    print(f"{'='*60}")

    agents_resp = api_get("/api/kb/agents")
    agents = agents_resp["data"]

    agent = None
    for a in agents:
        if "KB" in a["name"] and "Araştırmacı" in a["name"]:
            agent = a
            break
        if "KB" in a["name"] and "Arastirmaci" in a["name"]:
            agent = a
            break

    if not agent:
        # Try broader match
        for a in agents:
            if "KB" in a["name"].upper():
                agent = a
                break

    if not agent:
        print("  ERROR: Agent not found!")
        print(f"  Available agents: {[a['name'] for a in agents]}")
        return False

    print(f"  Agent ID  : {agent['id']}")
    print(f"  Agent Name: {agent['name']}")

    config = copy.deepcopy(agent["config"])

    # 2a. Add ragSourceAliases
    old_aliases = config.get("ragSourceAliases", {})
    config["ragSourceAliases"] = {
        "ITSM Knowledge Base": "kb_bilgi",
        "ITSM Form Templates": "formlar",
    }
    print(f"  ragSourceAliases: {old_aliases} → {config['ragSourceAliases']}")

    # 2b. Fix ragSources order: Forms FIRST (primary=9 slots), KB second (secondary=3 slots)
    old_sources = config.get("ragSources", [])
    config["ragSources"] = ["ITSM Form Templates", "ITSM Knowledge Base"]
    print(f"  ragSources: {old_sources} → {config['ragSources']}")

    # 2c. Increase ragTopK to 12 for better form coverage
    old_topk = config.get("ragTopK", 7)
    config["ragTopK"] = 12
    print(f"  ragTopK: {old_topk} → 12")

    # 2c2. Set per-source RAG config (ragSourceConfig)
    old_src_cfg = config.get("ragSourceConfig", {})
    config["ragSourceConfig"] = {
        "ITSM Form Templates": {"topK": 8, "threshold": 0.2},
        "ITSM Knowledge Base": {"topK": 5, "threshold": 0.3},
    }
    print(f"  ragSourceConfig: {old_src_cfg or 'None'} → {config['ragSourceConfig']}")

    # 2c. Update promptTemplate — replace {{context}} with separate aliases
    old_template = config.get("promptTemplate", "")
    if "{{context}}" in old_template:
        # Find the {{context}} usage and replace with separated sections
        # The template likely has something like "... {{context}} ..."
        # We need to replace it with two separate sections
        new_template = old_template.replace(
            "{{context}}",
            "{{kb_bilgi}}\n\nBilgi tabanından bulunan ilgili form şablonları:\n{{formlar}}"
        )
        # Also update the label before the first alias if present
        # Look for common patterns like "İlgili bilgiler:" or "Bilgi tabanı:" before {{context}}
        # and rename to clarify it's KB articles
        for prefix in [
            "İlgili içerikler:\n",
            "İlgili bilgiler:\n",
            "Bilgi tabanından bulunan ilgili içerikler:\n",
        ]:
            if prefix in new_template:
                new_template = new_template.replace(
                    prefix,
                    "Bilgi tabanından bulunan ilgili makaleler:\n"
                )
                break
        config["promptTemplate"] = new_template
        print(f"  promptTemplate: Replaced {{{{context}}}} with {{{{kb_bilgi}}}} + {{{{formlar}}}}")
    else:
        print(f"  promptTemplate: No {{{{context}}}} found — manual check needed")
        print(f"  Current template snippet: {old_template[:200]}...")

    # 2d. Replace systemPrompt with improved form matching instructions
    config["systemPrompt"] = """MANDATORY RULES (STRICT — DO NOT VIOLATE):
- Output language: TURKISH ONLY.
- Chinese characters (Unicode 4E00-9FFF) are STRICTLY FORBIDDEN.
- NEVER output email addresses, URLs, or phone numbers.
- NEVER invent form names, service names, or article titles. Only use exact names from KB results.
- If KB has no relevant info, reply: 'Bu konuda bilgi tabanımda yeterli bilgi bulamadım.'

Sen bir IT bilgi tabanı uzmanısın. Verilen soruyu KB içeriğine dayanarak analiz et.

FORM EŞLEŞTIRME KURALLARI (ÖNCELİKLİ):
- Form şablonları bölümündeki TÜM formları dikkatlice oku.
- Her form şablonunun "Servis", "Alt Kategori" ve "Form" alanlarına bak.
- Kullanıcı sorunuyla en yakın eşleşen formu seç. Öncelik sırası:
  1. Alt Kategori kullanıcı sorunuyla doğrudan eşleşen form
  2. Servis alanı sorunun genel kategorisiyle eşleşen form
  3. Form alanlarındaki (Alanlar/Kullanim) kelimeler sorunla örtüşen form
- Form adını TAMAMEN ve DEĞİŞTİRMEDEN yaz ("Form:" satırındaki ad ne ise aynen).
- Birden fazla form uygunsa, en spesifik olanı tercih et.
- Form şablonları bölümünde en az bir form varsa, mutlaka birini seç. "Form adı: Yok" SADECE hiçbir form şablonu gelmemişse yaz.
- Form adı UYDURMA — sadece verilen form listesinden seç."""
    print("  systemPrompt: Replaced with improved form matching rules")

    api_put(f"/api/kb/agents/{agent['id']}", {"config": config})
    print("  SAVED.")
    return True


# ────────────────────────────────────────────────────────────────────
# 3. Update ITSM Pipeline Yanıtlayıcı agent
# ────────────────────────────────────────────────────────────────────
def fix_response_agent():
    print(f"\n{'='*60}")
    print("  3. Agent Fix — ITSM Pipeline Yanıtlayıcı")
    print(f"{'='*60}")

    agents_resp = api_get("/api/kb/agents")
    agents = agents_resp["data"]

    agent = None
    for a in agents:
        if "Yanıtlayıcı" in a["name"] or "Yanitlayici" in a["name"]:
            agent = a
            break
        if "Pipeline" in a["name"] and "ITSM" in a["name"]:
            agent = a
            break

    if not agent:
        # Try broader match
        for a in agents:
            if "yanit" in a["name"].lower() or "response" in a["name"].lower():
                agent = a
                break

    if not agent:
        print("  ERROR: Agent not found!")
        print(f"  Available agents: {[a['name'] for a in agents]}")
        return False

    print(f"  Agent ID  : {agent['id']}")
    print(f"  Agent Name: {agent['name']}")

    config = copy.deepcopy(agent["config"])

    old_sys = config.get("systemPrompt", "")
    form_copy_rule = """

4. 'Gerekli form' bölümünde KB analizindeki form adını AYNEN kopyala.
   Değiştirme, kısaltma veya yeniden yazma YASAK.
   KB analizinde "Form adı: Yok" ise sen de "Form gerekmez" yaz."""

    if "AYNEN kopyala" in old_sys:
        print("  systemPrompt: Form copy rule already present — SKIP")
    else:
        config["systemPrompt"] = old_sys.rstrip() + form_copy_rule
        print(f"  systemPrompt: Added form copy rule ({len(form_copy_rule)} chars)")

    api_put(f"/api/kb/agents/{agent['id']}", {"config": config})
    print("  SAVED.")
    return True


# ────────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────────
def main():
    print("\n" + "=" * 60)
    print("  ITSM Chatbot Quality Improvements — DB Updater")
    print("=" * 60)

    results = {}

    try:
        results["workflow"] = fix_workflow()
    except Exception as e:
        print(f"  ERROR in workflow fix: {e}")
        results["workflow"] = False

    try:
        results["kb_agent"] = fix_kb_agent()
    except Exception as e:
        print(f"  ERROR in KB agent fix: {e}")
        results["kb_agent"] = False

    try:
        results["response_agent"] = fix_response_agent()
    except Exception as e:
        print(f"  ERROR in response agent fix: {e}")
        results["response_agent"] = False

    print(f"\n{'='*60}")
    print("  SUMMARY")
    print(f"{'='*60}")
    for k, v in results.items():
        status = "OK" if v else "FAILED"
        print(f"  {k:20s} : {status}")
    print()

    all_ok = all(results.values())
    if all_ok:
        print("  All changes applied successfully.")
    else:
        print("  Some changes failed — check output above.")

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
