---
allowed-tools: Bash, Read, Write, Edit, Glob, Grep
description: Commit ve push yap - CHANGELOG, docs ve CLAUDE.md otomatik guncelle
---

Kod degisikliklerini commitleyip push'la. Her committte CHANGELOG.md, docs/ ve CLAUDE.md otomatik guncellenir.

Commit mesaji: $ARGUMENTS (bos ise otomatik olustur)

## Adimlari

### Adim 1: Degisiklik Analizi
1. `git status` ile degisen dosyalari listele
2. `git diff --staged` ve `git diff` ile degisikliklerin icerigini incele
3. Eger hic degisiklik yoksa kullaniciya bildir ve dur
4. Degisiklikleri kategorize et:
   - `feat:` yeni ozellik
   - `fix:` bug duzeltme
   - `refactor:` yeniden yapilandirma
   - `docs:` dokumantasyon
   - `style:` stil/format degisikligi
   - `chore:` bakim/konfigurasyon

### Adim 2: CHANGELOG.md Guncelle
1. `CHANGELOG.md` dosyasini oku (yoksa asagidaki sablonla olustur)
2. En uste yeni entry ekle:
   - Tarih: YYYY-MM-DD formati
   - Kategori: Added / Changed / Fixed / Removed
   - Her degisiklik icin tek satirlik aciklama
   - Degisen dosya sayisi
3. Sablon (ilk olusturma):
   ```
   # Changelog

   Tum onemli degisiklikler bu dosyada belgelenir.
   Format: [Keep a Changelog](https://keepachangelog.com/en/1.0.0/)

   ## [Unreleased] - YYYY-MM-DD
   ### Added
   - ...
   ```

### Adim 3: Dokumantasyon Guncelle (docs/)
1. Degisen dosyalari analiz et:
   - **Yeni servis/modul eklendiyse** → `docs/` altina yeni .md olustur
   - **Mevcut servis degistiyse** → ilgili doc varsa guncelle
   - **Sayfa (page) degistiyse** → `docs/app/` altinda sayfa dokumani guncelle/olustur
   - **API degisikligi varsa** → `docs/api/` guncelle
   - **Config degisikligi varsa** → ilgili doc'a yansit
2. Eger degisiklik sadece minor (typo, style) ise docs guncelleme ATLA
3. Her yeni doc'ta: baslik, aciklama, kullanim ornegi, iliskili dosyalar

### Adim 4: CLAUDE.md Guncelle
1. Proje kokundeki `CLAUDE.md` dosyasini oku (yoksa olustur)
2. Asagidaki bolumleri guncel tut:
   - **Proje Yapisi**: Klasor ve dosya agaci
   - **Servisler**: services/ altindaki moduller ve ne yaptiklari
   - **Sayfalar**: pages/ altindaki sayfalar ve ozellikleri
   - **Komutlar**: Mevcut slash command'lar
   - **Teknoloji Stack**: Kullanilan kutuphaneler
   - **Dev Ortami**: Port, URL, proxy bilgileri
3. YENI eklenen dosyalari/servisleri CLAUDE.md'ye ekle
4. KALDIRILAN dosyalari CLAUDE.md'den sil
5. CLAUDE.md'yi 150 satirin altinda tut - ozet ve referans odakli yaz

### Adim 5: Git Commit & Push
1. Tum degisiklikleri stage'le: `git add` (spesifik dosyalar - `git add .` KULLANMA)
   - Degisen kaynak dosyalari
   - CHANGELOG.md
   - Guncellenen docs/ dosyalari
   - CLAUDE.md
2. Commit mesaji olustur:
   - Kullanici `$ARGUMENTS` verdiyse onu kullan
   - Vermediyse otomatik olustur (degisiklik analizine gore)
   - Format: `<type>: <kisa aciklama>`
   - Body: degisen dosya listesi
   - Footer: `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>`
3. `git push` yap
4. Sonucu raporla:
   - Commit hash
   - Degisen dosya sayisi
   - CHANGELOG entry ozeti
   - Guncellenen doc sayisi
