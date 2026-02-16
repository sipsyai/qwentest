vLLM API endpoint testlerini calistir ve rapor olustur.

Test scripti: `test-api.py`
Raporlar: `.claude/reports/` dizinine kaydedilir (txt + json).

## Adimlari

1. `python3 test-api.py $ARGUMENTS` komutunu calistir. Kullanici arguman vermemisse varsayilan host (192.168.1.8) kullanilir.
   - Ornek argumanlar: `--host 100.75.67.64`, `--only chat embed`, `--only thinking`, `--verbose`
   - Kullanilabilir gruplar: `health`, `chat`, `thinking`, `completions`, `embed`, `tokenizer`, `streaming`, `edge`
2. Test tamamlaninca `.claude/reports/` altindaki en son raporu oku ve kullaniciya ozet sun:
   - Toplam test sayisi, gecen/kalan/uyari
   - Bulunan bug'lar varsa listele
   - Onceki raporla karsilastir (varsa)
3. Eger FAIL veya ERROR varsa, sorunu analiz et ve cozum oner.
