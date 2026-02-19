import json
import re
import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

import httpx
from fastapi import FastAPI, Depends, Query, HTTPException, Body
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
    AgentRunRequest, AgentToolInfo, AgentToolsResponse,
    WorkflowCreate, WorkflowUpdate, WorkflowResponse, WorkflowListResponse,
    WorkflowRunRequest,
)
from agent_executor import AgentExecutor
from tools import get_available_tool_names, TOOL_REGISTRY


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
    source: Optional[str] = Query(None),
    session: AsyncSession = Depends(get_session),
):
    where_clause = ""
    if source == "standalone":
        where_clause = "WHERE workflow_id IS NULL"
    elif source == "workflow":
        where_clause = "WHERE workflow_id IS NOT NULL"

    result = await session.execute(text(f"SELECT COUNT(*) FROM request_history {where_clause}"))
    total = result.scalar()

    offset = (page - 1) * limit
    result = await session.execute(
        text(f"""
            SELECT id, method, endpoint, model, timestamp, duration,
                   tokens, status, status_text, preview, created_at,
                   workflow_id, workflow_name, workflow_step
            FROM request_history
            {where_clause}
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
            workflow_id=row.workflow_id, workflow_name=row.workflow_name,
            workflow_step=row.workflow_step,
        )
        for row in rows
    ]
    return HistoryListResponse(data=data, total=total, page=page, limit=limit)


@app.post("/api/kb/history", response_model=MessageResponse)
async def add_history_item(item: HistoryItemInput, session: AsyncSession = Depends(get_session)):
    await session.execute(
        text("""
            INSERT INTO request_history (id, method, endpoint, model, timestamp, duration, tokens, status, status_text, preview, request_payload, response_payload, workflow_id, workflow_name, workflow_step)
            VALUES (:id, :method, :endpoint, :model, :timestamp, :duration, :tokens, :status, :status_text, :preview, CAST(:request_payload AS jsonb), CAST(:response_payload AS jsonb), :workflow_id, :workflow_name, :workflow_step)
            ON CONFLICT (id) DO NOTHING
        """),
        {
            "id": item.id, "method": item.method, "endpoint": item.endpoint,
            "model": item.model, "timestamp": item.timestamp, "duration": item.duration,
            "tokens": item.tokens, "status": item.status, "status_text": item.status_text,
            "preview": item.preview,
            "request_payload": json.dumps(item.request_payload) if item.request_payload else None,
            "response_payload": json.dumps(item.response_payload) if item.response_payload else None,
            "workflow_id": item.workflow_id, "workflow_name": item.workflow_name,
            "workflow_step": item.workflow_step,
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
                INSERT INTO request_history (id, method, endpoint, model, timestamp, duration, tokens, status, status_text, preview, request_payload, response_payload, workflow_id, workflow_name, workflow_step)
                VALUES (:id, :method, :endpoint, :model, :timestamp, :duration, :tokens, :status, :status_text, :preview, CAST(:request_payload AS jsonb), CAST(:response_payload AS jsonb), :workflow_id, :workflow_name, :workflow_step)
                ON CONFLICT (id) DO NOTHING
            """),
            {
                "id": item.id, "method": item.method, "endpoint": item.endpoint,
                "model": item.model, "timestamp": item.timestamp, "duration": item.duration,
                "tokens": item.tokens, "status": item.status, "status_text": item.status_text,
                "preview": item.preview,
                "request_payload": json.dumps(item.request_payload) if item.request_payload else None,
                "response_payload": json.dumps(item.response_payload) if item.response_payload else None,
                "workflow_id": item.workflow_id, "workflow_name": item.workflow_name,
                "workflow_step": item.workflow_step,
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
                   request_payload, response_payload,
                   workflow_id, workflow_name, workflow_step
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
        workflow_id=row.workflow_id, workflow_name=row.workflow_name,
        workflow_step=row.workflow_step,
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


@app.get("/api/kb/agents/tools", response_model=AgentToolsResponse)
async def list_available_tools():
    """Return all available tools that can be enabled for agents."""
    tools = []
    for name in get_available_tool_names():
        entry = TOOL_REGISTRY[name]
        desc = entry["schema"]["function"]["description"]
        tools.append(AgentToolInfo(name=name, description=desc))
    return AgentToolsResponse(tools=tools)


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


# ==================== Workflow Endpoints ====================


def _row_to_workflow_response(row) -> WorkflowResponse:
    steps = row.steps
    if isinstance(steps, str):
        try:
            steps = json.loads(steps)
        except Exception:
            steps = []
    return WorkflowResponse(
        id=str(row.id), name=row.name, description=row.description,
        steps=steps, created_at=row.created_at, updated_at=row.updated_at,
    )


@app.get("/api/kb/workflows", response_model=WorkflowListResponse)
async def list_workflows(session: AsyncSession = Depends(get_session)):
    result = await session.execute(text(
        "SELECT id, name, description, steps, created_at, updated_at "
        "FROM workflows ORDER BY updated_at DESC"
    ))
    rows = result.fetchall()
    data = [_row_to_workflow_response(row) for row in rows]
    return WorkflowListResponse(data=data, total=len(data))


@app.post("/api/kb/workflows", response_model=WorkflowResponse)
async def create_workflow(req: WorkflowCreate, session: AsyncSession = Depends(get_session)):
    wf_id = str(uuid.uuid4())
    await session.execute(
        text("""
            INSERT INTO workflows (id, name, description, steps)
            VALUES (:id, :name, :description, CAST(:steps AS jsonb))
        """),
        {"id": wf_id, "name": req.name, "description": req.description, "steps": json.dumps(req.steps)}
    )
    await session.commit()
    result = await session.execute(
        text("SELECT id, name, description, steps, created_at, updated_at FROM workflows WHERE id = :id"),
        {"id": wf_id}
    )
    return _row_to_workflow_response(result.fetchone())


@app.get("/api/kb/workflows/{wf_id}", response_model=WorkflowResponse)
async def get_workflow(wf_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        text("SELECT id, name, description, steps, created_at, updated_at FROM workflows WHERE id = :id"),
        {"id": wf_id}
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return _row_to_workflow_response(row)


@app.put("/api/kb/workflows/{wf_id}", response_model=WorkflowResponse)
async def update_workflow(wf_id: str, req: WorkflowUpdate, session: AsyncSession = Depends(get_session)):
    updates = {}
    params = {"id": wf_id}
    if req.name is not None:
        updates["name"] = "name = :name"
        params["name"] = req.name
    if req.description is not None:
        updates["description"] = "description = :description"
        params["description"] = req.description
    if req.steps is not None:
        updates["steps"] = "steps = CAST(:steps AS jsonb)"
        params["steps"] = json.dumps(req.steps)

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    set_clause = ", ".join(updates.values()) + ", updated_at = NOW()"
    result = await session.execute(
        text(f"UPDATE workflows SET {set_clause} WHERE id = :id"), params
    )
    await session.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Workflow not found")

    result = await session.execute(
        text("SELECT id, name, description, steps, created_at, updated_at FROM workflows WHERE id = :id"),
        {"id": wf_id}
    )
    return _row_to_workflow_response(result.fetchone())


@app.delete("/api/kb/workflows/{wf_id}", response_model=MessageResponse)
async def delete_workflow(wf_id: str, session: AsyncSession = Depends(get_session)):
    result = await session.execute(
        text("DELETE FROM workflows WHERE id = :id"), {"id": wf_id}
    )
    await session.commit()
    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Workflow not found")
    return MessageResponse(message="Workflow deleted")


@app.post("/api/kb/workflows/{wf_id}/run")
async def run_workflow(
    wf_id: str,
    req: WorkflowRunRequest = Body(default_factory=WorkflowRunRequest),
    session: AsyncSession = Depends(get_session),
):
    """Run a workflow: execute steps sequentially, piping outputs as variables."""
    # Load workflow
    result = await session.execute(
        text("SELECT id, name, steps FROM workflows WHERE id = :id"),
        {"id": wf_id}
    )
    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Workflow not found")

    steps = row.steps
    if isinstance(steps, str):
        steps = json.loads(steps)

    if not steps:
        raise HTTPException(status_code=400, detail="Workflow has no steps")

    # Resolve URLs once
    chat_url = await resolve_vllm_url(session, "forge_chat_url", "forge_chat_fallback_url", VLLM_CHAT_DEFAULT)
    embed_url = ""
    embed_model = ""
    try:
        embed_url = await resolve_vllm_url(session, "forge_embed_url", "forge_embed_fallback_url", VLLM_EMBED_DEFAULT)
        async with httpx.AsyncClient(timeout=10.0) as client:
            model_resp = await client.get(f"{embed_url}/models")
            model_data = model_resp.json()
            embed_model = model_data["data"][0]["id"] if model_data.get("data") else ""
    except Exception:
        pass

    async def workflow_generator():
        prev_output = ""
        step_outputs = {}  # step_id -> output
        wf_id = str(row.id)
        wf_name = row.name

        for idx, step in enumerate(steps):
            step_id = step.get("id", f"step_{idx}")
            agent_id = step.get("agentId", "")
            variable_mappings = step.get("variableMappings", {})
            step_start_time = time.time()

            if not agent_id:
                yield f"event: step_error\ndata: {json.dumps({'step_id': step_id, 'index': idx, 'error': 'No agent configured'})}\n\n"
                continue

            # Load agent
            agent_result = await session.execute(
                text("SELECT id, name, config FROM saved_agents WHERE id = :id"),
                {"id": agent_id}
            )
            agent_row = agent_result.fetchone()
            if not agent_row:
                yield f"event: step_error\ndata: {json.dumps({'step_id': step_id, 'index': idx, 'error': f'Agent {agent_id} not found'})}\n\n"
                continue

            config = agent_row.config
            if isinstance(config, str):
                config = json.loads(config)

            # Resolve variables: apply mappings
            resolved_vars = {}
            for var_name, mapping in variable_mappings.items():
                if mapping == "{{prev_output}}":
                    resolved_vars[var_name] = prev_output
                elif mapping.startswith("{{step:") and mapping.endswith("}}"):
                    # {{step:step_id}} -> output of a specific step
                    ref_id = mapping[7:-2]
                    resolved_vars[var_name] = step_outputs.get(ref_id, "")
                elif mapping.startswith("{{input:") and mapping.endswith("}}"):
                    # {{input:key}} -> runtime user-supplied variable
                    var_key = mapping[8:-2]
                    resolved_vars[var_name] = req.variables.get(var_key, "")
                else:
                    resolved_vars[var_name] = mapping  # literal value

            # Emit step start
            yield f"event: step_start\ndata: {json.dumps({'step_id': step_id, 'index': idx, 'agent_name': agent_row.name, 'agent_id': agent_id})}\n\n"

            # Create executor with workflow context
            executor = AgentExecutor(
                config=config,
                agent_id=str(agent_row.id),
                agent_name=agent_row.name,
                session=session,
                chat_url=chat_url,
                embed_url=embed_url,
                embed_model=embed_model,
                workflow_id=wf_id,
                workflow_name=wf_name,
                workflow_step=idx,
            )

            # Run and collect output
            step_text = ""
            step_status = 200
            try:
                async for event in executor.execute(resolved_vars, stream=True):
                    # Forward sub-events with step context
                    if event.startswith("event: "):
                        # Re-emit agentic events with step prefix
                        lines = event.strip().split("\n")
                        event_type = lines[0].replace("event: ", "")
                        data_line = lines[1] if len(lines) > 1 else ""
                        if data_line.startswith("data: "):
                            try:
                                payload = json.loads(data_line[6:])
                                payload["step_id"] = step_id
                                payload["step_index"] = idx
                                yield f"event: step_{event_type}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
                            except Exception:
                                yield event
                        else:
                            yield event
                    elif event.startswith("data: "):
                        payload_str = event[6:].strip().split("\n")[0]
                        if payload_str == "[DONE]":
                            continue
                        try:
                            chunk = json.loads(payload_str)
                            delta = chunk.get("choices", [{}])[0].get("delta", {}).get("content", "")
                            if delta:
                                step_text += delta
                                yield f"event: step_stream\ndata: {json.dumps({'step_id': step_id, 'index': idx, 'content': delta}, ensure_ascii=False)}\n\n"
                        except Exception:
                            pass
            except Exception as e:
                step_status = 500
                # Log error step to history
                try:
                    elapsed_ms = int((time.time() - step_start_time) * 1000)
                    async with async_session() as hist_session:
                        hist_id = f"req_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
                        duration = f"{elapsed_ms}ms" if elapsed_ms < 1000 else f"{elapsed_ms/1000:.1f}s"
                        model = config.get("selectedModel", "")
                        await hist_session.execute(
                            text("""
                                INSERT INTO request_history (
                                    id, method, endpoint, model, timestamp, duration,
                                    tokens, status, status_text, preview,
                                    request_payload, response_payload,
                                    workflow_id, workflow_name, workflow_step
                                ) VALUES (
                                    :id, :method, :endpoint, :model, :timestamp, :duration,
                                    :tokens, :status, :status_text, :preview,
                                    CAST(:request_payload AS jsonb), CAST(:response_payload AS jsonb),
                                    :workflow_id, :workflow_name, :workflow_step
                                ) ON CONFLICT (id) DO NOTHING
                            """),
                            {
                                "id": hist_id, "method": "POST", "endpoint": "/v1/chat/completions",
                                "model": model, "timestamp": time.strftime("%m/%d/%Y, %I:%M:%S %p"),
                                "duration": duration, "tokens": 0,
                                "status": 500, "status_text": "Error",
                                "preview": str(e)[:150],
                                "request_payload": json.dumps({"variables": resolved_vars, "agent": {"id": str(agent_row.id), "name": agent_row.name}}),
                                "response_payload": json.dumps({"text": str(e), "truncated": False}),
                                "workflow_id": wf_id, "workflow_name": wf_name, "workflow_step": idx,
                            }
                        )
                        await hist_session.commit()
                except Exception:
                    pass
                yield f"event: step_error\ndata: {json.dumps({'step_id': step_id, 'index': idx, 'error': str(e)})}\n\n"
                continue

            # Use executor's collected text if available
            final_text = executor.full_text or step_text
            prev_output = final_text
            step_outputs[step_id] = final_text

            # Log successful step to history
            try:
                elapsed_ms = int((time.time() - step_start_time) * 1000)
                async with async_session() as hist_session:
                    hist_id = f"req_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
                    preview = final_text[:150] if final_text else "(empty)"
                    duration = f"{elapsed_ms}ms" if elapsed_ms < 1000 else f"{elapsed_ms/1000:.1f}s"
                    model = config.get("selectedModel", "")
                    prompt_template = config.get("promptTemplate", "")
                    token_est = (len(prompt_template) + len(final_text)) // 4

                    req_payload, res_payload = executor.get_history_payload(resolved_vars)

                    await hist_session.execute(
                        text("""
                            INSERT INTO request_history (
                                id, method, endpoint, model, timestamp, duration,
                                tokens, status, status_text, preview,
                                request_payload, response_payload,
                                workflow_id, workflow_name, workflow_step
                            ) VALUES (
                                :id, :method, :endpoint, :model, :timestamp, :duration,
                                :tokens, :status, :status_text, :preview,
                                CAST(:request_payload AS jsonb), CAST(:response_payload AS jsonb),
                                :workflow_id, :workflow_name, :workflow_step
                            ) ON CONFLICT (id) DO NOTHING
                        """),
                        {
                            "id": hist_id, "method": "POST", "endpoint": "/v1/chat/completions",
                            "model": model, "timestamp": time.strftime("%m/%d/%Y, %I:%M:%S %p"),
                            "duration": duration, "tokens": token_est,
                            "status": step_status, "status_text": "OK",
                            "preview": preview,
                            "request_payload": json.dumps(req_payload),
                            "response_payload": json.dumps(res_payload),
                            "workflow_id": wf_id, "workflow_name": wf_name, "workflow_step": idx,
                        }
                    )
                    await hist_session.commit()
            except Exception:
                pass

            yield f"event: step_done\ndata: {json.dumps({'step_id': step_id, 'index': idx, 'output_preview': final_text, 'output_length': len(final_text)})}\n\n"

        # All steps done
        yield f"event: workflow_done\ndata: {json.dumps({'total_steps': len(steps), 'step_outputs': {k: v[:200] for k, v in step_outputs.items()}})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(workflow_generator(), media_type="text/event-stream")


# ==================== Agent Run Helpers ====================

VLLM_CHAT_DEFAULT = "http://192.168.1.8:8010/v1"
VLLM_EMBED_DEFAULT = "http://192.168.1.8:8011/v1"


async def resolve_vllm_url(session: AsyncSession, setting_key: str, fallback_key: str, default: str) -> str:
    """Resolve a vLLM URL from settings, skipping proxy paths (start with /)."""
    result = await session.execute(
        text("SELECT key, value FROM app_settings WHERE key IN (:k1, :k2)"),
        {"k1": setting_key, "k2": fallback_key}
    )
    settings = {row.key: row.value for row in result.fetchall()}
    primary = settings.get(setting_key, "")
    fallback = settings.get(fallback_key, "")
    if primary and not primary.startswith("/"):
        return primary
    if fallback and not fallback.startswith("/"):
        return fallback
    return default


# ==================== Agent Run Endpoint (Agentic) ====================


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
    model = config.get("selectedModel", "")
    prompt_template = config.get("promptTemplate", "")

    if not model:
        raise HTTPException(status_code=400, detail="Agent has no model configured")
    if not prompt_template:
        raise HTTPException(status_code=400, detail="Agent has no promptTemplate configured")

    use_stream = req.stream if req.stream is not None else config.get("stream", True)

    # 2. Resolve URLs
    chat_url = await resolve_vllm_url(session, "forge_chat_url", "forge_chat_fallback_url", VLLM_CHAT_DEFAULT)

    # Resolve embed URL/model for RAG and kb_search tool
    embed_url = ""
    embed_model = ""
    if config.get("ragEnabled") or "kb_search" in config.get("enabledTools", []):
        try:
            embed_url = await resolve_vllm_url(session, "forge_embed_url", "forge_embed_fallback_url", VLLM_EMBED_DEFAULT)
            async with httpx.AsyncClient(timeout=10.0) as client:
                model_resp = await client.get(f"{embed_url}/models")
                model_data = model_resp.json()
                embed_model = model_data["data"][0]["id"] if model_data.get("data") else ""
        except Exception:
            pass

    # 3. Merge variables
    config_variables = config.get("variables", [])
    merged_vars = {}
    for v in config_variables:
        name = v.get("name", "")
        if name:
            merged_vars[name] = v.get("defaultValue", "")
    merged_vars.update(req.variables)

    # 4. Create executor
    executor = AgentExecutor(
        config=config,
        agent_id=agent_id,
        agent_name=agent_name,
        session=session,
        chat_url=chat_url,
        embed_url=embed_url,
        embed_model=embed_model,
    )

    start_time = time.time()

    # 5. Execute with streaming
    async def stream_generator():
        status_code = 200
        try:
            async for event in executor.execute(merged_vars, stream=use_stream):
                yield event
        except Exception as e:
            status_code = 500
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        finally:
            # Log to history
            elapsed_ms = int((time.time() - start_time) * 1000)
            try:
                async with async_session() as hist_session:
                    hist_id = f"req_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
                    preview = executor.full_text[:150] if executor.full_text else "Error"
                    duration = f"{elapsed_ms}ms" if elapsed_ms < 1000 else f"{elapsed_ms/1000:.1f}s"
                    token_est = (len(prompt_template) + len(executor.full_text)) // 4

                    req_payload, res_payload = executor.get_history_payload(merged_vars)

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
