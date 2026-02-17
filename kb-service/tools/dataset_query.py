"""
Dataset Query Tool - Search and query saved dataset records.
"""

import json
from sqlalchemy import text

DATASET_QUERY_TOOL = {
    "type": "function",
    "function": {
        "name": "dataset_query",
        "description": "Search and query saved dataset records. Use this to find specific data from previously saved datasets, filter records, or retrieve structured information.",
        "parameters": {
            "type": "object",
            "properties": {
                "dataset_id": {
                    "type": "string",
                    "description": "UUID of the dataset to query. If not specified, searches across all datasets."
                },
                "search_text": {
                    "type": "string",
                    "description": "Text to search for within record data (case-insensitive substring match)"
                },
                "limit": {
                    "type": "integer",
                    "description": "Maximum number of records to return (default: 10)",
                    "default": 10
                }
            },
            "required": []
        }
    }
}


async def execute_dataset_query(args: dict, context: dict) -> str:
    """
    Execute dataset record query.
    context must contain: session (AsyncSession)
    """
    dataset_id = args.get("dataset_id")
    search_text = args.get("search_text", "")
    limit = min(args.get("limit", 10), 50)  # cap at 50

    session = context.get("session")
    if not session:
        return "Error: database session not available"

    try:
        # First, list available datasets if no dataset_id given and no search
        if not dataset_id and not search_text:
            result = await session.execute(text(
                "SELECT id, name, (SELECT COUNT(*) FROM dataset_records WHERE dataset_id = d.id) as record_count "
                "FROM datasets d ORDER BY updated_at DESC LIMIT 20"
            ))
            rows = result.fetchall()
            if not rows:
                return "No datasets found. Save some data from the Datasets page first."
            parts = ["Available datasets:\n"]
            for row in rows:
                parts.append(f"  - {row.name} (id: {row.id}, records: {row.record_count})")
            return "\n".join(parts)

        # Build query
        conditions = []
        params = {"limit": limit}

        if dataset_id:
            conditions.append("dr.dataset_id = :dataset_id")
            params["dataset_id"] = dataset_id

        if search_text:
            conditions.append("dr.data::text ILIKE :search")
            params["search"] = f"%{search_text}%"

        where = ""
        if conditions:
            where = "WHERE " + " AND ".join(conditions)

        query = f"""
            SELECT dr.id, dr.dataset_id, d.name as dataset_name, dr.data, dr.label
            FROM dataset_records dr
            LEFT JOIN datasets d ON d.id = dr.dataset_id
            {where}
            ORDER BY dr.created_at DESC
            LIMIT :limit
        """
        result = await session.execute(text(query), params)
        rows = result.fetchall()

        if not rows:
            return f"No records found matching the criteria."

        parts = [f"Found {len(rows)} record(s):\n"]
        for i, row in enumerate(rows, 1):
            data_str = json.dumps(row.data, ensure_ascii=False)
            if len(data_str) > 500:
                data_str = data_str[:500] + "..."
            label = f" [{row.label}]" if row.label else ""
            parts.append(f"--- Record {i} (dataset: {row.dataset_name}){label} ---")
            parts.append(data_str)
            parts.append("")

        return "\n".join(parts)

    except Exception as e:
        return f"Dataset query error: {str(e)}"
