import json
import re
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from fastapi import FastAPI, Depends, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from sqlalchemy import text, func
from sqlalchemy.ext.asyncio import AsyncSession

from database import init_db, get_session, async_session
from models import (
    DocumentsAddRequest, DocumentResponse, DocumentsListResponse,
    BulkDeleteRequest, BulkDeleteResponse,
    SearchRequest, SearchResponse, SearchResultItem,
    StatsResponse, MessageResponse,
    SettingsResponse, SettingsUpdateRequest,
    HistoryItemInput, HistoryItemResponse, HistoryItemDetailResponse, HistoryListResponse,
    DatasetCreate, DatasetUpdate, DatasetResponse, DatasetListResponse,
    DatasetFetchRequest, DatasetFetchResponse,
    DatasetRecordBulkCreate, DatasetRecordResponse, DatasetRecordListResponse,
    AgentCreate, AgentUpdate, AgentResponse, AgentListResponse,
    AgentRunRequest,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="Forge KB Service", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/api/kb/documents", response_model=MessageResponse)
async def add_documents(req: DocumentsAddRequest, session: AsyncSession = Depends(get_session)):
    if not req.documents:
        raise HTTPException(status_code=400, detail="No documents provided")

    values = []
    params = {}
    for i, doc in enumerate(req.documents):
        doc_id = str(uuid.uuid4())
        embedding_str = "[" + ",".join(str(v) for v in doc.embedding) + "]"
        values.append(
            f"(:id_{i}, :text_{i}, CAST(:embedding_{i} AS vector), :source_{i}, :source_label_{i})"
        )
        params[f"id_{i}"] = doc_id
        params[f"text_{i}"] = doc.text
        params[f"embedding_{i}"] = embedding_str
        params[f"source_{i}"] = doc.source
        params[f"source_label_{i}"] = doc.source_label

    query = f"""
        INSERT INTO kb_documents (id, text, embedding, source, source_label)
        VALUES {', '.join(values)}
        ON CONFLICT ((md5(text))) DO NOTHING
    """
    result = await session.execute(text(query), params)
    await session.commit()

    inserted = result.rowcount
    skipped = len(req.documents) - inserted
    msg = f"Added {inserted} documents"
    if skipped > 0:
        msg += f" ({skipped} duplicates skipped)"

    return MessageResponse(message=msg, count=inserted)


@app.get("/api/kb/documents", response_model=DocumentsListResponse)
async def list_documents(
    source: Optional[str] = Query(None),
    source_label: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
):
    conditions = []
    params = {}

    if source:
        conditions.append("source = :source")
        params["source"] = source
    if source_label:
        conditions.append("source_label = :source_label")
        params["source_label"] = source_label

    where_clause = ""
    if conditions:
        where_clause = "WHERE " + " AND ".join(conditions)

    # Count
    count_query = f"SELECT COUNT(*) FROM kb_documents {where_clause}"
    result = await session.execute(text(count_query), params)
    total = result.scalar()

    # Fetch (without embedding for performance)
    offset = (page - 1) * limit
    fetch_query = f"""
        SELECT id, text, source, source_label, created_at
        FROM kb_documents
        {where_clause}
        ORDER BY created_at DESC
        LIMIT :limit OFFSET :offset
    """
    params["limit"] = limit
    params["offset"] = offset

    result = await session.execute(text(fetch_query), params)
    rows = result.fetchall()

    data = [
        DocumentResponse(
            id=str(row.id),
            text=row.text,
            source=row.source,
            source_label=row.source_label,
            created_at=row.created_at,
        )
        for row in rows
    ]

    return DocumentsListResponse(data=data, total=total, page=page, limit=limit)


@app.delete("/api/kb/documents/{doc_id}", response_model=MessageResponse)
async def delete_document(doc_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        text("DELETE FROM kb_documents WHERE id = :id"), {"id": doc_id}
    )
    await session.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Document not found")

    return MessageResponse(message="Document deleted")


@app.post("/api/kb/documents/bulk-delete", response_model=BulkDeleteResponse)
async def bulk_delete(req: BulkDeleteRequest, session: AsyncSession = Depends(get_session)):
    if not req.ids:
        return BulkDeleteResponse(deleted=0)

    placeholders = ", ".join(f":id_{i}" for i in range(len(req.ids)))
    params = {f"id_{i}": uid for i, uid in enumerate(req.ids)}

    result = await session.execute(
        text(f"DELETE FROM kb_documents WHERE id IN ({placeholders})"), params
    )
    await session.commit()

    return BulkDeleteResponse(deleted=result.rowcount)


@app.post("/api/kb/search", response_model=SearchResponse)
async def search_documents(req: SearchRequest, session: AsyncSession = Depends(get_session)):
    start = time.time()

    embedding_str = "[" + ",".join(str(v) for v in req.embedding) + "]"

    conditions = []
    params = {
        "embedding": embedding_str,
        "threshold": req.threshold,
        "top_k": req.top_k,
    }

    if req.sources:
        source_placeholders = ", ".join(f":src_{i}" for i in range(len(req.sources)))
        conditions.append(f"source_label IN ({source_placeholders})")
        for i, src in enumerate(req.sources):
            params[f"src_{i}"] = src

    where_clause = ""
    if conditions:
        where_clause = "AND " + " AND ".join(conditions)

    query = f"""
        SELECT id, text, source, source_label, created_at,
               1 - (embedding <=> CAST(:embedding AS vector)) AS similarity
        FROM kb_documents
        WHERE 1 - (embedding <=> CAST(:embedding AS vector)) >= :threshold
        {where_clause}
        ORDER BY similarity DESC
        LIMIT :top_k
    """

    result = await session.execute(text(query), params)
    rows = result.fetchall()

    elapsed_ms = int((time.time() - start) * 1000)

    results = [
        SearchResultItem(
            id=str(row.id),
            text=row.text,
            source=row.source,
            source_label=row.source_label,
            similarity=round(float(row.similarity), 4),
            created_at=row.created_at,
        )
        for row in rows
    ]

    return SearchResponse(results=results, search_time_ms=elapsed_ms)


@app.get("/api/kb/stats", response_model=StatsResponse)
async def get_stats(session: AsyncSession = Depends(get_session)):
    # Total count
    result = await session.execute(text("SELECT COUNT(*) FROM kb_documents"))
    total = result.scalar()

    # Source counts
    result = await session.execute(
        text("SELECT source, COUNT(*) as cnt FROM kb_documents GROUP BY source")
    )
    sources = {row.source: row.cnt for row in result.fetchall()}

    # Distinct source_labels
    result = await session.execute(
        text("SELECT DISTINCT source_label FROM kb_documents WHERE source_label != '' ORDER BY source_label")
    )
    source_labels = [row.source_label for row in result.fetchall()]

    return StatsResponse(total=total, sources=sources, source_labels=source_labels)


@app.delete("/api/kb/clear", response_model=MessageResponse)
async def clear_all(session: AsyncSession = Depends(get_session)):
    result = await session.execute(text("DELETE FROM kb_documents"))
    await session.commit()
    return MessageResponse(message=f"Cleared {result.rowcount} documents", count=result.rowcount)


# ==================== Settings Endpoints ====================


@app.get("/api/kb/settings", response_model=SettingsResponse)
async def get_settings(session: AsyncSession = Depends(get_session)):
    result = await session.execute(text("SELECT key, value FROM app_settings"))
    rows = result.fetchall()
    return SettingsResponse(settings={row.key: row.value for row in rows})


@app.put("/api/kb/settings", response_model=SettingsResponse)
async def update_settings(req: SettingsUpdateRequest, session: AsyncSession = Depends(get_session)):
    for key, value in req.settings.items():
        await session.execute(
            text("""
                INSERT INTO app_settings (key, value, updated_at)
                VALUES (:key, :value, NOW())
                ON CONFLICT (key) DO UPDATE SET value = :value, updated_at = NOW()
            """),
            {"key": key, "value": value}
        )
    await session.commit()

    result = await session.execute(text("SELECT key, value FROM app_settings"))
    rows = result.fetchall()
    return SettingsResponse(settings={row.key: row.value for row in rows})


# ==================== History Endpoints ====================


@app.get("/api/kb/history", response_model=HistoryListResponse)
async def get_history(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(text("SELECT COUNT(*) FROM request_history"))
    total = result.scalar()

    offset = (page - 1) * limit
    result = await session.execute(
        text("""
            SELECT id, method, endpoint, model, timestamp, duration,
                   tokens, status, status_text, preview, created_at
            FROM request_history
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        {"limit": limit, "offset": offset}
    )
    rows = result.fetchall()

    data = [
        HistoryItemResponse(
            id=row.id, method=row.method, endpoint=row.endpoint,
            model=row.model, timestamp=row.timestamp, duration=row.duration,
            tokens=row.tokens, status=row.status, status_text=row.status_text,
            preview=row.preview, created_at=row.created_at,
        )
        for row in rows
    ]
    return HistoryListResponse(data=data, total=total, page=page, limit=limit)


@app.post("/api/kb/history", response_model=MessageResponse)
async def add_history_item(item: HistoryItemInput, session: AsyncSession = Depends(get_session)):
    await session.execute(
        text("""
            INSERT INTO request_history (id, method, endpoint, model, timestamp, duration, tokens, status, status_text, preview, request_payload, response_payload)
            VALUES (:id, :method, :endpoint, :model, :timestamp, :duration, :tokens, :status, :status_text, :preview, CAST(:request_payload AS jsonb), CAST(:response_payload AS jsonb))
            ON CONFLICT (id) DO NOTHING
        """),
        {
            "id": item.id, "method": item.method, "endpoint": item.endpoint,
            "model": item.model, "timestamp": item.timestamp, "duration": item.duration,
            "tokens": item.tokens, "status": item.status, "status_text": item.status_text,
            "preview": item.preview,
            "request_payload": json.dumps(item.request_payload) if item.request_payload else None,
            "response_payload": json.dumps(item.response_payload) if item.response_payload else None,
        }
    )
    await session.commit()
    return MessageResponse(message="History item added", count=1)


@app.post("/api/kb/history/bulk", response_model=MessageResponse)
async def bulk_add_history(items: list[HistoryItemInput], session: AsyncSession = Depends(get_session)):
    inserted = 0
    for item in items:
        result = await session.execute(
            text("""
                INSERT INTO request_history (id, method, endpoint, model, timestamp, duration, tokens, status, status_text, preview, request_payload, response_payload)
                VALUES (:id, :method, :endpoint, :model, :timestamp, :duration, :tokens, :status, :status_text, :preview, CAST(:request_payload AS jsonb), CAST(:response_payload AS jsonb))
                ON CONFLICT (id) DO NOTHING
            """),
            {
                "id": item.id, "method": item.method, "endpoint": item.endpoint,
                "model": item.model, "timestamp": item.timestamp, "duration": item.duration,
                "tokens": item.tokens, "status": item.status, "status_text": item.status_text,
                "preview": item.preview,
                "request_payload": json.dumps(item.request_payload) if item.request_payload else None,
                "response_payload": json.dumps(item.response_payload) if item.response_payload else None,
            }
        )
        inserted += result.rowcount
    await session.commit()
    return MessageResponse(message=f"Bulk inserted {inserted} history items", count=inserted)


@app.get("/api/kb/history/{item_id}", response_model=HistoryItemDetailResponse)
async def get_history_item(item_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        text("""
            SELECT id, method, endpoint, model, timestamp, duration,
                   tokens, status, status_text, preview, created_at,
                   request_payload, response_payload
            FROM request_history
            WHERE id = :id
        """),
        {"id": item_id}
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="History item not found")

    req_payload = row.request_payload
    if isinstance(req_payload, str):
        try:
            req_payload = json.loads(req_payload)
        except Exception:
            req_payload = None

    res_payload = row.response_payload
    if isinstance(res_payload, str):
        try:
            res_payload = json.loads(res_payload)
        except Exception:
            res_payload = None

    return HistoryItemDetailResponse(
        id=row.id, method=row.method, endpoint=row.endpoint,
        model=row.model, timestamp=row.timestamp, duration=row.duration,
        tokens=row.tokens, status=row.status, status_text=row.status_text,
        preview=row.preview, created_at=row.created_at,
        request_payload=req_payload,
        response_payload=res_payload,
    )


@app.delete("/api/kb/history/{item_id}", response_model=MessageResponse)
async def delete_history_item(item_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        text("DELETE FROM request_history WHERE id = :id"), {"id": item_id}
    )
    await session.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="History item not found")
    return MessageResponse(message="History item deleted")


@app.delete("/api/kb/history", response_model=MessageResponse)
async def clear_history(session: AsyncSession = Depends(get_session)):
    result = await session.execute(text("DELETE FROM request_history"))
    await session.commit()
    return MessageResponse(message=f"Cleared {result.rowcount} history items", count=result.rowcount)


# ==================== Dataset Endpoints ====================


def _row_to_dataset_response(row) -> DatasetResponse:
    raw = getattr(row, 'raw_data', None)
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            raw = None
    return DatasetResponse(
        id=str(row.id), name=row.name, url=row.url, method=row.method,
        token=row.token,
        headers=row.headers if isinstance(row.headers, dict) else json.loads(row.headers or '{}'),
        array_path=row.array_path or '',
        extract_fields=row.extract_fields if isinstance(row.extract_fields, list) else json.loads(row.extract_fields or '[]'),
        raw_data=raw,
        created_at=row.created_at, updated_at=row.updated_at,
    )


@app.get("/api/kb/datasets", response_model=DatasetListResponse)
async def list_datasets(session: AsyncSession = Depends(get_session)):
    result = await session.execute(text(
        "SELECT id, name, url, method, token, headers, array_path, extract_fields, raw_data, created_at, updated_at "
        "FROM datasets ORDER BY created_at DESC"
    ))
    rows = result.fetchall()
    data = [_row_to_dataset_response(row) for row in rows]
    return DatasetListResponse(data=data, total=len(data))


@app.post("/api/kb/datasets", response_model=DatasetResponse)
async def create_dataset(req: DatasetCreate, session: AsyncSession = Depends(get_session)):
    ds_id = str(uuid.uuid4())
    await session.execute(
        text("""
            INSERT INTO datasets (id, name, url, method, token, headers, array_path, extract_fields, raw_data)
            VALUES (:id, :name, :url, :method, :token, CAST(:headers AS jsonb), :array_path, CAST(:extract_fields AS jsonb), CAST(:raw_data AS jsonb))
        """),
        {
            "id": ds_id, "name": req.name, "url": req.url, "method": req.method,
            "token": req.token, "headers": json.dumps(req.headers),
            "array_path": req.array_path, "extract_fields": json.dumps(req.extract_fields),
            "raw_data": json.dumps(req.raw_data) if req.raw_data is not None else None,
        }
    )
    await session.commit()

    result = await session.execute(
        text("SELECT id, name, url, method, token, headers, array_path, extract_fields, raw_data, created_at, updated_at FROM datasets WHERE id = :id"),
        {"id": ds_id}
    )
    row = result.fetchone()
    return _row_to_dataset_response(row)


@app.put("/api/kb/datasets/{ds_id}", response_model=DatasetResponse)
async def update_dataset(ds_id: str, req: DatasetUpdate, session: AsyncSession = Depends(get_session)):
    updates = {}
    params = {"id": ds_id}
    if req.name is not None:
        updates["name"] = "name = :name"
        params["name"] = req.name
    if req.url is not None:
        updates["url"] = "url = :url"
        params["url"] = req.url
    if req.method is not None:
        updates["method"] = "method = :method"
        params["method"] = req.method
    if req.token is not None:
        updates["token"] = "token = :token"
        params["token"] = req.token
    if req.headers is not None:
        updates["headers"] = "headers = CAST(:headers AS jsonb)"
        params["headers"] = json.dumps(req.headers)
    if req.array_path is not None:
        updates["array_path"] = "array_path = :array_path"
        params["array_path"] = req.array_path
    if req.extract_fields is not None:
        updates["extract_fields"] = "extract_fields = CAST(:extract_fields AS jsonb)"
        params["extract_fields"] = json.dumps(req.extract_fields)
    if req.raw_data is not None:
        updates["raw_data"] = "raw_data = CAST(:raw_data AS jsonb)"
        params["raw_data"] = json.dumps(req.raw_data)

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(updates.values()) + ", updated_at = NOW()"
    result = await session.execute(
        text(f"UPDATE datasets SET {set_clause} WHERE id = :id"),
        params
    )
    await session.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Dataset not found")

    result = await session.execute(
        text("SELECT id, name, url, method, token, headers, array_path, extract_fields, raw_data, created_at, updated_at FROM datasets WHERE id = :id"),
        {"id": ds_id}
    )
    row = result.fetchone()
    return _row_to_dataset_response(row)


@app.get("/api/kb/datasets/{ds_id}", response_model=DatasetResponse)
async def get_dataset(ds_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        text("SELECT id, name, url, method, token, headers, array_path, extract_fields, raw_data, created_at, updated_at FROM datasets WHERE id = :id"),
        {"id": ds_id}
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return _row_to_dataset_response(row)


@app.delete("/api/kb/datasets/{ds_id}", response_model=MessageResponse)
async def delete_dataset(ds_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        text("DELETE FROM datasets WHERE id = :id"), {"id": ds_id}
    )
    await session.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return MessageResponse(message="Dataset deleted (records cascade-deleted)")


@app.post("/api/kb/datasets/{ds_id}/fetch", response_model=DatasetFetchResponse)
async def fetch_dataset_url(ds_id: str, req: DatasetFetchRequest = None, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        text("SELECT url, method, token, headers FROM datasets WHERE id = :id"),
        {"id": ds_id}
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Dataset not found")

    headers = {}
    raw_headers = row.headers
    if isinstance(raw_headers, str):
        raw_headers = json.loads(raw_headers or '{}')
    if isinstance(raw_headers, dict):
        headers.update(raw_headers)

    if row.token:
        headers["Authorization"] = f"Bearer {row.token}"

    start = time.time()
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            if row.method.upper() == "POST":
                body = req.body if req and req.body else None
                resp = await client.post(row.url, headers=headers, json=body)
            else:
                resp = await client.get(row.url, headers=headers)

        elapsed_ms = int((time.time() - start) * 1000)

        try:
            data = resp.json()
        except Exception:
            data = resp.text

        return DatasetFetchResponse(status=resp.status_code, data=data, elapsed_ms=elapsed_ms)
    except httpx.RequestError as e:
        elapsed_ms = int((time.time() - start) * 1000)
        raise HTTPException(status_code=502, detail=f"Fetch failed: {str(e)}")


# ==================== Dataset Records Endpoints ====================


@app.get("/api/kb/dataset-records/all", response_model=DatasetRecordListResponse)
async def list_all_dataset_records(
    dataset_id: str = Query(...),
    session: AsyncSession = Depends(get_session),
):
    count_result = await session.execute(
        text("SELECT COUNT(*) FROM dataset_records WHERE dataset_id = :dataset_id"),
        {"dataset_id": dataset_id}
    )
    total = count_result.scalar()

    result = await session.execute(
        text("""
            SELECT id, dataset_id, data, json_path, label, created_at
            FROM dataset_records
            WHERE dataset_id = :dataset_id
            ORDER BY created_at ASC
        """),
        {"dataset_id": dataset_id}
    )
    rows = result.fetchall()

    data = [
        DatasetRecordResponse(
            id=str(row.id), dataset_id=str(row.dataset_id),
            data=row.data if isinstance(row.data, dict) else json.loads(row.data),
            json_path=row.json_path, label=row.label, created_at=row.created_at,
        )
        for row in rows
    ]

    return DatasetRecordListResponse(data=data, total=total, page=1, limit=total or 1)


@app.get("/api/kb/dataset-records", response_model=DatasetRecordListResponse)
async def list_dataset_records(
    dataset_id: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
):
    conditions = []
    params = {}

    if dataset_id:
        conditions.append("dataset_id = :dataset_id")
        params["dataset_id"] = dataset_id

    where_clause = ""
    if conditions:
        where_clause = "WHERE " + " AND ".join(conditions)

    count_result = await session.execute(
        text(f"SELECT COUNT(*) FROM dataset_records {where_clause}"), params
    )
    total = count_result.scalar()

    offset = (page - 1) * limit
    fetch_params = {**params, "limit": limit, "offset": offset}
    result = await session.execute(
        text(f"""
            SELECT id, dataset_id, data, json_path, label, created_at
            FROM dataset_records
            {where_clause}
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        fetch_params
    )
    rows = result.fetchall()

    data = [
        DatasetRecordResponse(
            id=str(row.id), dataset_id=str(row.dataset_id),
            data=row.data if isinstance(row.data, dict) else json.loads(row.data),
            json_path=row.json_path, label=row.label, created_at=row.created_at,
        )
        for row in rows
    ]

    return DatasetRecordListResponse(data=data, total=total, page=page, limit=limit)


@app.post("/api/kb/dataset-records", response_model=MessageResponse)
async def bulk_create_records(req: DatasetRecordBulkCreate, session: AsyncSession = Depends(get_session)):
    if not req.records:
        return MessageResponse(message="No records provided", count=0)

    inserted = 0
    for rec in req.records:
        rec_id = str(uuid.uuid4())
        result = await session.execute(
            text("""
                INSERT INTO dataset_records (id, dataset_id, data, json_path, label)
                VALUES (:id, :dataset_id, CAST(:data_val AS jsonb), :json_path, :label)
                ON CONFLICT (dataset_id, md5(data::text)) DO NOTHING
            """),
            {
                "id": rec_id, "dataset_id": rec.dataset_id,
                "data_val": json.dumps(rec.data), "json_path": rec.json_path, "label": rec.label,
            }
        )
        inserted += result.rowcount
    await session.commit()

    skipped = len(req.records) - inserted
    msg = f"Saved {inserted} records"
    if skipped > 0:
        msg += f" ({skipped} duplicates skipped)"
    return MessageResponse(message=msg, count=inserted)


@app.delete("/api/kb/dataset-records/{record_id}", response_model=MessageResponse)
async def delete_record(record_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        text("DELETE FROM dataset_records WHERE id = :id"), {"id": record_id}
    )
    await session.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Record not found")
    return MessageResponse(message="Record deleted")


@app.post("/api/kb/dataset-records/bulk-delete", response_model=BulkDeleteResponse)
async def bulk_delete_records(req: BulkDeleteRequest, session: AsyncSession = Depends(get_session)):
    if not req.ids:
        return BulkDeleteResponse(deleted=0)

    placeholders = ", ".join(f":id_{i}" for i in range(len(req.ids)))
    params = {f"id_{i}": uid for i, uid in enumerate(req.ids)}

    result = await session.execute(
        text(f"DELETE FROM dataset_records WHERE id IN ({placeholders})"), params
    )
    await session.commit()
    return BulkDeleteResponse(deleted=result.rowcount)


# ==================== Agent Endpoints ====================


def _row_to_agent_response(row) -> AgentResponse:
    config = row.config
    if isinstance(config, str):
        try:
            config = json.loads(config)
        except Exception:
            config = {}
    return AgentResponse(
        id=str(row.id), name=row.name, description=row.description,
        config=config, created_at=row.created_at, updated_at=row.updated_at,
    )


@app.get("/api/kb/agents", response_model=AgentListResponse)
async def list_agents(session: AsyncSession = Depends(get_session)):
    result = await session.execute(text(
        "SELECT id, name, description, config, created_at, updated_at "
        "FROM saved_agents ORDER BY updated_at DESC"
    ))
    rows = result.fetchall()
    data = [_row_to_agent_response(row) for row in rows]
    return AgentListResponse(data=data, total=len(data))


@app.post("/api/kb/agents", response_model=AgentResponse)
async def create_agent(req: AgentCreate, session: AsyncSession = Depends(get_session)):
    agent_id = str(uuid.uuid4())
    await session.execute(
        text("""
            INSERT INTO saved_agents (id, name, description, config)
            VALUES (:id, :name, :description, CAST(:config AS jsonb))
        """),
        {
            "id": agent_id, "name": req.name,
            "description": req.description, "config": json.dumps(req.config),
        }
    )
    await session.commit()

    result = await session.execute(
        text("SELECT id, name, description, config, created_at, updated_at FROM saved_agents WHERE id = :id"),
        {"id": agent_id}
    )
    row = result.fetchone()
    return _row_to_agent_response(row)


@app.get("/api/kb/agents/{agent_id}", response_model=AgentResponse)
async def get_agent(agent_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        text("SELECT id, name, description, config, created_at, updated_at FROM saved_agents WHERE id = :id"),
        {"id": agent_id}
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")
    return _row_to_agent_response(row)


@app.put("/api/kb/agents/{agent_id}", response_model=AgentResponse)
async def update_agent(agent_id: str, req: AgentUpdate, session: AsyncSession = Depends(get_session)):
    updates = {}
    params = {"id": agent_id}
    if req.name is not None:
        updates["name"] = "name = :name"
        params["name"] = req.name
    if req.description is not None:
        updates["description"] = "description = :description"
        params["description"] = req.description
    if req.config is not None:
        updates["config"] = "config = CAST(:config AS jsonb)"
        params["config"] = json.dumps(req.config)

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(updates.values()) + ", updated_at = NOW()"
    result = await session.execute(
        text(f"UPDATE saved_agents SET {set_clause} WHERE id = :id"),
        params
    )
    await session.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Agent not found")

    result = await session.execute(
        text("SELECT id, name, description, config, created_at, updated_at FROM saved_agents WHERE id = :id"),
        {"id": agent_id}
    )
    row = result.fetchone()
    return _row_to_agent_response(row)


@app.delete("/api/kb/agents/{agent_id}", response_model=MessageResponse)
async def delete_agent(agent_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        text("DELETE FROM saved_agents WHERE id = :id"), {"id": agent_id}
    )
    await session.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Agent not found")
    return MessageResponse(message="Agent deleted")


# ==================== Agent Run Helpers ====================

VLLM_CHAT_DEFAULT = "http://192.168.1.8:8010/v1"
VLLM_EMBED_DEFAULT = "http://192.168.1.8:8011/v1"

VARIABLE_PATTERN = re.compile(r'\{\{(\w+)\}\}')
RESERVED_VARIABLES = {"context"}


async def resolve_vllm_url(session: AsyncSession, setting_key: str, fallback_key: str, default: str) -> str:
    """Resolve a vLLM URL from settings, skipping proxy paths (start with /)."""
    result = await session.execute(
        text("SELECT key, value FROM app_settings WHERE key IN (:k1, :k2)"),
        {"k1": setting_key, "k2": fallback_key}
    )
    settings = {row.key: row.value for row in result.fetchall()}
    primary = settings.get(setting_key, "")
    fallback = settings.get(fallback_key, "")
    # Skip proxy paths like /api/chat
    if primary and not primary.startswith("/"):
        return primary
    if fallback and not fallback.startswith("/"):
        return fallback
    return default


def resolve_template(template: str, variables: dict[str, str]) -> str:
    """Replace {{var}} placeholders, leaving {{context}} untouched (reserved for RAG)."""
    def replacer(match):
        name = match.group(1)
        if name in RESERVED_VARIABLES:
            return match.group(0)  # keep as-is
        return variables.get(name, "")
    return VARIABLE_PATTERN.sub(replacer, template)


# ==================== Agent Run Endpoint ====================


@app.post("/api/kb/agents/{agent_id}/run")
async def run_agent(agent_id: str, req: AgentRunRequest = None, session: AsyncSession = Depends(get_session)):
    if req is None:
        req = AgentRunRequest()

    # 1. Load agent
    result = await session.execute(
        text("SELECT id, name, description, config FROM saved_agents WHERE id = :id"),
        {"id": agent_id}
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Agent not found")

    config = row.config
    if isinstance(config, str):
        config = json.loads(config)

    agent_name = row.name

    # 2. Extract config values
    system_prompt = config.get("systemPrompt", "")
    prompt_template = config.get("promptTemplate", "")
    config_variables = config.get("variables", [])
    model = config.get("selectedModel", "")
    use_stream = req.stream if req.stream is not None else config.get("stream", True)
    thinking = config.get("thinking", False)
    json_mode = config.get("jsonMode", False)
    temperature = config.get("temperature", 0.7)
    top_p = config.get("topP", 0.9)
    top_k = config.get("topK", 0)
    max_tokens = config.get("maxTokens", 2048)
    presence_penalty = config.get("presencePenalty", 0)
    frequency_penalty = config.get("frequencyPenalty", 0)
    repetition_penalty = config.get("repetitionPenalty", 1.0)
    seed_str = config.get("seed", "")
    stop_sequences = config.get("stopSequences", "")
    rag_enabled = config.get("ragEnabled", False)
    rag_top_k = config.get("ragTopK", 3)
    rag_threshold = config.get("ragThreshold", 0.3)
    rag_sources = config.get("ragSources", [])

    if not model:
        raise HTTPException(status_code=400, detail="Agent has no model configured")
    if not prompt_template:
        raise HTTPException(status_code=400, detail="Agent has no promptTemplate configured")

    # 3. Merge variables: request overrides > config defaults
    merged_vars = {}
    for v in config_variables:
        name = v.get("name", "")
        if name:
            merged_vars[name] = v.get("defaultValue", "")
    merged_vars.update(req.variables)

    # 4. Resolve templates
    resolved_prompt = resolve_template(prompt_template, merged_vars)
    resolved_system = resolve_template(system_prompt, merged_vars)

    # 5. Build messages
    messages = []
    rag_context_count = 0

    if rag_enabled:
        try:
            embed_url = await resolve_vllm_url(session, "forge_embed_url", "forge_embed_fallback_url", VLLM_EMBED_DEFAULT)

            # Get embed model name
            async with httpx.AsyncClient(timeout=10.0) as client:
                model_resp = await client.get(f"{embed_url}/models")
                model_data = model_resp.json()
                embed_model = model_data["data"][0]["id"] if model_data.get("data") else None

            if embed_model:
                # Embed the resolved prompt
                async with httpx.AsyncClient(timeout=30.0) as client:
                    embed_resp = await client.post(
                        f"{embed_url}/embeddings",
                        json={"model": embed_model, "input": resolved_prompt}
                    )
                    embed_data = embed_resp.json()
                    query_embedding = embed_data["data"][0]["embedding"]

                # Search pgvector
                embedding_str = "[" + ",".join(str(v) for v in query_embedding) + "]"
                search_params = {
                    "embedding": embedding_str,
                    "threshold": rag_threshold,
                    "top_k": rag_top_k,
                }
                conditions = []
                if rag_sources:
                    src_placeholders = ", ".join(f":src_{i}" for i in range(len(rag_sources)))
                    conditions.append(f"source_label IN ({src_placeholders})")
                    for i, src in enumerate(rag_sources):
                        search_params[f"src_{i}"] = src

                where_clause = ""
                if conditions:
                    where_clause = "AND " + " AND ".join(conditions)

                search_query = f"""
                    SELECT text, 1 - (embedding <=> CAST(:embedding AS vector)) AS similarity
                    FROM kb_documents
                    WHERE 1 - (embedding <=> CAST(:embedding AS vector)) >= :threshold
                    {where_clause}
                    ORDER BY similarity DESC
                    LIMIT :top_k
                """
                search_result = await session.execute(text(search_query), search_params)
                search_rows = search_result.fetchall()

                if search_rows:
                    context_text = "\n\n---\n\n".join(r.text for r in search_rows)
                    rag_context_count = len(search_rows)

                    if "{{context}}" in resolved_prompt:
                        resolved_prompt = resolved_prompt.replace("{{context}}", context_text)
                    else:
                        # Inject into system prompt
                        resolved_system = resolved_system + f"\n\n[Retrieved Context]\n{context_text}"
        except Exception as e:
            # RAG failed, continue without it
            pass

    if resolved_system.strip():
        messages.append({"role": "system", "content": resolved_system})
    messages.append({"role": "user", "content": resolved_prompt})

    # 6. Build vLLM request body
    body = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "top_p": top_p,
        "max_tokens": max_tokens,
        "stream": use_stream,
    }
    if top_k > 0:
        body["top_k"] = top_k
    if presence_penalty != 0:
        body["presence_penalty"] = presence_penalty
    if frequency_penalty != 0:
        body["frequency_penalty"] = frequency_penalty
    if repetition_penalty != 1.0:
        body["repetition_penalty"] = repetition_penalty
    if seed_str:
        try:
            body["seed"] = int(seed_str)
        except ValueError:
            pass
    if stop_sequences:
        stops = [s.strip() for s in stop_sequences.split(",") if s.strip()]
        if stops:
            body["stop"] = stops
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    body["chat_template_kwargs"] = {"enable_thinking": thinking}

    chat_url = await resolve_vllm_url(session, "forge_chat_url", "forge_chat_fallback_url", VLLM_CHAT_DEFAULT)
    start_time = time.time()

    # 7. Execute
    if use_stream:
        async def stream_generator():
            full_text = ""
            status_code = 200
            try:
                async with httpx.AsyncClient(timeout=300.0) as client:
                    async with client.stream(
                        "POST",
                        f"{chat_url}/chat/completions",
                        json=body,
                        headers={"Content-Type": "application/json"},
                    ) as resp:
                        status_code = resp.status_code
                        if resp.status_code != 200:
                            error_body = await resp.aread()
                            yield f"data: {json.dumps({'error': error_body.decode()})}\n\n"
                            return
                        async for line in resp.aiter_lines():
                            if line.startswith("data: "):
                                yield line + "\n\n"
                                payload = line[6:]
                                if payload.strip() == "[DONE]":
                                    continue
                                try:
                                    chunk = json.loads(payload)
                                    delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
                                    if delta:
                                        full_text += delta
                                except Exception:
                                    pass
            except httpx.RequestError as e:
                status_code = 502
                yield f"data: {json.dumps({'error': str(e)})}\n\n"
            finally:
                # Log to history in a separate session
                elapsed_ms = int((time.time() - start_time) * 1000)
                try:
                    async with async_session() as hist_session:
                        hist_id = f"req_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
                        preview = full_text[:150] if full_text else "Error"
                        duration = f"{elapsed_ms}ms" if elapsed_ms < 1000 else f"{elapsed_ms/1000:.1f}s"
                        token_est = (len(resolved_prompt) + len(full_text)) // 4

                        req_payload = {
                            "messages": messages,
                            "params": {k: v for k, v in body.items() if k != "messages"},
                            "agent": {"id": agent_id, "name": agent_name},
                            "variables": merged_vars,
                        }
                        if rag_enabled:
                            req_payload["rag"] = {
                                "enabled": True, "topK": rag_top_k,
                                "threshold": rag_threshold, "sources": rag_sources,
                                "contextCount": rag_context_count,
                            }

                        res_payload = {"text": full_text[:50000], "truncated": len(full_text) > 50000}

                        await hist_session.execute(
                            text("""
                                INSERT INTO request_history (id, method, endpoint, model, timestamp, duration, tokens, status, status_text, preview, request_payload, response_payload)
                                VALUES (:id, :method, :endpoint, :model, :timestamp, :duration, :tokens, :status, :status_text, :preview, CAST(:request_payload AS jsonb), CAST(:response_payload AS jsonb))
                                ON CONFLICT (id) DO NOTHING
                            """),
                            {
                                "id": hist_id, "method": "POST", "endpoint": "/v1/chat/completions",
                                "model": model, "timestamp": time.strftime("%m/%d/%Y, %I:%M:%S %p"),
                                "duration": duration, "tokens": token_est,
                                "status": status_code, "status_text": "OK" if status_code == 200 else "Error",
                                "preview": preview,
                                "request_payload": json.dumps(req_payload),
                                "response_payload": json.dumps(res_payload),
                            }
                        )
                        await hist_session.commit()
                except Exception:
                    pass

        return StreamingResponse(stream_generator(), media_type="text/event-stream")

    else:
        # Non-streaming
        try:
            async with httpx.AsyncClient(timeout=300.0) as client:
                resp = await client.post(
                    f"{chat_url}/chat/completions",
                    json=body,
                    headers={"Content-Type": "application/json"},
                )
            elapsed_ms = int((time.time() - start_time) * 1000)

            if resp.status_code != 200:
                raise HTTPException(status_code=502, detail=f"vLLM returned {resp.status_code}: {resp.text}")

            data = resp.json()
            full_text = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            # Log to history
            hist_id = f"req_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
            preview = full_text[:150]
            duration = f"{elapsed_ms}ms" if elapsed_ms < 1000 else f"{elapsed_ms/1000:.1f}s"
            token_est = (len(resolved_prompt) + len(full_text)) // 4

            req_payload = {
                "messages": messages,
                "params": {k: v for k, v in body.items() if k != "messages"},
                "agent": {"id": agent_id, "name": agent_name},
                "variables": merged_vars,
            }
            if rag_enabled:
                req_payload["rag"] = {
                    "enabled": True, "topK": rag_top_k,
                    "threshold": rag_threshold, "sources": rag_sources,
                    "contextCount": rag_context_count,
                }
            res_payload = {"text": full_text[:50000], "truncated": len(full_text) > 50000}

            await session.execute(
                text("""
                    INSERT INTO request_history (id, method, endpoint, model, timestamp, duration, tokens, status, status_text, preview, request_payload, response_payload)
                    VALUES (:id, :method, :endpoint, :model, :timestamp, :duration, :tokens, :status, :status_text, :preview, CAST(:request_payload AS jsonb), CAST(:response_payload AS jsonb))
                    ON CONFLICT (id) DO NOTHING
                """),
                {
                    "id": hist_id, "method": "POST", "endpoint": "/v1/chat/completions",
                    "model": model, "timestamp": time.strftime("%m/%d/%Y, %I:%M:%S %p"),
                    "duration": duration, "tokens": token_est,
                    "status": resp.status_code, "status_text": "OK",
                    "preview": preview,
                    "request_payload": json.dumps(req_payload),
                    "response_payload": json.dumps(res_payload),
                }
            )
            await session.commit()

            return data

        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"Cannot reach vLLM: {str(e)}")
