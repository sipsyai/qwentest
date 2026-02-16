# Qwen3 Thinking Mode

Qwen3-4B, yanıt vermeden önce adım adım düşünme (chain-of-thought reasoning) yapabilir. Bu, karmaşık sorularda daha doğru yanıtlar üretir ama daha fazla token harcar.

---

## Nasıl Çalışır

Thinking mode açıkken model şu formatı üretir:

```
<think>
Tamam, kullanıcı SQL optimizasyonu soruyor...
İndeks oluşturmam lazım...
</think>

SQL sorgusunun optimize edilmesi için aşağıdaki adımları izleyin:
1. İndeks oluşturun...
```

- `<think>...</think>` bloğu: Modelin iç düşünmesi (kullanıcıya gösterilmez)
- Blok sonrası metin: Nihai yanıt

---

## Kontrol Yöntemleri

### 1. Hard Switch: `chat_template_kwargs` (Önerilen)

API seviyesinde tamamen açar/kapatır.

```json
{
  "chat_template_kwargs": {"enable_thinking": false}
}
```

| Değer | Davranış |
|-------|----------|
| `true` (varsayılan) | Düşünme açık, `<think>` bloğu üretilir |
| `false` | Düşünme kapalı, direkt yanıt verilir |

### 2. Soft Switch: `/think` ve `/no_think`

Mesaj sonuna eklenen metin direktifleri. Sadece `enable_thinking: true` iken çalışır.

```json
{"role": "user", "content": "2+2 kaç? /no_think"}
```

```json
{"role": "user", "content": "Bu denklemi çöz: x²+3x-4=0 /think"}
```

Çok turlu konuşmalarda **son direktif** geçerlidir.

### 3. `reasoning_effort`

Düşünme derinliğini ayarlar.

```json
{"reasoning_effort": "low"}
```

| Değer | Açıklama |
|-------|----------|
| `low` | Hızlı, yüzeysel düşünme |
| `medium` | Dengeli |
| `high` | Derin, detaylı düşünme |

### 4. `include_reasoning`

Thinking bloğunu yanıtta gösterme kontrolü.

```json
{"include_reasoning": false}
```

---

## Önerilen Parametreler

| Parametre | Thinking ON | Thinking OFF |
|-----------|-------------|--------------|
| `temperature` | **0.6** | **0.7** |
| `top_p` | **0.95** | **0.8** |
| `top_k` | 20 | 20 |
| `min_p` | 0 | 0 |

**UYARI:** `temperature: 0` (greedy decoding) kullanmayın. Sonsuz tekrar ve performans düşüşüne neden olur.

---

## Token Karşılaştırması

Aynı soru ("2+2 kaç?") için:

| Mod | Completion Token | Sonuç |
|-----|-----------------|-------|
| Thinking ON | ~200 | `<think>...uzun düşünme...</think>\n4` |
| Thinking OFF (`chat_template_kwargs`) | ~58 | `2 + 2 = 4` |
| `/no_think` soft switch | ~15 | `<think>\n\n</think>\n\n4` |

Thinking OFF, basit sorularda **4-13x daha az token** kullanır.

---

## Ne Zaman Kullanmalı

### Thinking ON

- Matematik / mantık problemleri
- Kod analizi ve optimizasyon
- Karmaşık karar verme
- Çok adımlı talimatlar

### Thinking OFF

- Basit soru-cevap
- Selamlama / sohbet
- Bilgi arama (KB lookup)
- Intent classification
- Düşük latency gereken senaryolar

---

## Örnekler

### Thinking ON (Varsayılan)

```bash
curl http://localhost:8010/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "messages": [
      {"role": "user", "content": "Bu SQL sorgusunu optimize et: SELECT * FROM tickets WHERE status='\''open'\''"}
    ],
    "max_tokens": 2048,
    "temperature": 0.6,
    "top_p": 0.95,
    "top_k": 20
  }'
```

### Thinking OFF (Hard Switch)

```bash
curl http://localhost:8010/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "messages": [
      {"role": "user", "content": "VPN bağlanamıyorum, ne yapmalıyım?"}
    ],
    "max_tokens": 512,
    "temperature": 0.7,
    "top_p": 0.8,
    "chat_template_kwargs": {"enable_thinking": false}
  }'
```

### Thinking OFF (Soft Switch)

```bash
curl http://localhost:8010/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "messages": [
      {"role": "user", "content": "Merhaba, nasılsın? /no_think"}
    ],
    "max_tokens": 256,
    "temperature": 0.6,
    "top_p": 0.95
  }'
```

### Python: Thinking İçeriğini Ayrıştırma

```python
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8010/v1", api_key="not-needed")

response = client.chat.completions.create(
    model="Qwen/Qwen3-4B",
    messages=[{"role": "user", "content": "x² + 3x - 4 = 0 denklemini çöz"}],
    max_tokens=2048,
    temperature=0.6,
    top_p=0.95,
)

content = response.choices[0].message.content

if "</think>" in content:
    think_part, answer_part = content.split("</think>", 1)
    think_part = think_part.replace("<think>", "").strip()
    answer_part = answer_part.strip()
    print(f"Düşünme: {think_part[:200]}...")
    print(f"Yanıt: {answer_part}")
else:
    print(f"Yanıt: {content}")
```

### Python: Thinking OFF

```python
response = client.chat.completions.create(
    model="Qwen/Qwen3-4B",
    messages=[{"role": "user", "content": "Merhaba"}],
    max_tokens=256,
    temperature=0.7,
    top_p=0.8,
    extra_body={
        "top_k": 20,
        "chat_template_kwargs": {"enable_thinking": False},
    },
)
print(response.choices[0].message.content)
```
