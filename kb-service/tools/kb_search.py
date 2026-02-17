"""
KB Search Tool - Semantic search in the Knowledge Base using pgvector.
"""

import httpx
from sqlalchemy import text

KB_SEARCH_TOOL = {
    "type": "function",
    "function": {
        "name": "kb_search",
        "description": "Search the Knowledge Base for relevant documents using semantic similarity. Use this when you need to find information from stored documents, manuals, or any previously indexed content.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query to find relevant documents"
                },
                "top_k": {
                    "type": "integer",
                    "description": "Maximum number of results to return (default: 5)",
                    "default": 5
                },
                "threshold": {
                    "type": "number",
                    "description": "Minimum similarity threshold 0-1 (default: 0.3)",
                    "default": 0.3
                },
                "sources": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional list of source labels to filter results"
                }
            },
            "required": ["query"]
        }
    }
}


async def execute_kb_search(args: dict, context: dict) -> str:
    """
    Execute KB semantic search.
    context must contain: session (AsyncSession), embed_url (str), embed_model (str)
    """
    query = args.get("query", "")
    top_k = args.get("top_k", 5)
    threshold = args.get("threshold", 0.3)
    sources = args.get("sources", [])

    if not query:
        return "Error: query is required"

    session = context.get("session")
    embed_url = context.get("embed_url")
    embed_model = context.get("embed_model")

    if not session or not embed_url or not embed_model:
        return "Error: KB search context not configured (session, embed_url, embed_model required)"

    try:
        # 1. Embed the query
        async with httpx.AsyncClient(timeout=30.0) as client:
            embed_resp = await client.post(
                f"{embed_url}/embeddings",
                json={"model": embed_model, "input": query}
            )
            embed_data = embed_resp.json()
            query_embedding = embed_data["data"][0]["embedding"]

        # 2. Search pgvector
        embedding_str = "[" + ",".join(str(v) for v in query_embedding) + "]"
        search_params = {
            "embedding": embedding_str,
            "threshold": threshold,
            "top_k": top_k,
        }

        conditions = []
        if sources:
            src_placeholders = ", ".join(f":src_{i}" for i in range(len(sources)))
            conditions.append(f"source_label IN ({src_placeholders})")
            for i, src in enumerate(sources):
                search_params[f"src_{i}"] = src

        where_clause = ""
        if conditions:
            where_clause = "AND " + " AND ".join(conditions)

        search_query = f"""
            SELECT text, source_label, 1 - (embedding <=> CAST(:embedding AS vector)) AS similarity
            FROM kb_documents
            WHERE 1 - (embedding <=> CAST(:embedding AS vector)) >= :threshold
            {where_clause}
            ORDER BY similarity DESC
            LIMIT :top_k
        """
        result = await session.execute(text(search_query), search_params)
        rows = result.fetchall()

        if not rows:
            return f"No documents found matching '{query}' with threshold >= {threshold}"

        # Format results
        parts = [f"Found {len(rows)} relevant document(s):\n"]
        for i, row in enumerate(rows, 1):
            source_info = f" [source: {row.source_label}]" if row.source_label else ""
            parts.append(f"--- Result {i} (similarity: {row.similarity:.3f}){source_info} ---")
            parts.append(row.text)
            parts.append("")

        return "\n".join(parts)

    except Exception as e:
        return f"KB search error: {str(e)}"
