"""
Tool Registry for Agentic Architecture.
Each tool has: name, description, parameters schema (OpenAI function format), and an async handler.
"""

from tools.kb_search import KB_SEARCH_TOOL, execute_kb_search
from tools.dataset_query import DATASET_QUERY_TOOL, execute_dataset_query
from tools.web_fetch import WEB_FETCH_TOOL, execute_web_fetch
from tools.sub_agent import SUB_AGENT_TOOL, execute_sub_agent

# Master registry: tool_name -> { schema, handler }
TOOL_REGISTRY = {
    "kb_search": {
        "schema": KB_SEARCH_TOOL,
        "handler": execute_kb_search,
    },
    "dataset_query": {
        "schema": DATASET_QUERY_TOOL,
        "handler": execute_dataset_query,
    },
    "web_fetch": {
        "schema": WEB_FETCH_TOOL,
        "handler": execute_web_fetch,
    },
    "sub_agent": {
        "schema": SUB_AGENT_TOOL,
        "handler": execute_sub_agent,
    },
}


def get_tool_schemas(enabled_tools: list[str]) -> list[dict]:
    """Return OpenAI-format tool schemas for the given tool names."""
    schemas = []
    for name in enabled_tools:
        entry = TOOL_REGISTRY.get(name)
        if entry:
            schemas.append(entry["schema"])
    return schemas


def get_tool_handler(tool_name: str):
    """Return the async handler function for a tool."""
    entry = TOOL_REGISTRY.get(tool_name)
    return entry["handler"] if entry else None


def get_available_tool_names() -> list[str]:
    """Return all registered tool names."""
    return list(TOOL_REGISTRY.keys())
