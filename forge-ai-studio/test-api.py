#!/usr/bin/env python3
"""Quick test to verify vLLM backend connectivity from this machine."""
import urllib.request
import json
import sys

CHAT_URL = "http://192.168.1.8:8010/v1"
EMBED_URL = "http://192.168.1.8:8011/v1"

def test_endpoint(name, url, path="/models"):
    full_url = f"{url}{path}"
    print(f"\n{'='*50}")
    print(f"Testing {name}: {full_url}")
    print(f"{'='*50}")
    try:
        req = urllib.request.Request(full_url, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode())
            if "data" in data:
                for m in data["data"]:
                    print(f"  Model: {m['id']}")
            print(f"  Status: OK ({resp.status})")
            return True
    except Exception as e:
        print(f"  FAILED: {e}")
        return False

def test_chat():
    print(f"\n{'='*50}")
    print(f"Testing Chat Completion: {CHAT_URL}/chat/completions")
    print(f"{'='*50}")
    try:
        body = json.dumps({
            "model": "Qwen/Qwen3-4B",
            "messages": [{"role": "user", "content": "Say hello in one word."}],
            "max_tokens": 32,
            "temperature": 0.1,
        }).encode()
        req = urllib.request.Request(
            f"{CHAT_URL}/chat/completions",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
            content = data["choices"][0]["message"]["content"]
            print(f"  Response: {content[:100]}")
            print(f"  Tokens: {data.get('usage', {})}")
            print(f"  Status: OK")
            return True
    except Exception as e:
        print(f"  FAILED: {e}")
        return False

def test_embedding():
    print(f"\n{'='*50}")
    print(f"Testing Embeddings: {EMBED_URL}/embeddings")
    print(f"{'='*50}")
    try:
        body = json.dumps({
            "model": "nomic-ai/nomic-embed-text-v1.5",
            "input": ["Hello world"],
        }).encode()
        req = urllib.request.Request(
            f"{EMBED_URL}/embeddings",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())
            emb = data["data"][0]["embedding"]
            print(f"  Dimensions: {len(emb)}")
            print(f"  First 5 values: {emb[:5]}")
            print(f"  Tokens: {data.get('usage', {})}")
            print(f"  Status: OK")
            return True
    except Exception as e:
        print(f"  FAILED: {e}")
        return False

if __name__ == "__main__":
    results = []
    results.append(("Chat Models", test_endpoint("Chat Server", CHAT_URL)))
    results.append(("Embed Models", test_endpoint("Embed Server", EMBED_URL)))
    results.append(("Chat Completion", test_chat()))
    results.append(("Embeddings", test_embedding()))

    print(f"\n{'='*50}")
    print("SUMMARY")
    print(f"{'='*50}")
    for name, ok in results:
        status = "PASS" if ok else "FAIL"
        print(f"  {status}: {name}")

    if all(ok for _, ok in results):
        print("\nAll tests passed!")
    else:
        print("\nSome tests failed. Check server connectivity.")
        sys.exit(1)
