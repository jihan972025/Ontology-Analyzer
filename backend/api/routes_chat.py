import json
import logging
from typing import Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["chat"])


class ProviderConfig(BaseModel):
    provider_id: str
    api_key: str
    model: str
    endpoint_url: str
    api_format: str  # 'openai' | 'anthropic' | 'gemini'


class ChatMessageModel(BaseModel):
    role: str
    content: str


class ChatContext(BaseModel):
    selectedNode: Optional[dict] = None
    graphSummary: Optional[dict] = None
    folderPath: Optional[str] = None
    connectedNodes: Optional[list] = None
    vulnerabilities: Optional[list] = None


class ChatRequest(BaseModel):
    messages: list[ChatMessageModel]
    provider: ProviderConfig
    context: Optional[ChatContext] = None
    stream: bool = True


class TestConnectionRequest(BaseModel):
    provider: ProviderConfig


def _build_system_message(context: Optional[ChatContext]) -> str:
    """Build a system message with code analysis context."""
    parts = [
        "You are an expert code analysis assistant for the Ontology Analyzer tool. "
        "You help developers understand code structure, dependencies, and potential issues. "
        "Answer concisely and technically."
    ]
    if not context:
        return "".join(parts)

    if context.graphSummary:
        s = context.graphSummary
        parts.append(
            f"\n\nCurrent project analysis: {s.get('totalNodes', 0)} nodes, "
            f"{s.get('totalEdges', 0)} edges, {s.get('cycleCount', 0)} circular deps, "
            f"{s.get('deadCount', 0)} dead code, {s.get('vulnCount', 0)} vulnerabilities, "
            f"{s.get('fileCount', 0)} files."
        )
        if s.get("nodeTypes"):
            parts.append(f" Node types: {s['nodeTypes']}")

    if context.folderPath:
        parts.append(f"\nProject: {context.folderPath}")

    if context.selectedNode:
        n = context.selectedNode
        info = f"\n\nSelected: {n.get('label')} (type={n.get('type')}, file={n.get('file')}"
        if n.get("line"):
            info += f", line {n['line']}"
        info += f", fan-in={n.get('fanIn', 0)}, fan-out={n.get('fanOut', 0)}"
        if n.get("dead"):
            info += ", DEAD CODE"
        if n.get("vulnCount"):
            info += f", {n['vulnCount']} vulnerabilities"
        info += ")"
        parts.append(info)

    if context.connectedNodes:
        incoming = [c for c in context.connectedNodes if c.get("direction") == "incoming"]
        outgoing = [c for c in context.connectedNodes if c.get("direction") == "outgoing"]
        if incoming:
            labels = ", ".join(f"{c['label']}({c['edgeType']})" for c in incoming[:10])
            parts.append(f"\nIncoming: {labels}")
        if outgoing:
            labels = ", ".join(f"{c['label']}({c['edgeType']})" for c in outgoing[:10])
            parts.append(f"\nOutgoing: {labels}")

    if context.vulnerabilities:
        parts.append(f"\n\n=== Detected Vulnerabilities ({len(context.vulnerabilities)}) ===")
        # Group by severity for clarity
        severity_order = ["critical", "high", "medium", "low"]
        by_severity: dict[str, list] = {}
        for v in context.vulnerabilities:
            sev = v.get("severity", "low")
            by_severity.setdefault(sev, []).append(v)

        for sev in severity_order:
            vulns = by_severity.get(sev, [])
            if not vulns:
                continue
            parts.append(f"\n[{sev.upper()}] ({len(vulns)} issues)")
            for v in vulns:
                loc = f"{v.get('file', '?')}:{v.get('line', '?')}"
                node_label = v.get("nodeLabel", "")
                node_info = f" in {node_label}" if node_label else ""
                parts.append(
                    f"\n  - {v.get('rule', 'unknown')}{node_info} ({loc}): {v.get('message', '')}"
                )

        parts.append(
            "\n\nWhen the user asks about vulnerabilities, provide detailed explanations including: "
            "what the vulnerability is, why it is dangerous, where it occurs in the code, "
            "and specific remediation steps with code examples."
        )

    return "".join(parts)


async def _stream_openai_compatible(
    messages: list[dict],
    api_key: str,
    model: str,
    endpoint_url: str,
):
    """Stream from any OpenAI-compatible API."""
    from openai import AsyncOpenAI

    client = AsyncOpenAI(
        api_key=api_key or "ollama",
        base_url=endpoint_url,
    )
    try:
        stream = await client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
        )
        async for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content:
                yield f"data: {json.dumps({'content': delta.content})}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "data: [DONE]\n\n"


async def _stream_anthropic(
    messages: list[dict],
    api_key: str,
    model: str,
    endpoint_url: str,
):
    """Stream from Anthropic API."""
    import anthropic

    kwargs = {"api_key": api_key}
    if endpoint_url and endpoint_url != "https://api.anthropic.com":
        kwargs["base_url"] = endpoint_url
    client = anthropic.AsyncAnthropic(**kwargs)
    system_msg = ""
    chat_messages = []
    for m in messages:
        if m["role"] == "system":
            system_msg = m["content"]
        else:
            chat_messages.append(m)

    try:
        async with client.messages.stream(
            model=model,
            max_tokens=4096,
            system=system_msg,
            messages=chat_messages,
        ) as stream:
            async for text in stream.text_stream:
                yield f"data: {json.dumps({'content': text})}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "data: [DONE]\n\n"


async def _stream_gemini(
    messages: list[dict],
    api_key: str,
    model: str,
    endpoint_url: str,
):
    """Stream from Google Gemini API."""
    import asyncio
    import google.generativeai as genai

    genai.configure(api_key=api_key)
    gmodel = genai.GenerativeModel(model)

    # Convert to Gemini format
    history = []
    last_content = ""
    system_parts = []
    for m in messages:
        if m["role"] == "system":
            system_parts.append(m["content"])
        elif m["role"] == "user":
            last_content = m["content"]
            history.append({"role": "user", "parts": [m["content"]]})
        elif m["role"] == "assistant":
            history.append({"role": "model", "parts": [m["content"]]})

    if system_parts:
        # Prepend system to first user message
        if history and history[0]["role"] == "user":
            history[0]["parts"] = ["\n".join(system_parts) + "\n\n" + history[0]["parts"][0]]

    try:
        chat = gmodel.start_chat(history=history[:-1] if len(history) > 1 else [])
        response = await asyncio.to_thread(
            lambda: chat.send_message(last_content, stream=True)
        )
        for chunk in response:
            if chunk.text:
                yield f"data: {json.dumps({'content': chunk.text})}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'error': str(e)})}\n\n"
        yield "data: [DONE]\n\n"


@router.post("/chat")
async def chat_endpoint(req: ChatRequest):
    """Chat with LLM — streaming SSE response."""
    system_msg = _build_system_message(req.context)
    messages = [{"role": "system", "content": system_msg}]
    for m in req.messages:
        messages.append({"role": m.role, "content": m.content})

    api_format = req.provider.api_format

    try:
        if api_format == "anthropic":
            generator = _stream_anthropic(
                messages, req.provider.api_key,
                req.provider.model, req.provider.endpoint_url,
            )
        elif api_format == "gemini":
            generator = _stream_gemini(
                messages, req.provider.api_key,
                req.provider.model, req.provider.endpoint_url,
            )
        else:
            generator = _stream_openai_compatible(
                messages, req.provider.api_key,
                req.provider.model, req.provider.endpoint_url,
            )

        return StreamingResponse(
            generator,
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    except Exception as e:
        logger.error("Chat error: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/chat/test")
async def test_connection(req: TestConnectionRequest):
    """Test connection to an LLM provider."""
    try:
        api_format = req.provider.api_format
        test_messages = [{"role": "user", "content": "Hi. Reply with just 'ok'."}]

        if api_format == "anthropic":
            import anthropic
            ant_kwargs = {"api_key": req.provider.api_key}
            if req.provider.endpoint_url and req.provider.endpoint_url != "https://api.anthropic.com":
                ant_kwargs["base_url"] = req.provider.endpoint_url
            client = anthropic.AsyncAnthropic(**ant_kwargs)
            response = await client.messages.create(
                model=req.provider.model,
                max_tokens=10,
                messages=test_messages,
            )
            return {"status": "ok", "response": response.content[0].text}

        elif api_format == "gemini":
            import asyncio
            import google.generativeai as genai
            genai.configure(api_key=req.provider.api_key)
            gmodel = genai.GenerativeModel(req.provider.model)
            response = await asyncio.to_thread(
                lambda: gmodel.generate_content("Hi. Reply with just 'ok'.")
            )
            return {"status": "ok", "response": response.text}

        else:
            from openai import AsyncOpenAI
            client = AsyncOpenAI(
                api_key=req.provider.api_key or "ollama",
                base_url=req.provider.endpoint_url,
            )
            response = await client.chat.completions.create(
                model=req.provider.model,
                messages=test_messages,
                max_tokens=10,
            )
            return {"status": "ok", "response": response.choices[0].message.content}

    except Exception as e:
        return {"status": "error", "error": str(e)}
