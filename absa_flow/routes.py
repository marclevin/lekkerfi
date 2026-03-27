import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import redirect, render_template, request, session, url_for

from .absa_client import AbsaPlaypenClient
from .flow_state import FlowState, get_or_create_flow_state, reset_flow_state


def register_routes(app, client: AbsaPlaypenClient, logger) -> None:
    export_dir = Path(__file__).resolve().parent.parent / "exports"

    # ── Helpers ───────────────────────────────────────────────────────────────

    def current_state() -> FlowState:
        flow_id = session.get("flow_id")
        if not flow_id:
            flow_id = str(uuid.uuid4())
            session["flow_id"] = flow_id
        return get_or_create_flow_state(flow_id)

    def save_response(state: FlowState, step: str, payload: Any) -> None:
        state.responses[step] = payload
        state.last_error = ""

    def set_error(state: FlowState, message: str) -> None:
        state.last_error = message
        logger.error(message)

    def require_token(state: FlowState) -> bool:
        if state.token:
            return True
        set_error(state, "Token not available — run Step 1 first.")
        return False

    def save_transactions_json(account_number: str, payload: dict[str, Any]) -> str:
        export_dir.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        file_name = f"transactions_{account_number}_{timestamp}.json"
        file_path = export_dir / file_name
        with file_path.open("w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
        logger.info("Saved transactions for %s → %s", account_number, file_path)
        return str(file_path)

    def absorb_form_details(state: FlowState) -> None:
        """Read common account detail fields from the form into state."""
        fields = [
            "access_account", "user_number", "org_name", "org_id",
            "merchant_id", "reference_number", "user_email", "selected_date",
            "trx_from_date", "trx_to_date",
        ]
        for field in fields:
            value = request.form.get(field, "").strip()
            if value:
                setattr(state, field, value)

    # ── Dashboard ─────────────────────────────────────────────────────────────

    @app.route("/", methods=["GET"])
    def index():
        state = current_state()
        responses_pretty = {k: json.dumps(v, indent=2) for k, v in state.responses.items()
                            if k not in ("surechecks", "exports", "trx_history")}
        trx_history_pretty = json.dumps(state.responses["trx_history"], indent=2) \
            if "trx_history" in state.responses else None

        accounts = state.responses.get("accounts", {}).get("accounts", [])
        surechecks = state.responses.get("surechecks", [])
        exports = state.responses.get("exports", [])

        statuses = {
            "token":           bool(state.token),
            "consent":         bool(state.transaction_id),
            "surechecks":      "surechecks" in state.responses,
            "accounts":        bool(accounts),
            "transactions":    bool(exports),
        }
        return render_template(
            "dashboard.html",
            state=state,
            playpen_host=client.settings.gateway_host,
            statuses=statuses,
            responses=responses_pretty,
            accounts=accounts,
            surechecks=surechecks,
            exports=exports,
            trx_history=trx_history_pretty,
        )

    @app.route("/reset", methods=["POST"])
    def reset():
        flow_id = session.get("flow_id")
        if flow_id:
            reset_flow_state(flow_id)
        return redirect(url_for("index"))

    # ── Step 1: Token ─────────────────────────────────────────────────────────

    @app.route("/step/token", methods=["POST"])
    def step_token():
        state = current_state()
        try:
            state.token = client.get_oauth_token()
            save_response(state, "token", {"tokenPreview": f"{state.token[:30]}..."})
        except Exception as exc:
            set_error(state, f"Token failed: {exc}")
        return redirect(url_for("index"))

    # ── Step 2: Long-lived consent ────────────────────────────────────────────

    @app.route("/step/consent", methods=["POST"])
    def step_consent():
        state = current_state()
        absorb_form_details(state)

        if not require_token(state):
            return redirect(url_for("index"))

        try:
            payload = client.create_consent(
                token=state.token,
                access_account=state.access_account,
                user_number=state.user_number,
                org_name=state.org_name,
                org_id=state.org_id,
                merchant_id=state.merchant_id,
                reference_number=state.reference_number,
            )
            save_response(state, "consent", payload)
            state.transaction_id = payload.get("transactionId", "")
            rc = payload.get("resultCode")
            if rc not in (200, 126):
                set_error(state, f"ConsentRequest returned resultCode={rc}: {payload.get('resultMessage', '')}")
        except Exception as exc:
            set_error(state, f"Consent failed: {exc}")
        return redirect(url_for("index"))

    # ── Step 3: List SureChecks ───────────────────────────────────────────────

    @app.route("/step/surechecks/list", methods=["POST"])
    def step_surechecks_list():
        state = current_state()
        absorb_form_details(state)

        if not require_token(state):
            return redirect(url_for("index"))
        if not state.user_email:
            set_error(state, "User email is required to list SureChecks.")
            return redirect(url_for("index"))

        try:
            items = client.list_surechecks(token=state.token, user_email=state.user_email)
            save_response(state, "surechecks", items)
        except Exception as exc:
            set_error(state, f"List SureChecks failed: {exc}")
        return redirect(url_for("index"))

    # ── Step 4: Respond to a SureCheck ───────────────────────────────────────

    @app.route("/step/surechecks/respond", methods=["POST"])
    def step_surecheck_respond():
        state = current_state()
        absa_reference = request.form.get("absa_reference", "").strip()
        action = request.form.get("action", "Accepted").strip()

        if not require_token(state):
            return redirect(url_for("index"))
        if not absa_reference:
            set_error(state, "No absaReference provided.")
            return redirect(url_for("index"))

        try:
            payload = client.respond_surecheck(
                token=state.token,
                absa_reference=absa_reference,
                action=action,
            )
            # Store the last respond result
            save_response(state, f"surecheck_respond_{absa_reference[:8]}", payload)
            # Refresh the list automatically
            if state.user_email:
                items = client.list_surechecks(token=state.token, user_email=state.user_email)
                save_response(state, "surechecks", items)
        except Exception as exc:
            set_error(state, f"SureCheck respond failed: {exc}")
        return redirect(url_for("index"))

    # ── Step 5: List accounts (AIS) ───────────────────────────────────────────

    @app.route("/step/accounts", methods=["POST"])
    def step_accounts():
        state = current_state()
        absorb_form_details(state)

        if not require_token(state):
            return redirect(url_for("index"))

        try:
            payload = client.fetch_accounts(
                token=state.token,
                access_account=state.access_account,
                user_number=state.user_number,
                org_name=state.org_name,
                org_id=state.org_id,
                reference_number=state.reference_number,
            )
            save_response(state, "accounts", payload)
            rc = payload.get("resultCode")
            if rc != 200:
                set_error(state, f"AccountInformationRequest returned resultCode={rc}: {payload.get('resultMessage', '')}")
        except Exception as exc:
            set_error(state, f"Fetch accounts failed: {exc}")
        return redirect(url_for("index"))

    # ── Step 5a: Select account for TrxHistory ────────────────────────────────

    @app.route("/step/select_account", methods=["POST"])
    def step_select_account():
        state = current_state()
        account_number = request.form.get("account_number", "").strip()
        if account_number:
            state.selected_account = account_number
        return redirect(url_for("index"))

    # ── Step 5b: Fetch transaction history (one-time consent) ─────────────────

    @app.route("/step/trx_history", methods=["POST"])
    def step_trx_history():
        state = current_state()
        absorb_form_details(state)

        if not require_token(state):
            return redirect(url_for("index"))
        if not state.selected_account:
            set_error(state, "No account selected — select an account in Step 4 first.")
            return redirect(url_for("index"))

        document_format = request.form.get("document_format", "JSON").strip()

        try:
            payload = client.fetch_trx_history(
                token=state.token,
                account_number=state.selected_account,
                org_name=state.org_name,
                org_id=state.org_id,
                from_date=state.trx_from_date,
                to_date=state.trx_to_date,
                document_format=document_format,
            )
            rc = payload.get("resultCode")
            if rc == 200:
                saved_path = save_transactions_json(state.selected_account, payload)
                exports = [{
                    "accountNumber": state.selected_account,
                    "accountName": "",
                    "lines": len(payload.get("accountHistoryLines", [])),
                    "path": saved_path,
                }]
                save_response(state, "exports", exports)
                save_response(state, "trx_history", payload)
            else:
                set_error(state, f"TrxHistoryConsentRequest returned resultCode={rc}: {payload.get('resultMessage', '')}")
                save_response(state, "trx_history", payload)
        except Exception as exc:
            set_error(state, f"TrxHistory failed: {exc}")
        return redirect(url_for("index"))
