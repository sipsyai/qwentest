# Tool Calling (Function Calling)

Qwen3-4B, Hermes formatında tool calling destekler. Model, kullanıcı isteğine göre hangi fonksiyonun çağrılacağına karar verir ve parametrelerini JSON olarak döndürür.

**Sunucu:** `http://localhost:8010`
**Format:** Hermes (vLLM `--tool-call-parser hermes` ile)

---

## Akış

```
1. Kullanıcı mesajı + tool tanımları gönderilir
2. Model tool_call döndürür (finish_reason: "tool_calls")
3. Tool çalıştırılır, sonucu "tool" rolü ile geri gönderilir
4. Model nihai yanıtı üretir (finish_reason: "stop")
```

---

## Tool Tanımlama

```json
{
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "fonksiyon_adi",
        "description": "Fonksiyonun ne yaptığı",
        "parameters": {
          "type": "object",
          "properties": {
            "param1": {
              "type": "string",
              "description": "Parametre açıklaması"
            },
            "param2": {
              "type": "integer",
              "description": "Açıklama"
            },
            "param3": {
              "type": "string",
              "enum": ["deger1", "deger2", "deger3"],
              "description": "Enum parametresi"
            }
          },
          "required": ["param1"]
        }
      }
    }
  ]
}
```

### Desteklenen Parametre Tipleri

| Tip | Açıklama |
|-----|----------|
| `string` | Metin |
| `integer` | Tam sayı |
| `number` | Ondalıklı sayı |
| `boolean` | true/false |
| `array` | Liste |
| `object` | Nesne |
| `enum` | Sabit değer listesi |

---

## Tool Choice

| Değer | Açıklama |
|-------|----------|
| `"none"` | Hiçbir tool çağırma (varsayılan, tools yoksa) |
| `"auto"` | Model karar verir (varsayılan, tools varsa) |
| `"required"` | Mutlaka bir tool çağır |
| `{"type":"function","function":{"name":"..."}}` | Belirli bir toolu çağır |

```json
{"tool_choice": "auto"}
```

```json
{"tool_choice": {"type": "function", "function": {"name": "create_ticket"}}}
```

---

## Tool Call Yanıtı

Model tool çağırdığında:

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": "",
      "tool_calls": [
        {
          "id": "chatcmpl-tool-abc123",
          "type": "function",
          "function": {
            "name": "create_ticket",
            "arguments": "{\"title\":\"Yazıcı arızası\",\"description\":\"Yazıcı çalışmıyor\",\"urgency\":\"high\"}"
          }
        }
      ]
    },
    "finish_reason": "tool_calls"
  }]
}
```

**Not:** `arguments` JSON string olarak gelir. `json.loads()` ile parse edilmelidir.

---

## Tool Sonucu Gönderme

Tool çalıştırıldıktan sonra sonuç `tool` rolü ile geri gönderilir:

```json
{
  "messages": [
    {"role": "user", "content": "Yazıcım çalışmıyor"},
    {
      "role": "assistant",
      "content": "",
      "tool_calls": [{
        "id": "chatcmpl-tool-abc123",
        "type": "function",
        "function": {
          "name": "create_ticket",
          "arguments": "{\"title\":\"Yazıcı arızası\",\"description\":\"Yazıcı çalışmıyor\"}"
        }
      }]
    },
    {
      "role": "tool",
      "tool_call_id": "chatcmpl-tool-abc123",
      "content": "{\"success\": true, \"ticket_id\": 42}"
    }
  ]
}
```

**Önemli:** `tool_call_id` değeri, assistant mesajındaki `tool_calls[].id` ile eşleşmelidir.

---

## Çok Turlu Tool Loop

Bir mesajda birden fazla tool çağrılabilir ve sonuçları gönderildikten sonra model yeni tool çağrıları yapabilir.

```
Kullanıcı → Model → tool_call A, tool_call B
                  ← tool result A, tool result B
          → Model → tool_call C
                  ← tool result C
          → Model → nihai yanıt (finish_reason: "stop")
```

Maksimum iterasyon sayısını uygulama tarafında sınırlayın (önerilen: 5).

---

## Örnekler

### 1. Tek Tool Çağrısı

```bash
curl http://localhost:8010/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "messages": [
      {"role": "system", "content": "Sen bir IT destek asistanısın."},
      {"role": "user", "content": "Yazıcım çalışmıyor, ticket aç /no_think"}
    ],
    "tools": [{
      "type": "function",
      "function": {
        "name": "create_ticket",
        "description": "IT destek talebi oluşturur",
        "parameters": {
          "type": "object",
          "properties": {
            "title": {"type": "string", "description": "Kısa başlık"},
            "description": {"type": "string", "description": "Detaylı açıklama"},
            "urgency": {"type": "string", "enum": ["low","medium","high","critical"]}
          },
          "required": ["title", "description"]
        }
      }
    }],
    "tool_choice": "auto",
    "max_tokens": 512,
    "temperature": 0.6,
    "top_p": 0.95
  }'
```

### 2. Çoklu Tool Tanımı

```bash
curl http://localhost:8010/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "messages": [
      {"role": "system", "content": "Sen bir IT asistanısın."},
      {"role": "user", "content": "VPN sorunu ile ilgili açık ticket var mı? /no_think"}
    ],
    "tools": [
      {
        "type": "function",
        "function": {
          "name": "search_tickets",
          "description": "Ticket ara",
          "parameters": {
            "type": "object",
            "properties": {
              "query": {"type": "string"},
              "status": {"type": "string", "enum": ["new","open","in_progress","resolved","closed"]},
              "limit": {"type": "integer"}
            },
            "required": ["query"]
          }
        }
      },
      {
        "type": "function",
        "function": {
          "name": "create_ticket",
          "description": "Yeni ticket oluştur",
          "parameters": {
            "type": "object",
            "properties": {
              "title": {"type": "string"},
              "description": {"type": "string"}
            },
            "required": ["title", "description"]
          }
        }
      }
    ],
    "tool_choice": "auto",
    "parallel_tool_calls": true,
    "max_tokens": 512,
    "temperature": 0.6
  }'
```

### 3. Tool Sonucu ile Tamamlama

```bash
curl http://localhost:8010/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "messages": [
      {"role": "system", "content": "Sen bir IT asistanısın. Türkçe yanıt ver. /no_think"},
      {"role": "user", "content": "Yazıcım çalışmıyor"},
      {
        "role": "assistant",
        "content": "",
        "tool_calls": [{
          "id": "call_abc123",
          "type": "function",
          "function": {
            "name": "create_ticket",
            "arguments": "{\"title\":\"Yazıcı arızası\",\"description\":\"Yazıcı çalışmıyor\"}"
          }
        }]
      },
      {
        "role": "tool",
        "tool_call_id": "call_abc123",
        "content": "{\"success\": true, \"ticket_id\": 42}"
      }
    ],
    "max_tokens": 256,
    "temperature": 0.7
  }'
```

### 4. Belirli Tool Zorlama

```bash
curl http://localhost:8010/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "Qwen/Qwen3-4B",
    "messages": [
      {"role": "user", "content": "Şifre değişikliği istiyorum /no_think"}
    ],
    "tools": [{
      "type": "function",
      "function": {
        "name": "create_ticket",
        "description": "IT destek talebi oluşturur",
        "parameters": {
          "type": "object",
          "properties": {
            "title": {"type": "string"},
            "description": {"type": "string"}
          },
          "required": ["title", "description"]
        }
      }
    }],
    "tool_choice": {"type": "function", "function": {"name": "create_ticket"}},
    "max_tokens": 256,
    "temperature": 0.6
  }'
```

### 5. Python SDK

```python
import json
from openai import OpenAI

client = OpenAI(base_url="http://localhost:8010/v1", api_key="not-needed")

tools = [
    {
        "type": "function",
        "function": {
            "name": "create_ticket",
            "description": "IT destek talebi oluşturur",
            "parameters": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "urgency": {"type": "string", "enum": ["low", "medium", "high"]},
                },
                "required": ["title", "description"],
            },
        },
    }
]

# Adım 1: İlk istek
messages = [
    {"role": "system", "content": "Sen bir IT asistanısın."},
    {"role": "user", "content": "Yazıcım çalışmıyor /no_think"},
]

response = client.chat.completions.create(
    model="Qwen/Qwen3-4B",
    messages=messages,
    tools=tools,
    tool_choice="auto",
    max_tokens=512,
    temperature=0.6,
)

choice = response.choices[0]

# Adım 2: Tool call varsa çalıştır
if choice.message.tool_calls:
    # Assistant mesajını history'e ekle
    messages.append({
        "role": "assistant",
        "content": choice.message.content or "",
        "tool_calls": [
            {
                "id": tc.id,
                "type": "function",
                "function": {
                    "name": tc.function.name,
                    "arguments": tc.function.arguments,
                },
            }
            for tc in choice.message.tool_calls
        ],
    })

    for tc in choice.message.tool_calls:
        args = json.loads(tc.function.arguments)
        print(f"Tool: {tc.function.name}({args})")

        # Tool sonucunu simüle et
        result = {"success": True, "ticket_id": 42}

        messages.append({
            "role": "tool",
            "tool_call_id": tc.id,
            "content": json.dumps(result),
        })

    # Adım 3: Sonuçla devam et
    response2 = client.chat.completions.create(
        model="Qwen/Qwen3-4B",
        messages=messages,
        max_tokens=256,
        temperature=0.7,
    )
    print(response2.choices[0].message.content)
else:
    print(choice.message.content)
```

---

## Dikkat Edilecekler

1. **`/no_think` kullanın:** Tool calling sırasında thinking gereksiz token harcar
2. **`arguments` JSON string'dir:** `json.loads()` ile parse edin
3. **`tool_call_id` eşleştirmesi:** Tool yanıtında doğru ID kullanın
4. **Max iterasyon:** Sonsuz tool loop'u önlemek için limit koyun (5 önerilir)
5. **ReAct formatı kullanmayın:** Qwen3 `<think>` bloğu içinde stopword üretebilir
