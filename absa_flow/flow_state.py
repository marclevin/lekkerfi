from dataclasses import asdict, dataclass, field
from datetime import date
from threading import Lock


@dataclass
class FlowState:
    # Customer / org details (editable in the UI)
    access_account: str = "4048195297"
    user_number: str = "1"
    org_name: str = "LekkerFi"
    org_id: str = "C90200F0-60E7-4E40-9C4B-83940CF12D6B"
    merchant_id: str = "6E882387-5957-4389-BB62-558DF6EC04A1"
    reference_number: str = "CUST123456"
    user_email: str = ""          # Required for listSureChecks
    selected_date: str = field(default_factory=lambda: date.today().isoformat())
    selected_account: str = ""   # Account chosen for TrxHistory
    trx_from_date: str = "2025-01-01"
    trx_to_date: str = field(default_factory=lambda: date.today().isoformat())

    # Runtime state
    token: str = ""
    transaction_id: str = ""      # From ConsentRequest
    responses: dict = field(default_factory=dict)
    last_error: str = ""


_STATE_LOCK = Lock()
_STATE_STORE: dict[str, FlowState] = {}


def get_or_create_flow_state(flow_id: str) -> FlowState:
    with _STATE_LOCK:
        if flow_id not in _STATE_STORE:
            _STATE_STORE[flow_id] = FlowState()
        return _STATE_STORE[flow_id]


def reset_flow_state(flow_id: str) -> None:
    with _STATE_LOCK:
        _STATE_STORE[flow_id] = FlowState()


def snapshot(state: FlowState) -> dict:
    return asdict(state)
