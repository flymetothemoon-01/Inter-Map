import pathlib
import sys

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from server import build_state, build_update_payload


def test_build_update_payload_contains_party_position_and_locations():
    state = build_state()
    payload = build_update_payload(state, step=1)

    assert payload["type"] == "state"
    assert "party" in payload["state"]
    assert isinstance(payload["state"]["party"]["position"], list)
    assert len(payload["state"]["party"]["position"]) == 2
    assert payload["state"]["locations"]
