#!/usr/bin/env python3
"""
ITSM Form Template Enrichment — adds scenario keywords to form templates
for better hybrid search (BM25 + semantic) retrieval.

Process:
1. Fetch all KB docs with source_label = 'ITSM Form Templates'
2. For each form, append Turkish scenario keywords based on form name
3. Re-embed via vLLM embed API, then update doc via KB API (delete + re-add)
4. The search_vector trigger auto-updates BM25 index

Usage: python itsm-enrich-forms.py
"""

import urllib.request
import json
import sys
import time

BASE = "http://localhost:8833"

# Embed API URL (read from settings)
EMBED_URL = None
EMBED_MODEL = "nomic-ai/nomic-embed-text-v1.5"

# Form name (exact match from KB) → scenario keywords to append
# These match the actual form names returned by:
#   SELECT SUBSTRING(text FROM 'Form: ([^\n]+)') FROM kb_documents WHERE source_label = 'ITSM Form Templates'
FORM_ENRICHMENTS = {
    # Identity & Access
    "Sifre ve MFA Destegi": {
        "anahtar_kelimeler": "sifre degistirme, sifre sifirlama, parola, MFA, iki faktorlu dogrulama, authentication, giris yapamiyorum, hesap kilitlendi, parola suresi doldu",
        "senaryolar": "Kullanici sifresini degistirmek istiyor, MFA cihazi kayboldu, sifre unuttum, hesabim kilitlendi",
    },
    "Hesap Kilidi Acma Talebi": {
        "anahtar_kelimeler": "hesap kilidi, kilitlendi, giris yapamiyorum, account lock, sifre denemesi, oturum acma",
        "senaryolar": "Hesabim kilitlendi, cok fazla yanlis sifre girdim, oturum acamiyorum",
    },
    "Erisim Izni Degisikligi": {
        "anahtar_kelimeler": "erisim, yetki, izin, access, permission, rol degisikligi, yetkilendirme",
        "senaryolar": "Yetkilerimi degistirin, erisim izni lazim, rol guncellemesi, yetki talebi",
    },
    "Dosya ve Klasor Erisim Talebi": {
        "anahtar_kelimeler": "dosya erisim, klasor, paylasim, network drive, share folder, dizin erisimi",
        "senaryolar": "Klasore erisemiyorum, dosya paylasimi istiyorum, network drive baglama",
    },
    "Yetkili Erisim Gozden Gecirme": {
        "anahtar_kelimeler": "yetkili erisim, admin erisim, privileged access, erisim gozden gecirme",
        "senaryolar": "Admin yetkisi kontrolu, yetkili erisim denetimi",
    },
    "Erisim Haklari Denetim Talebi": {
        "anahtar_kelimeler": "erisim denetim, haklar, audit, erisim raporu",
        "senaryolar": "Erisim haklarini denetleyin, kimler erisebiliyor",
    },

    # VPN & Remote
    "VPN Erisim Talebi": {
        "anahtar_kelimeler": "vpn, uzak erisim, remote access, evden calisma, vpn baglanti, vpn hesap",
        "senaryolar": "VPN erisimi istiyorum, evden calismak icin VPN lazim, uzaktan baglanma",
    },
    "VPN Kullanici Kurulumu": {
        "anahtar_kelimeler": "vpn kurulum, vpn yapilandirma, vpn setup, vpn konfigurasyonu",
        "senaryolar": "VPN kurulumu yapin, VPN nasil kurulur, VPN ayarlari",
    },

    # Hardware
    "Yeni Laptop Siparisi": {
        "anahtar_kelimeler": "laptop, dizustu, notebook, yeni bilgisayar, laptop talebi",
        "senaryolar": "Yeni laptop istiyorum, laptopum eski degistirin, dizustu bilgisayar talebi",
    },
    "Yeni Masaustu Siparisi": {
        "anahtar_kelimeler": "masaustu, desktop, pc, yeni bilgisayar, masa ustu",
        "senaryolar": "Yeni masaustu istiyorum, bilgisayar talebi, pc degisimi",
    },
    "Masaustu / Laptop Arizasi": {
        "anahtar_kelimeler": "ariza, bozuldu, calismiyor, laptop sorun, masaustu sorun, donanim ariza",
        "senaryolar": "Laptopum bozuldu, bilgisayar acilmiyor, ekran calismiyor, donanim sorun",
    },
    "Donanim Talebi": {
        "anahtar_kelimeler": "donanim, hardware, ekipman, cihaz talebi, teknik ekipman",
        "senaryolar": "Donanim istiyorum, yeni ekipman, cihaz talebi",
    },
    "Yeni Monitor Siparisi": {
        "anahtar_kelimeler": "monitor, ekran, display, yeni monitor",
        "senaryolar": "Yeni monitor istiyorum, ekran talebi, ikinci monitor",
    },
    "Tamir": {
        "anahtar_kelimeler": "tamir, onarim, repair, fix, duzeltme",
        "senaryolar": "Cihazim bozuldu tamir edin, onarim talebi",
    },
    "Yeni Cevre Birimi": {
        "anahtar_kelimeler": "cevre birimi, peripheral, mouse, klavye, kulaklik, aksesuar",
        "senaryolar": "Yeni mouse istiyorum, klavye lazim, kulaklik talebi",
    },
    "Yeni Telefon Siparisi": {
        "anahtar_kelimeler": "telefon, cep telefonu, mobile, akilli telefon",
        "senaryolar": "Yeni telefon istiyorum, cep telefonu talebi",
    },

    # Printer
    "Yazici Arizasi": {
        "anahtar_kelimeler": "yazici, printer, baski, yazdirma, yazici sorun, yazici arizasi",
        "senaryolar": "Yazici calismiyor, baski alamiyorum, yazici hata veriyor, kagit sikisti",
    },
    "Yeni Yazici Talebi": {
        "anahtar_kelimeler": "yeni yazici, printer talebi, yazici kurulum",
        "senaryolar": "Yeni yazici istiyorum, yazici ekleyin, printer lazim",
    },
    "Toner / Sarf Malzeme Talebi": {
        "anahtar_kelimeler": "toner, kartus, sarf malzeme, murekkep, yazici sarf",
        "senaryolar": "Toner bitti, yeni toner istiyorum, sarf malzeme talebi, kartus degisimi",
    },
    "Tarayici Destegi": {
        "anahtar_kelimeler": "tarayici, scanner, tarama, scan, belge tarama",
        "senaryolar": "Tarayici calismiyor, tarama yapamiyorum, scanner sorun",
    },

    # Email
    "E-posta Arizasi": {
        "anahtar_kelimeler": "eposta, e-posta, mail, outlook, posta, mail sorun",
        "senaryolar": "Mail gonderemiyorum, outlook calismiyor, e-posta arizasi",
    },
    "E-posta Hesap Yonetimi": {
        "anahtar_kelimeler": "mail hesap, eposta hesap, mail yonetim, posta kutusu",
        "senaryolar": "Mail hesabi acin, e-posta yonetimi, posta kutusu ayarlari",
    },
    "E-posta Dagitim Grubu Yonetimi": {
        "anahtar_kelimeler": "dagitim grubu, mail grup, distribution list, toplu mail",
        "senaryolar": "Dagitim grubu olusturun, gruba ekleme, mail listesi",
    },
    "Paylasilmis Posta Kutusu Talebi": {
        "anahtar_kelimeler": "paylasilmis posta, shared mailbox, ortak posta kutusu",
        "senaryolar": "Ortak posta kutusu istiyorum, paylasilmis mailbox talebi",
    },

    # Security
    "Oltalama Bildirimi": {
        "anahtar_kelimeler": "phishing, oltalama, sahte mail, supheli mail, dolandiricilik, spam",
        "senaryolar": "Supheli mail aldim, oltalama saldirisi, sahte link, phishing bildirimi",
    },
    "Guvenlik Olayi Bildirimi": {
        "anahtar_kelimeler": "guvenlik olayi, security incident, virus, malware, siber saldiri, ihlal",
        "senaryolar": "Virus tespit ettim, guvenlik ihlali, siber saldiri bildirimi",
    },
    "Guvenlik Duvari Kurallari": {
        "anahtar_kelimeler": "firewall, guvenlik duvari, port acma, erisim engeli, ag kurali",
        "senaryolar": "Port acilmasi lazim, firewall kurali degistirin, siteye erisemiyorum",
    },
    "Guvenlik Istisna Talebi": {
        "anahtar_kelimeler": "guvenlik istisna, exception, kural istisna, beyaz liste",
        "senaryolar": "Guvenlik istisnasi istiyorum, kurali bypasslayin",
    },
    "Veri Ihlali Bildirimi": {
        "anahtar_kelimeler": "veri ihlali, data breach, bilgi sizintisi, gizlilik ihlali",
        "senaryolar": "Veri sizintisi oldu, bilgiler ifsa edildi",
    },

    # Network
    "Ag Sorun Giderme": {
        "anahtar_kelimeler": "ag, network, internet, baglanti, wifi, ethernet, yavas internet",
        "senaryolar": "Internete baglanamiyorum, ag yavas, wifi sorun, baglanti kopuyor",
    },
    "Ag Kesintisi": {
        "anahtar_kelimeler": "ag kesintisi, internet kesintisi, network down, baglanti yok",
        "senaryolar": "Internet yok, ag calismiyor, baglanti kesildi",
    },
    "Yeni DNS / IP Talebi": {
        "anahtar_kelimeler": "dns, ip adresi, ip talebi, dns kaydi, domain",
        "senaryolar": "Yeni IP lazim, DNS kaydi ekleyin, IP adresi talebi",
    },

    # Software
    "Yazilim Kurulumu": {
        "anahtar_kelimeler": "yazilim kurulum, software install, program yukleme, uygulama kurma",
        "senaryolar": "Program yukleyin, yazilim kurulumu yapın, uygulama lazim",
    },
    "Yazilim Kurma / Guncelleme": {
        "anahtar_kelimeler": "yazilim guncelleme, software update, program guncelleme, patch",
        "senaryolar": "Yazilim guncelleyin, program eski, guncelleme lazim",
    },
    "Yazilim Kaldirma": {
        "anahtar_kelimeler": "yazilim kaldirma, uninstall, program silme, kaldir",
        "senaryolar": "Programi kaldirin, yazilim silinsin",
    },
    "Yazilim Lisans Talebi": {
        "anahtar_kelimeler": "lisans, license, yazilim lisans, aktivasyon, seri numarasi",
        "senaryolar": "Lisans istiyorum, yazilim lisansi lazim, aktivasyon kodu",
    },
    "Yeni Yazilim Talebi": {
        "anahtar_kelimeler": "yeni yazilim, software talebi, yeni program, uygulama istegi",
        "senaryolar": "Yeni yazilim istiyorum, programa ihtiyacim var",
    },
    "Microsoft Office Destegi": {
        "anahtar_kelimeler": "office, microsoft, word, excel, powerpoint, teams, office sorun",
        "senaryolar": "Office calismiyor, Excel sorun, Word acilmiyor, Teams hatasi",
    },
    "Windows Kurulumu": {
        "anahtar_kelimeler": "windows, isletim sistemi, os kurulum, format, windows yeniden kurulum",
        "senaryolar": "Windows kurun, format atin, isletim sistemi sorun",
    },

    # Backup
    "Yedekleme ve Geri Yukleme": {
        "anahtar_kelimeler": "yedek, backup, yedekleme, geri yukleme, restore, dosya kurtarma",
        "senaryolar": "Dosyalarimi yedekleyin, silinen dosyayi geri getirin, backup talebi",
    },
    "Yedekleme Dogrulama Talebi": {
        "anahtar_kelimeler": "yedekleme dogrulama, backup verification, yedek kontrol",
        "senaryolar": "Yedeklerin kontrolu, backup dogrulama",
    },

    # Collaboration & Video
    "Video Konferans Destegi": {
        "anahtar_kelimeler": "video konferans, zoom, teams, toplanti, goruntulu gorusme, kamera, webcam",
        "senaryolar": "Kamera calismiyor, toplanti baglantisi sorun, video konferans yardim",
    },
    "Isbirligi Araclari Destegi": {
        "anahtar_kelimeler": "isbirligi, collaboration, teams, slack, sharepoint, paylasim",
        "senaryolar": "Teams sorun, Sharepoint erisim, isbirligi araci yardim",
    },
    "Toplanti Odasi Rezervasyon Sorunu": {
        "anahtar_kelimeler": "toplanti odasi, meeting room, rezervasyon, oda ayirma, konferans odasi",
        "senaryolar": "Toplanti odasi ayiramiyorum, oda rezervasyon sorun",
    },
    "Sunum Ekipmani": {
        "anahtar_kelimeler": "sunum, projektor, projeksiyon, presentation, ekran paylasim",
        "senaryolar": "Projektor calismiyor, sunum ekipmani talebi",
    },
    "AV Ekipman Talebi": {
        "anahtar_kelimeler": "av ekipman, ses sistemi, mikrofon, hoparlor, audio visual",
        "senaryolar": "Ses sistemi talebi, mikrofon lazim, AV ekipman istegi",
    },

    # Applications & ERP/CRM
    "CRM Destegi": {
        "anahtar_kelimeler": "crm, musteri iliskileri, salesforce, crm sorun, crm erisim",
        "senaryolar": "CRM erisim istiyorum, CRM calismiyor, musteri sistemi sorun",
    },
    "ERP Erisim Talebi": {
        "anahtar_kelimeler": "erp, sap, is uygulamasi, kurumsal kaynak planlama",
        "senaryolar": "ERP erisimi istiyorum, SAP erisim talebi",
    },
    "Uygulama Erisim Talebi": {
        "anahtar_kelimeler": "uygulama erisim, application access, sistem erisim",
        "senaryolar": "Uygulamaya erisim istiyorum, sisteme giremiyorum",
    },
    "Is Uygulamasi Kurulumu": {
        "anahtar_kelimeler": "is uygulamasi, business app, kurumsal uygulama, kurulum",
        "senaryolar": "Is uygulamasi kurulsin, kurumsal yazilim yukleme",
    },
    "IK Sistemi Destegi": {
        "anahtar_kelimeler": "ik sistemi, hr, insan kaynaklari, bordro, izin sistemi",
        "senaryolar": "IK sistemine erisemiyorum, HR portal sorun",
    },

    # Onboarding / Offboarding
    "Yeni / Ayrilan Calisan": {
        "anahtar_kelimeler": "yeni calisan, ayrilan calisan, onboarding, offboarding, ise giris, isten cikis",
        "senaryolar": "Yeni calisan hesabi acin, ayrilan kisi hesaplarini kapatin",
    },
    "Yeni Calisan BT Oryantasyonu": {
        "anahtar_kelimeler": "bt oryantasyon, it orientation, yeni calisan egitim, baslangic",
        "senaryolar": "Yeni calisan IT oryantasyonu, baslangic seti hazirlama",
    },

    # Server & Cloud
    "Sunucu / Bulut Arizasi": {
        "anahtar_kelimeler": "sunucu, server, bulut, cloud, sunucu ariza, server down",
        "senaryolar": "Sunucu calismiyor, server erisim yok, bulut servisi sorun",
    },
    "Sunucu Provizyon": {
        "anahtar_kelimeler": "sunucu provizyon, server provision, yeni sunucu, vm olusturma",
        "senaryolar": "Yeni sunucu istiyorum, VM olusturun, server talebi",
    },

    # Training & Education
    "BT Egitim Talebi": {
        "anahtar_kelimeler": "egitim, training, bt egitim, bilgi teknolojileri egitim, kurs",
        "senaryolar": "BT egitimi istiyorum, teknoloji egitimi, bilgisayar kursu",
    },
    "BT Yetkinlik Degerlendirmesi": {
        "anahtar_kelimeler": "yetkinlik, degerlendirme, bt beceri, skill assessment",
        "senaryolar": "BT yetkinlik degerlendirmesi, beceri testi",
    },

    # Mobile
    "SIM Kilitleme": {
        "anahtar_kelimeler": "sim kilitleme, sim lock, hat kilitleme, mobil guvenlik",
        "senaryolar": "SIM kartimi kitleyin, hat guvenlik",
    },
    "SIM Acma": {
        "anahtar_kelimeler": "sim acma, sim unlock, hat acma, sim aktiflestime",
        "senaryolar": "SIM kartimi acin, hattimi aktiflesirin",
    },

    # General
    "Genel IT Destek Talebi": {
        "anahtar_kelimeler": "genel destek, it yardim, teknik destek, bilgi islem, it talebi",
        "senaryolar": "IT yardim istiyorum, teknik destek talebi, bilgi islem ile iletisim",
    },
    "Sorun Giderme": {
        "anahtar_kelimeler": "sorun giderme, troubleshooting, hata, problem, cozum",
        "senaryolar": "Sorunum var, yardim edin, hata alioyrum, problem cozme",
    },
    "Degisiklik Talebi": {
        "anahtar_kelimeler": "degisiklik, change request, konfigurasyon degisikligi, sistem degisikligi",
        "senaryolar": "Degisiklik talebi, konfigurasyon guncelleyin",
    },
}


def api_get(path):
    req = urllib.request.Request(f"{BASE}{path}", method="GET")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def api_post(path, data):
    payload = json.dumps(data).encode()
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def api_delete(path):
    req = urllib.request.Request(f"{BASE}{path}", method="DELETE")
    urllib.request.urlopen(req, timeout=10)


def embed_text(text, embed_url):
    """Get embedding vector for text via vLLM embed API."""
    payload = json.dumps({"model": EMBED_MODEL, "input": text}).encode()
    req = urllib.request.Request(
        f"{embed_url}/embeddings",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        resp = json.loads(r.read().decode())
        return resp["data"][0]["embedding"]


def main():
    global EMBED_URL

    print("\n" + "=" * 60)
    print("  ITSM Form Template Enrichment")
    print("=" * 60)

    # Get embed URL from settings
    print("\n  Reading settings...")
    settings = api_get("/api/kb/settings")
    EMBED_URL = settings["settings"].get("forge_embed_url", "")
    fallback = settings["settings"].get("forge_embed_fallback_url", "")
    if not EMBED_URL:
        print("  ERROR: No embed URL in settings!")
        return 1
    print(f"  Embed URL: {EMBED_URL}")
    print(f"  Fallback:  {fallback}")

    # Test embed API
    print("  Testing embed API...")
    urls_to_try = [EMBED_URL]
    if fallback:
        urls_to_try.append(fallback)
    embed_ok = False
    for url in urls_to_try:
        try:
            test_emb = embed_text("test", url)
            EMBED_URL = url
            print(f"  Embed API OK: {url} (dim={len(test_emb)})")
            embed_ok = True
            break
        except Exception as e:
            print(f"  {url} — failed: {e}")
    if not embed_ok:
        print("  ERROR: No embed API reachable!")
        return 1

    # 1. Fetch all KB docs for form templates
    print("\n  Fetching form template documents from KB...")
    try:
        docs_resp = api_get("/api/kb/documents?source_label=ITSM%20Form%20Templates&limit=200")
        docs = docs_resp.get("data", docs_resp.get("documents", []))
    except Exception as e:
        print(f"  ERROR fetching docs: {e}")
        return 1

    if not docs:
        print("  No form template documents found!")
        return 1

    print(f"  Found {len(docs)} form template documents")
    print(f"  Enrichment dict covers {len(FORM_ENRICHMENTS)} form names\n")

    enriched_count = 0
    skipped_count = 0
    no_match_count = 0
    failed_count = 0

    for doc in docs:
        doc_id = doc.get("id", "")
        text = doc.get("text", "")

        # Extract form name from text (look for "Form:" line)
        form_name = None
        for line in text.split("\n"):
            line_stripped = line.strip()
            if line_stripped.startswith("Form:"):
                form_name = line_stripped.replace("Form:", "").strip()
                break

        if not form_name:
            skipped_count += 1
            continue

        # Check if already enriched
        if "Anahtar Kelimeler:" in text or "Kullanim Senaryolari:" in text:
            print(f"  [{doc_id[:8]}] {form_name} — already enriched, SKIP")
            skipped_count += 1
            continue

        # Find enrichment data (exact match)
        enrichment = FORM_ENRICHMENTS.get(form_name)

        if not enrichment:
            no_match_count += 1
            continue

        # Build enriched text
        enriched_text = text.rstrip() + "\n"
        enriched_text += f"Anahtar Kelimeler: {enrichment['anahtar_kelimeler']}\n"
        enriched_text += f"Kullanim Senaryolari: {enrichment['senaryolar']}\n"

        # Embed the enriched text
        try:
            embedding = embed_text(enriched_text, EMBED_URL)
        except Exception as e:
            print(f"  [{doc_id[:8]}] {form_name} — EMBED FAILED: {e}")
            failed_count += 1
            continue

        # Delete old document
        try:
            api_delete(f"/api/kb/documents/{doc_id}")
        except Exception:
            pass  # May 404

        # Add enriched version with embedding
        try:
            api_post("/api/kb/documents", {
                "documents": [{
                    "text": enriched_text,
                    "embedding": embedding,
                    "source": doc.get("source", "dataset"),
                    "source_label": "ITSM Form Templates",
                }]
            })
            added = len(enrichment['anahtar_kelimeler']) + len(enrichment['senaryolar'])
            print(f"  [{doc_id[:8]}] {form_name} — ENRICHED (+{added} chars)")
            enriched_count += 1
        except Exception as e:
            print(f"  [{doc_id[:8]}] {form_name} — ADD FAILED: {e}")
            failed_count += 1

        # Small delay to not overwhelm embed API
        time.sleep(0.1)

    print(f"\n{'='*60}")
    print("  SUMMARY")
    print(f"{'='*60}")
    print(f"  Total docs     : {len(docs)}")
    print(f"  Enriched       : {enriched_count}")
    print(f"  Already done   : {skipped_count}")
    print(f"  No match (OK)  : {no_match_count}")
    print(f"  Failed         : {failed_count}")
    print()

    if failed_count > 0:
        print("  Some enrichments failed — check output above.")
        return 1
    elif enriched_count == 0 and skipped_count == len(docs):
        print("  All forms already enriched — nothing to do.")
    else:
        print(f"  {enriched_count} forms enriched successfully.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
