import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any
from werkzeug.utils import secure_filename

from flask import jsonify, redirect, render_template, request, session, send_file, url_for

from .absa_client import AbsaPlaypenClient
from .flow_state import FlowState, get_or_create_flow_state, reset_flow_state
from services.statement_processor import process_statement
from services.simplify import simplify
from services.translate import translate
from services.insights_visualizer import FinancialInsightsVisualizer


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

    # ── Bank Statement Processing (New Flow) ──────────────────────────────────

    @app.route("/api/upload-statement", methods=["POST"])
    def upload_statement():
        """
        Upload a bank statement file (PDF or image).
        Returns: JSON with file info and temporary path
        """
        state = current_state()
        
        if "file" not in request.files:
            return jsonify({"error": "No file provided"}), 400
        
        file = request.files["file"]
        if file.filename == "":
            return jsonify({"error": "No file selected"}), 400
        
        # Validate file type
        allowed_extensions = {".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp"}
        file_ext = Path(file.filename).suffix.lower()
        if file_ext not in allowed_extensions:
            return jsonify({
                "error": f"Unsupported file type. Allowed: {allowed_extensions}"
            }), 400
        
        # Create uploads directory
        uploads_dir = export_dir / "uploads"
        uploads_dir.mkdir(parents=True, exist_ok=True)
        
        # Save the file
        secure_name = secure_filename(file.filename)
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        file_name = f"{timestamp}_{secure_name}"
        file_path = uploads_dir / file_name
        
        try:
            file.save(str(file_path))
            logger.info("Uploaded statement file: %s", file_path)
            
            return jsonify({
                "success": True,
                "message": "File uploaded successfully",
                "file_path": str(file_path),
                "file_name": file_name,
            }), 200
        except Exception as exc:
            logger.error("File upload failed: %s", exc)
            return jsonify({"error": f"File upload failed: {exc}"}), 500

    @app.route("/api/process-statement", methods=["POST"])
    def process_statement_endpoint():
        """
        Process an uploaded bank statement file.
        Expects: JSON body with 'file_path'
        Returns: Extracted transaction data as JSON
        """
        state = current_state()
        
        try:
            data = request.get_json() or {}
            file_path = data.get("file_path", "").strip()
            
            if not file_path:
                return jsonify({"error": "Missing file_path in request"}), 400
            
            # Security: ensure file is in uploads directory
            file_path = Path(file_path).resolve()
            uploads_dir = (export_dir / "uploads").resolve()
            
            if not str(file_path).startswith(str(uploads_dir)):
                return jsonify({"error": "Invalid file path"}), 403
            
            logger.info("Processing statement: %s", file_path)
            
            # Process the statement
            result = process_statement(str(file_path))
            
            # Store in flow state
            save_response(state, "statement_data", result)
            
            logger.info("Statement processed successfully: %d transactions extracted", 
                       len(result.get("transactionHistory", {}).get("accountHistoryLines", [])))
            
            return jsonify({
                "success": True,
                "message": "Statement processed successfully",
                "data": result,
            }), 200
            
        except ValueError as exc:
            logger.error("Statement processing error: %s", exc)
            return jsonify({"error": f"Processing error: {exc}"}), 400
        except Exception as exc:
            logger.error("Statement processing failed: %s", exc)
            set_error(state, f"Statement processing failed: {exc}")
            return jsonify({"error": f"Processing failed: {exc}"}), 500

    @app.route("/api/simplify-statement", methods=["POST"])
    def simplify_statement():
        """
        Simplify extracted statement data into bullet-point insights.
        Expects: JSON body with 'data' (transaction data) or uses stored statement_data
        Returns: Simplified insights as bullet points
        """
        state = current_state()
        
        try:
            request_data = request.get_json() or {}
            
            # Get transaction data from request or state
            transaction_data = request_data.get("data")
            if not transaction_data:
                transaction_data = state.responses.get("statement_data")
            
            if not transaction_data:
                return jsonify({"error": "No statement data available. Process a statement first."}), 400
            
            # Extract the transaction history for simplification
            trx_history = transaction_data.get("transactionHistory", {})
            
            logger.info("Simplifying %d transactions", 
                       len(trx_history.get("accountHistoryLines", [])))
            
            # Call simplify service
            insights = simplify(trx_history)
            
            # Store in flow state
            save_response(state, "statement_insights", insights)
            
            return jsonify({
                "success": True,
                "message": "Statement simplified successfully",
                "insights": insights,
            }), 200
            
        except Exception as exc:
            logger.error("Simplification failed: %s", exc)
            set_error(state, f"Simplification failed: {exc}")
            return jsonify({"error": f"Simplification failed: {exc}"}), 500

    @app.route("/api/translate-statement", methods=["POST"])
    def translate_statement():
        """
        Translate statement insights to a target language.
        Expects: JSON body with 'text' (insights to translate) and 'language'
        Returns: Translated insights
        """
        state = current_state()
        
        try:
            request_data = request.get_json() or {}
            
            # Get text to translate
            text = request_data.get("text", "").strip()
            if not text:
                # Try to use stored insights
                text = state.responses.get("statement_insights", "").strip()
            
            if not text:
                return jsonify({"error": "No insights to translate. Simplify a statement first."}), 400
            
            language = request_data.get("language", "Zulu").strip()
            
            logger.info("Translating insights to: %s", language)
            
            # Call translate service
            translated = translate(text, language)
            
            # Store in flow state
            save_response(state, "statement_translation", {
                "language": language,
                "translated_text": translated,
            })
            
            return jsonify({
                "success": True,
                "message": f"Translated to {language} successfully",
                "language": language,
                "translated_text": translated,
            }), 200
            
        except Exception as exc:
            logger.error("Translation failed: %s", exc)
            set_error(state, f"Translation failed: {exc}")
            return jsonify({"error": f"Translation failed: {exc}"}), 500

    @app.route("/api/statement-flow", methods=["POST"])
    def statement_flow():
        """
        Complete flow: Upload → Process → Simplify → Translate (optional)
        Expects: JSON body with 'file_path', and optionally 'language' for translation
        Returns: All stages of processing
        """
        state = current_state()
        
        try:
            data = request.get_json() or {}
            file_path = data.get("file_path", "").strip()
            language = data.get("language", None)
            
            if not file_path:
                return jsonify({"error": "Missing file_path"}), 400
            
            # Security check
            file_path = Path(file_path).resolve()
            uploads_dir = (export_dir / "uploads").resolve()
            if not str(file_path).startswith(str(uploads_dir)):
                return jsonify({"error": "Invalid file path"}), 403
            
            logger.info("Starting statement flow: %s", file_path)
            
            # Process statement
            statement_data = process_statement(str(file_path))
            save_response(state, "statement_data", statement_data)
            
            # Simplify
            trx_history = statement_data.get("transactionHistory", {})
            insights = simplify(trx_history)
            save_response(state, "statement_insights", insights)
            
            result = {
                "success": True,
                "statement_data": statement_data,
                "insights": insights,
            }
            
            # Translate if language specified
            if language:
                translated = translate(insights, language)
                save_response(state, "statement_translation", {
                    "language": language,
                    "text": translated,
                })
                result["translation"] = {
                    "language": language,
                    "text": translated,
                }
            
            logger.info("Statement flow completed successfully")
            return jsonify(result), 200
            
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        except Exception as exc:
            logger.error("Statement flow failed: %s", exc)
            set_error(state, f"Statement flow failed: {exc}")
            return jsonify({"error": str(exc)}), 500

    # ── Financial Insights Visualization (New) ────────────────────────────────

    @app.route("/api/generate-insights", methods=["POST"])
    def generate_insights():
        """
        Generate financial insight visualizations from transaction data.
        Expects: JSON body with 'data' (transaction data) or uses stored statement_data
        Returns: Visualization metadata and summary statistics
        """
        state = current_state()
        
        try:
            request_data = request.get_json() or {}
            
            # Get transaction data from request or state
            transaction_data = request_data.get("data")
            if not transaction_data:
                transaction_data = state.responses.get("statement_data")
            
            if not transaction_data:
                return jsonify({"error": "No transaction data available. Process a statement first."}), 400
            
            logger.info("Generating financial insights visualizations")
            
            # Initialize visualizer
            visualizations_dir = export_dir / "visualizations"
            visualizer = FinancialInsightsVisualizer(str(visualizations_dir))
            
            # Generate all insights
            insights_result = visualizer.generate_all_insights(transaction_data)
            
            # Store in flow state
            save_response(state, "visualizations", insights_result)
            
            logger.info("Generated %d visualizations", len(insights_result.get("visualizations", [])))
            
            return jsonify({
                "success": True,
                "message": "Financial insights generated successfully",
                "data": insights_result,
            }), 200
            
        except Exception as exc:
            logger.error("Insight generation failed: %s", exc)
            set_error(state, f"Insight generation failed: {exc}")
            return jsonify({"error": f"Insight generation failed: {exc}"}), 500

    @app.route("/api/visualizations/<int:index>", methods=["GET"])
    def get_visualization(index: int):
        """
        Get details of a specific visualization.
        
        Args:
            index: Index of the visualization
        
        Returns: Visualization metadata
        """
        state = current_state()
        
        try:
            visualizations = state.responses.get("visualizations", {}).get("visualizations", [])
            
            if index < 0 or index >= len(visualizations):
                return jsonify({"error": "Visualization index out of range"}), 404
            
            visualization = visualizations[index]
            
            return jsonify({
                "success": True,
                "visualization": visualization,
            }), 200
            
        except Exception as exc:
            logger.error("Failed to retrieve visualization: %s", exc)
            return jsonify({"error": f"Failed to retrieve visualization: {exc}"}), 500

    @app.route("/api/visualizations-list", methods=["GET"])
    def list_visualizations():
        """
        Get list of all generated visualizations.
        
        Returns: List of visualization metadata
        """
        state = current_state()
        
        try:
            visualizations = state.responses.get("visualizations", {})
            
            if not visualizations:
                return jsonify({
                    "success": True,
                    "message": "No visualizations generated yet",
                    "visualizations": [],
                }), 200
            
            return jsonify({
                "success": True,
                "message": f"Found {len(visualizations.get('visualizations', []))} visualizations",
                "generated_at": visualizations.get("generated_at"),
                "transaction_count": visualizations.get("transaction_count"),
                "summary": visualizations.get("summary"),
                "visualizations": [
                    {
                        "index": i,
                        "type": v.get("type"),
                        "title": v.get("title"),
                        "description": v.get("description"),
                        "filename": v.get("filename"),
                    }
                    for i, v in enumerate(visualizations.get("visualizations", []))
                ],
            }), 200
            
        except Exception as exc:
            logger.error("Failed to list visualizations: %s", exc)
            return jsonify({"error": f"Failed to list visualizations: {exc}"}), 500

    @app.route("/api/visualization-image/<filename>", methods=["GET"])
    def get_visualization_image(filename: str):
        """
        Serve a visualization image file.
        
        Args:
            filename: Name of the image file
        
        Returns: Image file with appropriate MIME type
        """
        try:
            # Security: validate filename is safe
            filename = secure_filename(filename)
            
            visualizations_dir = export_dir / "visualizations"
            file_path = visualizations_dir / filename
            
            # Ensure file exists and is in the visualizations directory
            if not file_path.exists():
                return jsonify({"error": "File not found"}), 404
            
            if not str(file_path.resolve()).startswith(str(visualizations_dir.resolve())):
                return jsonify({"error": "Invalid file path"}), 403
            
            logger.info("Serving visualization image: %s", filename)
            
            # Determine MIME type
            if filename.endswith(".png"):
                mime_type = "image/png"
            elif filename.endswith(".jpg") or filename.endswith(".jpeg"):
                mime_type = "image/jpeg"
            else:
                mime_type = "application/octet-stream"
            
            return send_file(str(file_path), mimetype=mime_type), 200
            
        except Exception as exc:
            logger.error("Failed to serve visualization image: %s", exc)
            return jsonify({"error": f"Failed to serve image: {exc}"}), 500

    @app.route("/api/insights-summary", methods=["GET"])
    def get_insights_summary():
        """
        Get summary statistics of generated insights.
        
        Returns: Summary statistics and metrics
        """
        state = current_state()
        
        try:
            visualizations = state.responses.get("visualizations", {})
            
            if not visualizations:
                return jsonify({
                    "success": True,
                    "message": "No insights generated yet",
                    "summary": None,
                }), 200
            
            summary = visualizations.get("summary", {})
            
            return jsonify({
                "success": True,
                "summary": summary,
                "charts_available": bool(visualizations.get("charts_json")),
            }), 200
            
        except Exception as exc:
            logger.error("Failed to get insights summary: %s", exc)
            return jsonify({"error": f"Failed to get summary: {exc}"}), 500
