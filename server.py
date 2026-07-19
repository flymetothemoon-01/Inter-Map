import asyncio
import json
import math
import mimetypes
import pathlib
from aiohttp import web
import websockets

ROOT = pathlib.Path(__file__).resolve().parent
MARKERS_PATH = ROOT / "locations.json"
ROUTES_PATH = ROOT / "routes.json"


def fallback_markers():
    return [
        {"name": "Dawn Harbor", "position": [700, 900], "description": "A bustling port town."},
        {"name": "Iron Keep", "position": [1350, 1750], "description": "A fortress city on the frontier."},
        {"name": "Shadowfen", "position": [2200, 3050], "description": "A haunted wetland full of secrets."},
    ]


def fallback_routes():
    return []


def load_markers():
    if not MARKERS_PATH.exists():
        return fallback_markers()
    try:
        payload = json.loads(MARKERS_PATH.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict) and isinstance(payload.get("locations"), list):
            return payload["locations"]
    except Exception:
        pass
    return fallback_markers()


def save_markers(markers):
    MARKERS_PATH.write_text(json.dumps(markers, indent=2) + "\n", encoding="utf-8")


def load_routes():
    if not ROUTES_PATH.exists():
        return fallback_routes()
    try:
        payload = json.loads(ROUTES_PATH.read_text(encoding="utf-8"))
        if isinstance(payload, list):
            return payload
        if isinstance(payload, dict) and isinstance(payload.get("routes"), list):
            return payload["routes"]
    except Exception:
        pass
    return fallback_routes()


def save_routes(routes):
    ROUTES_PATH.write_text(json.dumps(routes, indent=2) + "\n", encoding="utf-8")


def build_state():
    return {
        "party": {"position": [1500, 2000], "name": "Party"},
        "locations": load_markers(),
    }


def build_update_payload(state, step=0):
    party = dict(state.get("party", {"position": [1500, 2000], "name": "Party"}))
    party["position"] = [
        party["position"][0] + math.sin(step / 4) * 15,
        party["position"][1] + math.cos(step / 4) * 10,
    ]
    return {
        "type": "state",
        "state": {"party": party, "locations": load_markers()},
    }


async def broadcast_state(websocket, state, step):
    payload = build_update_payload(state, step=step)
    await websocket.send(json.dumps(payload))


async def ws_handler(websocket):
    state = build_state()
    step = 0
    try:
        while True:
            await broadcast_state(websocket, state, step)
            step += 1
            await asyncio.sleep(1)
    except (websockets.ConnectionClosed, ConnectionResetError):
        return
    except Exception:
        return


async def get_markers_handler(request):
    response = web.json_response(load_markers())
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


async def persist_markers_handler(request):
    try:
        payload = await request.json()
        if isinstance(payload, dict) and isinstance(payload.get("locations"), list):
            markers = payload["locations"]
        elif isinstance(payload, list):
            markers = payload
        else:
            markers = []
        save_markers(markers)
        response = web.json_response({"ok": True, "count": len(markers)})
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return response
    except Exception as error:
        response = web.json_response({"ok": False, "error": str(error)}, status=500)
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return response


async def get_routes_handler(request):
    response = web.json_response(load_routes())
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


async def persist_routes_handler(request):
    try:
        payload = await request.json()
        if isinstance(payload, dict) and isinstance(payload.get("routes"), list):
            routes = payload["routes"]
        elif isinstance(payload, list):
            routes = payload
        else:
            routes = []
        save_routes(routes)
        response = web.json_response({"ok": True, "count": len(routes)})
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return response
    except Exception as error:
        response = web.json_response({"ok": False, "error": str(error)}, status=500)
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
        return response


async def options_handler(request):
    response = web.Response(status=204)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


async def serve_static(request):
    path = request.match_info.get("path", "") or ""
    if path in {"", "/"}:
        file_path = ROOT / "index.html"
    else:
        safe_path = path.lstrip("/")
        if safe_path.startswith(".") or ".." in pathlib.PurePosixPath(safe_path).parts:
            return web.Response(status=404)
        file_path = (ROOT / safe_path).resolve()
        if not str(file_path).startswith(str(ROOT.resolve())):
            return web.Response(status=404)
    if file_path.exists() and file_path.is_file():
        content_type, _ = mimetypes.guess_type(str(file_path))
        response = web.Response(body=file_path.read_bytes(), content_type=content_type or "application/octet-stream")
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        return response
    return web.Response(status=404, text="Not found")


async def main():
    app = web.Application()
    app.router.add_get("/api/markers", get_markers_handler)
    app.router.add_post("/api/markers", persist_markers_handler)
    app.router.add_options("/api/markers", options_handler)
    app.router.add_get("/api/routes", get_routes_handler)
    app.router.add_post("/api/routes", persist_routes_handler)
    app.router.add_options("/api/routes", options_handler)
    app.router.add_get("/", serve_static)
    app.router.add_get("/index.html", serve_static)
    app.router.add_get("/{path:.*}", serve_static)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 8766)
    await site.start()
    async with websockets.serve(ws_handler, "127.0.0.1", 8765):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
