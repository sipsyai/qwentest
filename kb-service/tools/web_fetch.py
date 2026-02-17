"""
Web Fetch Tool - Fetch content from URLs.
"""

import httpx
import re

WEB_FETCH_TOOL = {
    "type": "function",
    "function": {
        "name": "web_fetch",
        "description": "Fetch content from a URL. Returns the text content of the page. Use this to retrieve external information, API responses, or web page content.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "The URL to fetch content from"
                },
                "method": {
                    "type": "string",
                    "description": "HTTP method (GET or POST, default: GET)",
                    "enum": ["GET", "POST"],
                    "default": "GET"
                },
                "headers": {
                    "type": "object",
                    "description": "Optional HTTP headers to send"
                },
                "body": {
                    "type": "string",
                    "description": "Optional request body for POST requests"
                }
            },
            "required": ["url"]
        }
    }
}


def _strip_html_tags(html: str) -> str:
    """Basic HTML to text conversion."""
    # Remove script and style blocks
    html = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', html, flags=re.DOTALL | re.IGNORECASE)
    # Replace block elements with newlines
    html = re.sub(r'<(br|p|div|h[1-6]|li|tr)[^>]*/?>', '\n', html, flags=re.IGNORECASE)
    # Remove remaining tags
    html = re.sub(r'<[^>]+>', '', html)
    # Decode common entities
    html = html.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    html = html.replace('&quot;', '"').replace('&nbsp;', ' ')
    # Collapse whitespace
    html = re.sub(r'\n{3,}', '\n\n', html)
    return html.strip()


async def execute_web_fetch(args: dict, context: dict) -> str:
    """
    Execute web fetch.
    No special context required.
    """
    url = args.get("url", "")
    method = args.get("method", "GET").upper()
    headers = args.get("headers", {})
    body = args.get("body")

    if not url:
        return "Error: url is required"

    # Basic URL validation
    if not url.startswith(("http://", "https://")):
        return "Error: URL must start with http:// or https://"

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True, max_redirects=5) as client:
            if method == "POST":
                resp = await client.post(url, headers=headers, content=body)
            else:
                resp = await client.get(url, headers=headers)

            content_type = resp.headers.get("content-type", "")

            # JSON response
            if "json" in content_type:
                try:
                    data = resp.json()
                    import json
                    text_content = json.dumps(data, ensure_ascii=False, indent=2)
                except Exception:
                    text_content = resp.text
            # HTML response
            elif "html" in content_type:
                text_content = _strip_html_tags(resp.text)
            # Plain text
            else:
                text_content = resp.text

            # Truncate if too long
            max_len = 8000
            if len(text_content) > max_len:
                text_content = text_content[:max_len] + f"\n\n... [truncated, total {len(resp.text)} chars]"

            return f"HTTP {resp.status_code} from {url}\n\n{text_content}"

    except httpx.TimeoutException:
        return f"Error: Request to {url} timed out after 30 seconds"
    except Exception as e:
        return f"Web fetch error: {str(e)}"
