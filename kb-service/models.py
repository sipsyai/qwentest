from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class DocumentInput(BaseModel):
    text: str
    embedding: list[float]
    source: str = "manual"
    source_label: str = ""


class DocumentsAddRequest(BaseModel):
    documents: list[DocumentInput]


class DocumentResponse(BaseModel):
    id: str
    text: str
    source: str
    source_label: str
    created_at: datetime


class DocumentsListResponse(BaseModel):
    data: list[DocumentResponse]
    total: int
    page: int
    limit: int


class BulkDeleteRequest(BaseModel):
    ids: list[str]


class BulkDeleteResponse(BaseModel):
    deleted: int


class SearchRequest(BaseModel):
    embedding: list[float]
    top_k: int = 5
    threshold: float = 0.3
    sources: Optional[list[str]] = None


class SearchResultItem(BaseModel):
    id: str
    text: str
    source: str
    source_label: str
    similarity: float
    created_at: datetime


class SearchResponse(BaseModel):
    results: list[SearchResultItem]
    search_time_ms: int


class StatsResponse(BaseModel):
    total: int
    sources: dict[str, int]
    source_labels: list[str]


class MessageResponse(BaseModel):
    message: str
    count: Optional[int] = None


# --- Settings Models ---

class SettingsResponse(BaseModel):
    settings: dict[str, str]


class SettingsUpdateRequest(BaseModel):
    settings: dict[str, str]


# --- History Models ---

class HistoryItemInput(BaseModel):
    id: str
    method: str
    endpoint: str
    model: str
    timestamp: str
    duration: str
    tokens: int = 0
    status: int
    status_text: str = ""
    preview: str = ""


class HistoryItemResponse(BaseModel):
    id: str
    method: str
    endpoint: str
    model: str
    timestamp: str
    duration: str
    tokens: int
    status: int
    status_text: str
    preview: str
    created_at: datetime


class HistoryListResponse(BaseModel):
    data: list[HistoryItemResponse]
    total: int
    page: int
    limit: int
