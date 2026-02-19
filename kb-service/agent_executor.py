"""
AgentExecutor - ReAct (Reasoning + Acting) loop for agentic agent execution.

Supports:
- Tool calling via vLLM (Qwen3 tool_calling)
- Multi-iteration reasoning loop
- SSE event streaming (thinking, tool_call, tool_result, stream, done, error)
- RAG integration (pre-loop context injection)
- Sub-agent delegation with depth limits
- Simple mode fallback for non-agentic agents
"""

import json
import logging
import time
import uuid
import httpx
from typing import AsyncGenerator

from sqlalchemy import text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

import re

logger = logging.getLogger("agent_executor")

from tools import get_tool_schemas, get_tool_handler


# Module-level compiled regex and reserved variable names
_VARIABLE_PATTERN = re.compile(r'\{\{(\w+)\}\}')
_RESERVED_VARS = {"context"}

# Turkish synonym expansion for BM25 keyword search
_TURKISH_SYNONYMS = {
    "sifre": ["parola", "password", "sifirlama"],
    "vpn": ["uzak erisim", "remote"],
    "yazici": ["printer", "baski", "yazdirma"],
    "laptop": ["dizustu", "notebook"],
    "toner": ["kartus", "sarf malzeme"],
    "phishing": ["oltalama", "sahte mail"],
    "firewall": ["guvenlik duvari"],
    "egitim": ["training", "farkindalik"],
    "yedek": ["backup", "yedekleme"],
    "kamera": ["webcam", "video konferans"],
    "crm": ["musteri iliskileri"],
    "offboarding": ["ayrilan calisan", "hesap kapatma"],
    "onboarding": ["yeni calisan", "hesap acma"],
    "mfa": ["iki faktor", "two factor", "dogrulama"],
    "hesap": ["kullanici", "account"],
    "erisim": ["access", "yetki", "izin"],
    "mail": ["eposta", "e-posta", "outlook"],
    "disk": ["depolama", "storage", "alan"],
    "lisans": ["license", "yazilim"],
}


def _expand_query_with_synonyms(query_text: str) -> str:
    """Expand a query string with Turkish synonyms for better BM25 recall."""
    words = [w.strip().lower() for w in query_text.split() if len(w.strip()) >= 2]
    expanded = list(words)
    for word in words:
        if word in _TURKISH_SYNONYMS:
            for syn in _TURKISH_SYNONYMS[word]:
                # Split multi-word synonyms into individual tokens
                expanded.extend(syn.split())
        # Also check if any synonym key contains the word
        for key, syns in _TURKISH_SYNONYMS.items():
            if key != word and word in key:
                expanded.append(key)
                expanded.extend(s for syn in syns for s in syn.split())
    return " ".join(set(expanded))


# SSE event helpers

def sse_event(event_type: str, data: dict) -> str:
    """Format an SSE event with event type and JSON data."""
    return f"event: {event_type}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def sse_data(data: dict) -> str:
    """Format a standard SSE data line (for backward compat with stream chunks)."""
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


def sse_done() -> str:
    return "data: [DONE]\n\n"


class AgentExecutor:
    """
    Executes an agent in ReAct mode with tool calling.

    Modes:
    - 'simple': Single LLM call, no tools (backward compatible)
    - 'react': ReAct loop with tool calling
    - 'plan-execute': Plan first, then execute steps (future)
    """

    def __init__(
        self,
        config: dict,
        agent_id: str,
        agent_name: str,
        session: AsyncSession,
        chat_url: str,
        embed_url: str = "",
        embed_model: str = "",
        depth: int = 0,
        workflow_id: str = "",
        workflow_name: str = "",
        workflow_step: int = -1,
    ):
        self.config = config
        self.agent_id = agent_id
        self.agent_name = agent_name
        self.session = session
        self.chat_url = chat_url
        self.embed_url = embed_url
        self.embed_model = embed_model
        self.depth = depth
        self.workflow_id = workflow_id
        self.workflow_name = workflow_name
        self.workflow_step = workflow_step

        # Extract config
        self.model = config.get("selectedModel", "")
        self.system_prompt = config.get("systemPrompt", "")
        self.prompt_template = config.get("promptTemplate", "")
        self.thinking = config.get("thinking", False)
        self.json_mode = config.get("jsonMode", False)
        self.temperature = config.get("temperature", 0.7)
        self.top_p = config.get("topP", 0.9)
        self.top_k_param = config.get("topK", 0)
        self.max_tokens = config.get("maxTokens", 2048)
        self.presence_penalty = config.get("presencePenalty", 0)
        self.frequency_penalty = config.get("frequencyPenalty", 0)
        self.repetition_penalty = config.get("repetitionPenalty", 1.0)
        self.seed_str = config.get("seed", "")
        self.stop_sequences = config.get("stopSequences", "")

        # Agentic config
        self.agent_mode = config.get("agentMode", "simple")
        self.enabled_tools = config.get("enabledTools", [])
        self.max_iterations = config.get("maxIterations", 10)

        # RAG config
        self.rag_enabled = config.get("ragEnabled", False)
        self.rag_top_k = config.get("ragTopK", 3)
        self.rag_threshold = config.get("ragThreshold", 0.3)
        self.rag_sources = config.get("ragSources", [])
        self.rag_source_aliases = config.get("ragSourceAliases", {})
        self.rag_source_config = config.get("ragSourceConfig", {})
        self.rag_debug = {}  # Populated during _resolve_rag for history

        # Per-instance reserved vars: "context" + all alias values
        self._rag_vars: set = set()
        if self.rag_enabled:
            self._rag_vars.add("context")
            for source in self.rag_sources:
                alias = self.rag_source_aliases.get(source) or self._source_to_var(source)
                self._rag_vars.add(alias)

        # Guard: thinking + jsonMode conflict — thinking tags break JSON output
        if self.json_mode and self.thinking:
            self.thinking = False

        # Runtime state
        self.messages = []
        self.full_text = ""
        self.tool_calls_made = []
        self.iterations_used = 0
        self.start_time = 0

    def _resolve_template(self, template: str, vars_dict: dict) -> str:
        """Resolve {{variable}} placeholders in a template string.

        Reserved vars (e.g. {{context}}) are preserved for RAG injection UNLESS
        they are explicitly provided in vars_dict (e.g. injected by a workflow step).
        """
        def replacer(m):
            name = m.group(1)
            if name in (_RESERVED_VARS | self._rag_vars) and name not in vars_dict:
                return m.group(0)
            return vars_dict.get(name, "")
        return _VARIABLE_PATTERN.sub(replacer, template)

    @staticmethod
    def _source_to_var(source: str) -> str:
        """'ITSM Knowledge Base' → 'itsm_knowledge_base'"""
        return re.sub(r'[^a-z0-9]+', '_', source.lower()).strip('_')

    def _build_base_body(self, stream: bool = False) -> dict:
        """Build the base vLLM request body (without messages/tools)."""
        body = {
            "model": self.model,
            "temperature": self.temperature,
            "top_p": self.top_p,
            "max_tokens": self.max_tokens,
            "stream": stream,
        }
        if self.top_k_param > 0:
            body["top_k"] = self.top_k_param
        if self.presence_penalty != 0:
            body["presence_penalty"] = self.presence_penalty
        if self.frequency_penalty != 0:
            body["frequency_penalty"] = self.frequency_penalty
        if self.repetition_penalty != 1.0:
            body["repetition_penalty"] = self.repetition_penalty
        if self.seed_str:
            try:
                body["seed"] = int(self.seed_str)
            except ValueError:
                pass
        if self.stop_sequences:
            stops = [s.strip() for s in self.stop_sequences.split(",") if s.strip()]
            if stops:
                body["stop"] = stops
        if self.json_mode:
            body["response_format"] = {"type": "json_object"}
        body["chat_template_kwargs"] = {"enable_thinking": self.thinking}
        return body

    def _get_tool_context(self) -> dict:
        """Build the context dict passed to tool handlers."""
        return {
            "session": self.session,
            "embed_url": self.embed_url,
            "embed_model": self.embed_model,
            "depth": self.depth,
            "run_agent_func": self._run_sub_agent,
        }

    async def _run_sub_agent(self, agent_id: str, variables: dict, depth: int, parent_session=None) -> str:
        """Internal: run a sub-agent synchronously (non-streaming) and return its text output."""
        from database import async_session as get_async_session

        sess = parent_session or self.session

        # Load sub-agent
        result = await sess.execute(
            sql_text("SELECT id, name, config FROM saved_agents WHERE id = :id"),
            {"id": agent_id}
        )
        row = result.fetchone()
        if not row:
            return f"Error: Sub-agent {agent_id} not found"

        sub_config = row.config
        if isinstance(sub_config, str):
            sub_config = json.loads(sub_config)

        # Force simple mode for sub-agents to prevent deep recursion with tools
        sub_executor = AgentExecutor(
            config=sub_config,
            agent_id=str(row.id),
            agent_name=row.name,
            session=sess,
            chat_url=self.chat_url,
            embed_url=self.embed_url,
            embed_model=self.embed_model,
            depth=depth,
        )

        # Run non-streaming and collect text
        collected = ""
        async for event in sub_executor.execute_simple(variables, stream=False):
            # event is an SSE string; parse it to get content
            if event.startswith("data: ") and "[DONE]" not in event:
                try:
                    payload = json.loads(event[6:].strip())
                    content = payload.get("choices", [{}])[0].get("message", {}).get("content", "")
                    if content:
                        collected = content
                except Exception:
                    pass
            elif event.startswith("event: final_answer"):
                # Extract from next data line
                pass

        return collected or sub_executor.full_text or "(Sub-agent returned no output)"

    async def _call_llm(self, messages: list, tools: list | None = None, stream: bool = False) -> dict | AsyncGenerator:
        """Make a single LLM call. Returns full response dict for non-streaming."""
        body = self._build_base_body(stream=stream)
        body["messages"] = messages
        if tools:
            body["tools"] = tools
            body["tool_choice"] = "auto"

        async with httpx.AsyncClient(timeout=300.0) as client:
            if stream:
                return client.stream(
                    "POST",
                    f"{self.chat_url}/chat/completions",
                    json=body,
                    headers={"Content-Type": "application/json"},
                )
            else:
                resp = await client.post(
                    f"{self.chat_url}/chat/completions",
                    json=body,
                    headers={"Content-Type": "application/json"},
                )
                if resp.status_code != 200:
                    raise Exception(f"vLLM returned {resp.status_code}: {resp.text}")
                return resp.json()

    async def _check_tsvector_exists(self) -> bool:
        """Check if search_vector column exists in kb_documents (for backward compat)."""
        try:
            result = await self.session.execute(sql_text(
                "SELECT 1 FROM information_schema.columns "
                "WHERE table_name = 'kb_documents' AND column_name = 'search_vector' LIMIT 1"
            ))
            return result.fetchone() is not None
        except Exception:
            return False

    async def _hybrid_search(
        self,
        embedding_str: str,
        source_label: str,
        threshold: float,
        top_k: int,
        query_text: str,
        use_bm25: bool = True,
    ) -> list:
        """Hybrid: vector cosine + BM25 keyword, merged via Reciprocal Rank Fusion.

        Falls back to pure semantic search if use_bm25=False or tsquery is empty.
        """
        # Build expanded keyword query
        expanded = _expand_query_with_synonyms(query_text)
        # Sanitize: only keep alphanumeric + Turkish chars, strip punctuation
        sanitize_re = re.compile(r'[^a-zA-Z0-9çğıöşüÇĞİÖŞÜ]')
        words = [sanitize_re.sub('', w).strip() for w in expanded.split()]
        words = [w for w in words if len(w) >= 2]
        # Deduplicate while preserving order
        seen = set()
        unique_words = []
        for w in words:
            wl = w.lower()
            if wl not in seen:
                seen.add(wl)
                unique_words.append(wl)
        ts_query_str = " | ".join(unique_words) if unique_words else ""

        fetch_limit = top_k * 3  # Over-fetch for better RRF fusion

        if use_bm25 and ts_query_str:
            sql = sql_text("""
                WITH semantic AS (
                    SELECT id, text, source_label,
                           1 - (embedding <=> CAST(:embedding AS vector)) AS similarity,
                           ROW_NUMBER() OVER (ORDER BY embedding <=> CAST(:embedding AS vector)) AS sem_rank
                    FROM kb_documents
                    WHERE source_label = :source
                      AND 1 - (embedding <=> CAST(:embedding AS vector)) >= :threshold
                    LIMIT :fetch_limit
                ),
                keyword AS (
                    SELECT id, text, source_label,
                           ts_rank(search_vector, to_tsquery('simple', :tsquery)) AS kw_score,
                           ROW_NUMBER() OVER (ORDER BY ts_rank(search_vector, to_tsquery('simple', :tsquery)) DESC) AS kw_rank
                    FROM kb_documents
                    WHERE source_label = :source
                      AND search_vector @@ to_tsquery('simple', :tsquery)
                    LIMIT :fetch_limit
                ),
                combined AS (
                    SELECT COALESCE(s.id, k.id) AS id,
                           COALESCE(s.text, k.text) AS text,
                           COALESCE(s.source_label, k.source_label) AS source_label,
                           COALESCE(s.similarity, 0) AS similarity,
                           COALESCE(k.kw_score, 0) AS kw_score,
                           COALESCE(1.0/(60 + s.sem_rank), 0) + COALESCE(1.0/(60 + k.kw_rank), 0) AS rrf_score
                    FROM semantic s FULL OUTER JOIN keyword k ON s.id = k.id
                )
                SELECT text, source_label, similarity, kw_score, rrf_score
                FROM combined ORDER BY rrf_score DESC LIMIT :top_k
            """)
            params = {
                "embedding": embedding_str,
                "source": source_label,
                "threshold": threshold,
                "tsquery": ts_query_str,
                "fetch_limit": fetch_limit,
                "top_k": top_k,
            }
        else:
            # Pure semantic fallback
            source_filter = "AND source_label = :source" if source_label else ""
            sql = sql_text(f"""
                SELECT text, source_label,
                       1 - (embedding <=> CAST(:embedding AS vector)) AS similarity,
                       0.0 AS kw_score,
                       0.0 AS rrf_score
                FROM kb_documents
                WHERE 1 - (embedding <=> CAST(:embedding AS vector)) >= :threshold
                {source_filter}
                ORDER BY similarity DESC
                LIMIT :top_k
            """)
            params = {
                "embedding": embedding_str,
                "threshold": threshold,
                "top_k": top_k,
            }
            if source_label:
                params["source"] = source_label

        result = await self.session.execute(sql, params)
        return result.fetchall()

    async def _resolve_rag(self, resolved_prompt: str, resolved_system: str, variables: dict | None = None) -> tuple[str, str, int]:
        """Apply RAG context injection if enabled. Returns (prompt, system, context_count).

        Uses variable values as the embedding query instead of the full prompt.
        This prevents instruction text from biasing the semantic search results.

        When multiple sources are specified, performs per-source queries with a minimum
        quota per source (at least 2 slots each) so that lower-similarity sources like
        form templates are never entirely pushed out by higher-similarity KB articles.
        """
        if not self.rag_enabled or not self.embed_url or not self.embed_model:
            return resolved_prompt, resolved_system, 0

        try:
            # Build semantic query from variable values only (not the full prompt)
            rag_query = ""
            if variables:
                var_values = [str(v) for v in variables.values() if v]
                rag_query = " ".join(var_values)
            if not rag_query.strip():
                rag_query = resolved_prompt

            # Embed the semantic query
            async with httpx.AsyncClient(timeout=30.0) as client:
                embed_resp = await client.post(
                    f"{self.embed_url}/embeddings",
                    json={"model": self.embed_model, "input": rag_query}
                )
                embed_data = embed_resp.json()
                query_embedding = embed_data["data"][0]["embedding"]

            embedding_str = "[" + ",".join(str(v) for v in query_embedding) + "]"

            # Check if hybrid search (BM25) is available
            has_tsvector = await self._check_tsvector_exists()

            # Per-source hybrid search with configurable quotas via ragSourceConfig
            #
            # Each source gets independent topK and threshold from ragSourceConfig.
            # Default: primary source gets bulk of slots, secondary sources get 3 each.
            # Hybrid search (vector + BM25 keyword) is used when tsvector column exists.
            per_source_rows: dict = {}  # source_label → rows
            seen_texts: set = set()
            search_rows = []

            if self.rag_sources:
                n_sources = len(self.rag_sources)
                n_secondary = max(0, n_sources - 1)
                default_secondary_k = 3
                default_primary_k = max(1, self.rag_top_k - default_secondary_k * n_secondary)

                for src_idx, source in enumerate(self.rag_sources):
                    src_cfg = self.rag_source_config.get(source, {})
                    if src_idx == 0:
                        src_top_k = src_cfg.get("topK", default_primary_k)
                    else:
                        src_top_k = src_cfg.get("topK", default_secondary_k)
                    src_threshold = src_cfg.get("threshold", self.rag_threshold if src_idx == 0 else max(0.15, self.rag_threshold - 0.15))

                    try:
                        rows = await self._hybrid_search(
                            embedding_str, source, src_threshold, src_top_k,
                            rag_query, use_bm25=has_tsvector,
                        )
                    except Exception as src_err:
                        logger.warning("Hybrid search failed for source=%s, falling back to semantic: %s", source, src_err)
                        try:
                            await self.session.rollback()
                        except Exception:
                            pass
                        # Fallback to pure semantic for this source
                        try:
                            rows = await self._hybrid_search(
                                embedding_str, source, src_threshold, src_top_k,
                                rag_query, use_bm25=False,
                            )
                        except Exception:
                            rows = []

                    # Dedup across sources
                    deduped = []
                    for row in rows:
                        key = row.text[:80]
                        if key not in seen_texts:
                            seen_texts.add(key)
                            deduped.append(row)
                    per_source_rows[source] = deduped

                    # Capture debug info for this source
                    self.rag_debug[source] = {
                        "count": len(deduped),
                        "top_k": src_top_k,
                        "threshold": src_threshold,
                        "hybrid": has_tsvector,
                        "top_results": [
                            {
                                "text_preview": r.text[:100],
                                "similarity": round(float(r.similarity), 4),
                                "kw_score": round(float(getattr(r, 'kw_score', 0)), 4),
                                "rrf_score": round(float(getattr(r, 'rrf_score', 0)), 4),
                            }
                            for r in deduped[:5]
                        ],
                    }

                    search_rows.extend(deduped)

                # Final cap at rag_top_k
                search_rows = search_rows[:self.rag_top_k]
            else:
                # No sources configured — use threshold-only search
                rows = await self._hybrid_search(
                    embedding_str, "", self.rag_threshold, self.rag_top_k,
                    rag_query, use_bm25=False,
                )
                search_rows = list(rows)

            if search_rows:
                count = len(search_rows)

                # 1. Per-source injection: each source's rows into its alias placeholder
                per_source_injected = False
                for source in self.rag_sources:
                    alias = self.rag_source_aliases.get(source) or self._source_to_var(source)
                    rows = per_source_rows.get(source, [])
                    placeholder = "{{" + alias + "}}"
                    if rows:
                        source_text = "\n\n---\n\n".join(r.text for r in rows)
                        if placeholder in resolved_prompt:
                            resolved_prompt = resolved_prompt.replace(placeholder, source_text)
                            per_source_injected = True
                        elif placeholder in resolved_system:
                            resolved_system = resolved_system.replace(placeholder, source_text)
                            per_source_injected = True
                    # Clean up unfilled alias placeholders
                    resolved_prompt = resolved_prompt.replace(placeholder, "")
                    resolved_system = resolved_system.replace(placeholder, "")

                # 2. {{context}} catch-all (backward compat — combined results)
                context_text = "\n\n---\n\n".join(r.text for r in search_rows)
                if "{{context}}" in resolved_prompt:
                    resolved_prompt = resolved_prompt.replace("{{context}}", context_text)
                elif "{{context}}" in resolved_system:
                    resolved_system = resolved_system.replace("{{context}}", context_text)
                elif not per_source_injected:
                    # Auto-inject only when no per-source injection was done
                    resolved_system += f"\n\n[Retrieved Context]\n{context_text}"

                return resolved_prompt, resolved_system, count
            else:
                # No results — clean up all RAG placeholders
                for source in self.rag_sources:
                    alias = self.rag_source_aliases.get(source) or self._source_to_var(source)
                    placeholder = "{{" + alias + "}}"
                    resolved_prompt = resolved_prompt.replace(placeholder, "")
                    resolved_system = resolved_system.replace(placeholder, "")
                resolved_prompt = resolved_prompt.replace("{{context}}", "")
                resolved_system = resolved_system.replace("{{context}}", "")

        except Exception as e:
            logger.error("RAG failed for agent=%s: %s", self.agent_name, e, exc_info=True)
            # Rollback failed transaction so session stays usable
            try:
                await self.session.rollback()
            except Exception:
                pass
            # Clean up placeholders on error too
            for source in self.rag_sources:
                alias = self.rag_source_aliases.get(source) or self._source_to_var(source)
                placeholder = "{{" + alias + "}}"
                resolved_prompt = resolved_prompt.replace(placeholder, "")
                resolved_system = resolved_system.replace(placeholder, "")
            resolved_prompt = resolved_prompt.replace("{{context}}", "")
            resolved_system = resolved_system.replace("{{context}}", "")

        return resolved_prompt, resolved_system, 0

    async def execute_simple(
        self,
        variables: dict,
        stream: bool = True,
    ) -> AsyncGenerator[str, None]:
        """
        Simple mode: single LLM call with streaming (backward compatible).
        Yields SSE strings.
        """
        # Merge variables
        config_vars = self.config.get("variables", [])
        merged = {}
        for v in config_vars:
            name = v.get("name", "")
            if name:
                merged[name] = v.get("defaultValue", "")
        merged.update(variables)

        resolved_prompt = self._resolve_template(self.prompt_template, merged)
        resolved_system = self._resolve_template(self.system_prompt, merged)

        # RAG — pass variables for semantic query extraction
        resolved_prompt, resolved_system, rag_count = await self._resolve_rag(resolved_prompt, resolved_system, merged)

        # Build messages
        self.messages = []
        if resolved_system.strip():
            self.messages.append({"role": "system", "content": resolved_system})
        self.messages.append({"role": "user", "content": resolved_prompt})

        self.start_time = time.time()

        if stream:
            body = self._build_base_body(stream=True)
            body["messages"] = self.messages

            try:
                async with httpx.AsyncClient(timeout=300.0) as client:
                    async with client.stream(
                        "POST", f"{self.chat_url}/chat/completions",
                        json=body, headers={"Content-Type": "application/json"},
                    ) as resp:
                        if resp.status_code != 200:
                            error_body = await resp.aread()
                            yield sse_data({"error": error_body.decode()})
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
                                        self.full_text += delta
                                except Exception:
                                    pass
            except httpx.RequestError as e:
                yield sse_data({"error": str(e)})
        else:
            try:
                data = await self._call_llm(self.messages, stream=False)
                self.full_text = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                yield sse_data(data)
            except Exception as e:
                yield sse_data({"error": str(e)})

    async def execute_react(
        self,
        variables: dict,
    ) -> AsyncGenerator[str, None]:
        """
        ReAct mode: iterative reasoning + tool calling loop.
        Yields SSE events with typed events (thinking, tool_call, tool_result, stream, done, error).
        """
        # Merge variables
        config_vars = self.config.get("variables", [])
        merged = {}
        for v in config_vars:
            name = v.get("name", "")
            if name:
                merged[name] = v.get("defaultValue", "")
        merged.update(variables)

        resolved_prompt = self._resolve_template(self.prompt_template, merged)
        resolved_system = self._resolve_template(self.system_prompt, merged)

        # RAG (pre-loop) — pass variables for semantic query extraction
        resolved_prompt, resolved_system, rag_count = await self._resolve_rag(resolved_prompt, resolved_system, merged)

        # Prepare tool schemas
        tool_schemas = get_tool_schemas(self.enabled_tools) if self.enabled_tools else []
        tool_context = self._get_tool_context()

        # Build initial messages
        agentic_system = resolved_system
        if tool_schemas:
            agentic_system += (
                "\n\nYou have access to tools. Use them when you need external information or actions. "
                "When you have enough information to answer, respond directly without calling tools. "
                "Think step by step about what information you need and which tools to use."
            )

        self.messages = []
        if agentic_system.strip():
            self.messages.append({"role": "system", "content": agentic_system})
        self.messages.append({"role": "user", "content": resolved_prompt})

        self.start_time = time.time()

        # Emit start event
        yield sse_event("agent_start", {
            "mode": "react",
            "max_iterations": self.max_iterations,
            "tools": self.enabled_tools,
        })

        # ReAct Loop
        for iteration in range(self.max_iterations):
            self.iterations_used = iteration + 1

            yield sse_event("iteration_start", {"iteration": iteration + 1})

            # Call LLM with tools (non-streaming for tool detection)
            try:
                response = await self._call_llm(
                    self.messages,
                    tools=tool_schemas if tool_schemas else None,
                    stream=False,
                )
            except Exception as e:
                yield sse_event("error", {"message": str(e), "iteration": iteration + 1})
                return

            choice = response.get("choices", [{}])[0]
            message = choice.get("message", {})
            finish_reason = choice.get("finish_reason", "")

            # Check for tool calls
            tool_calls = message.get("tool_calls", [])

            if tool_calls:
                # Agent wants to use tools
                # Add assistant message with tool calls to history
                self.messages.append(message)

                for tc in tool_calls:
                    func = tc.get("function", {})
                    tool_name = func.get("name", "")
                    tool_args_str = func.get("arguments", "{}")
                    tool_call_id = tc.get("id", f"call_{uuid.uuid4().hex[:8]}")

                    try:
                        tool_args = json.loads(tool_args_str) if isinstance(tool_args_str, str) else tool_args_str
                    except json.JSONDecodeError:
                        tool_args = {}

                    # Emit tool_call event
                    yield sse_event("tool_call", {
                        "iteration": iteration + 1,
                        "tool": tool_name,
                        "args": tool_args,
                        "call_id": tool_call_id,
                    })

                    # Execute tool
                    handler = get_tool_handler(tool_name)
                    if handler:
                        try:
                            result = await handler(tool_args, tool_context)
                        except Exception as e:
                            result = f"Tool execution error: {str(e)}"
                    else:
                        result = f"Unknown tool: {tool_name}"

                    self.tool_calls_made.append({
                        "tool": tool_name,
                        "args": tool_args,
                        "result": result[:500],
                        "iteration": iteration + 1,
                    })

                    # Emit tool_result event
                    yield sse_event("tool_result", {
                        "iteration": iteration + 1,
                        "tool": tool_name,
                        "call_id": tool_call_id,
                        "result": result[:2000],  # truncate for SSE
                    })

                    # Add tool result to messages
                    self.messages.append({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": result,
                    })

                # Continue loop for next iteration
                continue

            else:
                # No tool calls - this is the final answer
                content = message.get("content", "")
                self.full_text = content

                yield sse_event("final_answer_start", {"iteration": iteration + 1})

                # Emit existing content directly — no second LLM call
                if content:
                    yield sse_event("stream", {"content": content})

                # Done
                yield sse_event("agent_done", {
                    "iterations": iteration + 1,
                    "tools_used": [tc["tool"] for tc in self.tool_calls_made],
                    "total_tool_calls": len(self.tool_calls_made),
                })
                yield sse_done()
                return

        # Max iterations reached
        yield sse_event("error", {
            "message": f"Max iterations ({self.max_iterations}) reached without final answer",
            "iterations": self.max_iterations,
        })
        yield sse_done()

    async def execute(
        self,
        variables: dict,
        stream: bool = True,
    ) -> AsyncGenerator[str, None]:
        """
        Main entry point. Routes to simple or react mode based on config.
        """
        if self.agent_mode == "react" and self.enabled_tools:
            # ReAct mode always streams SSE events (stream param not applicable)
            async for event in self.execute_react(variables):
                yield event
        else:
            async for event in self.execute_simple(variables, stream=stream):
                yield event

    def get_history_payload(self, variables: dict) -> tuple[dict, dict]:
        """Build request/response payloads for history logging."""
        req_payload = {
            "messages": self.messages or [],
            "params": {
                "model": self.model,
                "temperature": self.temperature,
                "max_tokens": self.max_tokens,
                "agent_mode": self.agent_mode,
            },
            "agent": {"id": self.agent_id, "name": self.agent_name},
            "variables": variables,
        }
        if self.enabled_tools:
            req_payload["tools_used"] = [tc["tool"] for tc in self.tool_calls_made]
            req_payload["iterations"] = self.iterations_used

        if self.rag_enabled:
            req_payload["rag"] = {
                "enabled": True,
                "topK": self.rag_top_k,
                "threshold": self.rag_threshold,
                "sources": self.rag_sources,
            }
            if self.rag_debug:
                req_payload["rag_debug"] = self.rag_debug

        if self.workflow_id:
            req_payload["workflow"] = {
                "id": self.workflow_id,
                "name": self.workflow_name,
                "step": self.workflow_step,
            }

        res_text = self.full_text[:50000]
        res_payload = {
            "text": res_text,
            "truncated": len(self.full_text) > 50000,
        }
        if self.tool_calls_made:
            res_payload["tool_calls"] = self.tool_calls_made

        return req_payload, res_payload
