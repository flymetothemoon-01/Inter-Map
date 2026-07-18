import asyncio
import json
import math
import pathlib
import websockets
from contextlib import suppress

ROOT = pathlib.Path(__file__).resolve().parent
ASSET_ROOT = ROOT / "assets"


def build_state():
    return {
        "party": {"position": [1500, 2000], "name": "Party"},
        "locations": [
            {"name": "Dawn Harbor", "position": [700, 900]},
            {"name": "Iron Keep", "position": [1350, 1750]},
            {"name": "Shadowfen", "position": [2200, 3050]},
        ],
    }


def build_update_payload(state, step=0):
    party = dict(state["party"])
    party["position"] = [
        party["position"][0] + math.sin(step / 4) * 15,
        party["position"][1] + math.cos(step / 4) * 10,
    ]
    return {"type": "state", "state": {"party": party, "locations": state["locations"]}}


async def broadcast_state(websocket, state, step):
    payload = build_update_payload(state, step=step)
    await websocket.send(json.dumps(payload))


async def handler(websocket):
    state = build_state()
    step = 0
    while True:
        await broadcast_state(websocket, state, step)
        step += 1
        await asyncio.sleep(1)


async def main():
    async with websockets.serve(handler, "127.0.0.1", 8765):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(main())
