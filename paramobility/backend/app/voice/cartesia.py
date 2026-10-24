"""Thin client for the Cartesia Agents API (managed voice agents)."""

import httpx

from app.core.config import get_settings


class CartesiaError(RuntimeError):
    pass


class CartesiaClient:
    def __init__(self):
        s = get_settings()
        self._http = httpx.AsyncClient(
            base_url=s.cartesia_api_base,
            timeout=30,
            headers={
                # The API reference uses a bearer token and the guides use X-API-Key.
                "Authorization": f"Bearer {s.cartesia_api_key}",
                "X-API-Key": s.cartesia_api_key,
                "Cartesia-Version": s.cartesia_version,
            },
        )

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        await self._http.aclose()

    async def _request(self, method: str, path: str, **kwargs) -> dict | list:
        r = await self._http.request(method, path, **kwargs)
        if r.is_error:
            raise CartesiaError(f"{method} {path} -> {r.status_code}: {r.text}")
        return r.json()

    async def start_call(self, agent_id: str, to_number: str, variables: dict) -> str:
        body = {
            "agent_id": agent_id,
            "from_number_id": await self._from_number_id(),
            "ringing_timeout_seconds": 45,
            "outbound_calls": [{"to_number": to_number, "dynamic_variables": variables}],
        }
        call = (await self._request("POST", "/agents/calls", json=body))["calls"][0]
        if "error" in call:
            raise CartesiaError(f"call to {to_number} could not start: {call['error']}")
        return call["agent_call_id"]

    async def _from_number_id(self) -> str:
        """CARTESIA_FROM_NUMBER_ID may hold the number's id or the number itself."""
        value = get_settings().cartesia_from_number_id
        if not value.startswith("+"):
            return value
        for n in await self.list_phone_numbers():
            if n["number"] == value:
                return n["id"]
        raise CartesiaError(f"{value} is not a phone number on this Cartesia account")

    async def get_call(self, call_id: str) -> dict:
        return await self._request("GET", f"/agents/calls/{call_id}")

    async def list_phone_numbers(self) -> list[dict]:
        return (await self._request("GET", "/agents/phone-numbers", params={"limit": 100}))["data"]

    async def list_voices(self, limit: int = 20) -> list[dict]:
        return (await self._request("GET", "/voices", params={"limit": limit}))["data"]

    async def list_models(self) -> list[dict]:
        return (await self._request("GET", "/v1/agents/models"))["data"]

    async def list_tools(self) -> list[dict]:
        return (await self._request("GET", "/v1/agents/tools"))["data"]

    async def create_tool(self, tool: dict) -> dict:
        return await self._request("POST", "/v1/agents/tools", json=tool)

    async def update_tool(self, tool_id: str, changes: dict) -> dict:
        return await self._request("PATCH", f"/v1/agents/tools/{tool_id}", json=changes)

    async def list_agents(self) -> list[dict]:
        return (await self._request("GET", "/v1/agents"))["data"]

    async def create_agent(self, agent: dict) -> dict:
        return await self._request("POST", "/v1/agents", json=agent)

    async def update_agent(self, agent_id: str, changes: dict) -> dict:
        return await self._request("PATCH", f"/v1/agents/{agent_id}", json=changes)
