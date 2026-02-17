"""
Sub-Agent Tool - Run another saved agent as a sub-task.
"""

SUB_AGENT_TOOL = {
    "type": "function",
    "function": {
        "name": "sub_agent",
        "description": "Run another saved agent as a sub-task. Use this to delegate specialized work to other agents, enabling multi-agent collaboration. The sub-agent runs to completion and returns its output.",
        "parameters": {
            "type": "object",
            "properties": {
                "agent_id": {
                    "type": "string",
                    "description": "UUID of the agent to run"
                },
                "agent_name": {
                    "type": "string",
                    "description": "Name of the agent to run (used if agent_id not provided, matches by name)"
                },
                "variables": {
                    "type": "object",
                    "description": "Variable values to pass to the sub-agent (key-value pairs)",
                    "additionalProperties": {"type": "string"}
                }
            },
            "required": []
        }
    }
}


async def execute_sub_agent(args: dict, context: dict) -> str:
    """
    Execute a sub-agent. This performs a non-streaming call to the agent run endpoint.
    context must contain: session (AsyncSession), run_agent_func (callable)
    The run_agent_func should be a reference to the internal agent execution to avoid circular HTTP calls.
    """
    agent_id = args.get("agent_id")
    agent_name = args.get("agent_name")
    variables = args.get("variables", {})

    session = context.get("session")
    if not session:
        return "Error: database session not available"

    # Depth check to prevent infinite recursion
    depth = context.get("depth", 0)
    if depth >= 3:
        return "Error: Maximum sub-agent nesting depth (3) reached. Cannot call more sub-agents."

    try:
        from sqlalchemy import text as sql_text

        # Resolve agent by name if no ID
        if not agent_id and agent_name:
            result = await session.execute(
                sql_text("SELECT id FROM saved_agents WHERE lower(name) = lower(:name)"),
                {"name": agent_name}
            )
            row = result.fetchone()
            if not row:
                return f"Error: No agent found with name '{agent_name}'"
            agent_id = str(row.id)

        if not agent_id:
            # List available agents
            result = await session.execute(
                sql_text("SELECT id, name, description FROM saved_agents ORDER BY updated_at DESC LIMIT 10")
            )
            rows = result.fetchall()
            if not rows:
                return "No agents available. Create agents from the Playground first."
            parts = ["Available agents (provide agent_id or agent_name):\n"]
            for row in rows:
                desc = f" - {row.description}" if row.description else ""
                parts.append(f"  - {row.name} (id: {row.id}){desc}")
            return "\n".join(parts)

        # Run the sub-agent via the internal executor
        run_agent_func = context.get("run_agent_func")
        if not run_agent_func:
            return "Error: sub-agent execution not available in this context"

        result = await run_agent_func(
            agent_id=agent_id,
            variables=variables,
            depth=depth + 1,
            parent_session=session,
        )
        return result

    except Exception as e:
        return f"Sub-agent execution error: {str(e)}"
