import time
import uuid
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Depends, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text, func
from sqlalchemy.ext.asyncio import AsyncSession

from database import init_db, get_session
from models import (
    DocumentsAddRequest, DocumentResponse, DocumentsListResponse,
    BulkDeleteRequest, BulkDeleteResponse,
    SearchRequest, SearchResponse, SearchResultItem,
    StatsResponse, MessageResponse,
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
    """
    await session.execute(text(query), params)
    await session.commit()

    return MessageResponse(message=f"Added {len(req.documents)} documents", count=len(req.documents))


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
