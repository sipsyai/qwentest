from pydantic import BaseModel, Field
from typing import Optional, Any
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
    request_payload: Optional[dict] = None
    response_payload: Optional[dict] = None


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


class HistoryItemDetailResponse(HistoryItemResponse):
    request_payload: Optional[dict] = None
    response_payload: Optional[dict] = None


class HistoryListResponse(BaseModel):
    data: list[HistoryItemResponse]
    total: int
    page: int
    limit: int


# --- Dataset Models ---

class DatasetCreate(BaseModel):
    name: str
    url: str = ""
    method: str = "GET"
    token: str = ""
    headers: dict = {}
    array_path: str = ""
    extract_fields: list = []
    raw_data: Optional[Any] = None


class DatasetUpdate(BaseModel):
    name: Optional[str] = None
    url: Optional[str] = None
    method: Optional[str] = None
    token: Optional[str] = None
    headers: Optional[dict] = None
    array_path: Optional[str] = None
    extract_fields: Optional[list] = None
    raw_data: Optional[Any] = None


class DatasetResponse(BaseModel):
    id: str
    name: str
    url: str
    method: str
    token: str
    headers: dict
    array_path: str
    extract_fields: list
    raw_data: Optional[Any] = None
    created_at: datetime
    updated_at: datetime


class DatasetListResponse(BaseModel):
    data: list[DatasetResponse]
    total: int


class DatasetFetchRequest(BaseModel):
    body: Optional[dict] = None


class DatasetFetchResponse(BaseModel):
    status: int
    data: Any
    elapsed_ms: int


# --- Dataset Records Models ---

class DatasetRecordCreate(BaseModel):
    dataset_id: str
    data: dict
    json_path: str = "$"
    label: str = ""


class DatasetRecordBulkCreate(BaseModel):
    records: list[DatasetRecordCreate]


class DatasetRecordResponse(BaseModel):
    id: str
    dataset_id: str
    data: dict
    json_path: str
    label: str
    created_at: datetime


class DatasetRecordListResponse(BaseModel):
    data: list[DatasetRecordResponse]
    total: int
    page: int
    limit: int


# --- Agent Models ---

class AgentCreate(BaseModel):
    name: str
    description: str = ""
    config: dict


class AgentUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    config: Optional[dict] = None


class AgentResponse(BaseModel):
    id: str
    name: str
    description: str
    config: dict
    created_at: datetime
    updated_at: datetime


class AgentListResponse(BaseModel):
    data: list[AgentResponse]
    total: int


class AgentRunRequest(BaseModel):
    variables: dict[str, str] = {}
    stream: Optional[bool] = None  # None = use agent config default


class AgentToolInfo(BaseModel):
    name: str
    description: str


class AgentToolsResponse(BaseModel):
    tools: list[AgentToolInfo]


# --- Workflow Models ---

class WorkflowCreate(BaseModel):
    name: str
    description: str = ""
    steps: list = []


class WorkflowUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    steps: Optional[list] = None


class WorkflowResponse(BaseModel):
    id: str
    name: str
    description: str
    steps: list
    created_at: datetime
    updated_at: datetime


class WorkflowListResponse(BaseModel):
    data: list[WorkflowResponse]
    total: int
