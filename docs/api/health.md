# Health, Version & Metrics

Sunucu durumu, versiyon ve performans metrikleri.

**Sunucu:** Her iki port (8010 ve 8011)

---

## GET /health

Sunucunun çalışıp çalışmadığını kontrol eder.

### Parametreler

Yok.

### Yanıt

| HTTP Kodu | Durum |
|-----------|-------|
| 200 | Sunucu sağlıklı, model yüklü |
| 503 | Sunucu başlatılıyor veya model yükleniyor |

```bash
# Chat sunucusu
curl http://localhost:8010/health

# Embedding sunucusu
curl http://localhost:8011/health
```

### Docker Healthcheck

docker-compose.yml'de kullanılan kontrol:
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
  interval: 30s
  timeout: 10s
  retries: 5
  start_period: 120s
```

---

## GET /version

vLLM versiyon bilgisi.

### Yanıt

```json
{"version": "0.15.1"}
```

```bash
curl http://localhost:8010/version
```

---

## GET /metrics

Prometheus formatında performans metrikleri. Grafana veya Prometheus ile izleme için kullanılır.

### Yanıt Formatı

`text/plain` (Prometheus exposition format)

### Önemli Metrikler

| Metrik | Açıklama |
|--------|----------|
| `vllm:num_requests_running` | Şu an işlenen istek sayısı |
| `vllm:num_requests_waiting` | Kuyrukta bekleyen istek sayısı |
| `vllm:gpu_cache_usage_perc` | GPU KV-cache kullanım oranı |
| `vllm:cpu_cache_usage_perc` | CPU cache kullanım oranı |
| `vllm:num_preemptions_total` | Preemption sayısı |
| `vllm:prompt_tokens_total` | Toplam prompt token |
| `vllm:generation_tokens_total` | Toplam üretilen token |
| `vllm:request_success_total` | Başarılı istek sayısı |
| `vllm:e2e_request_latency_seconds` | Uçtan uca istek süresi |
| `vllm:time_to_first_token_seconds` | İlk token süresi (TTFT) |
| `vllm:time_per_output_token_seconds` | Token başına süre (TPOT) |

```bash
curl http://localhost:8010/metrics
```

### Prometheus Entegrasyonu

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'vllm-chat'
    static_configs:
      - targets: ['localhost:8010']
  - job_name: 'vllm-embed'
    static_configs:
      - targets: ['localhost:8011']
```

---

## GET /ping

AWS SageMaker uyumlu sağlık kontrolü.

```bash
curl http://localhost:8010/ping
```

---

## GET /load

Model yüklenme durumu kontrolü.

```bash
curl http://localhost:8010/load
```
