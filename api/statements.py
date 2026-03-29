import json
import threading
import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from werkzeug.utils import secure_filename

from db.database import SessionLocal
from db.models import Insight, Statement, SupporterNotification, Translation, User, UserSupporter
from services.combine import combine_transactions
from services.simplify import simplify
from services.statement_processor import process_statement
from services.translate import translate

statements_bp = Blueprint("statements", __name__)

UPLOAD_FOLDER = Path("uploads")
ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".webp"}


def _allowed(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


def _process_statement_background(statement_id: int, file_path: str, original_name: str, language: str, user_id: int) -> None:
    """Run OCR → simplify → translate in a background thread, then update the DB."""
    db = SessionLocal()
    try:
        stmt = db.get(Statement, statement_id)
        if not stmt:
            return

        trx_response = process_statement(file_path)
        combined = combine_transactions([trx_response])
        simplified_text = simplify(combined)
        translated_text = translate(simplified_text, language)

        th = trx_response.get("transactionHistory", {})
        account_label = th.get("fromAccountName") or original_name

        insight = Insight(
            user_id=user_id,
            selected_accounts=json.dumps([account_label]),
            raw_transactions=json.dumps(combined),
            simplified_text=simplified_text,
        )
        db.add(insight)
        db.flush()

        translation = Translation(
            insight_id=insight.id,
            language=language,
            translated_text=translated_text,
        )
        db.add(translation)

        stmt.status = "done"
        stmt.insight_id = insight.id
        db.commit()

    except Exception as exc:
        db.rollback()
        try:
            stmt2 = db.get(Statement, statement_id)
            if stmt2:
                stmt2.status = "error"
                stmt2.error_message = str(exc)[:500]
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


@statements_bp.post("/upload")
@jwt_required()
def upload_statement():
    """
    Accepts a multipart/form-data upload with fields:
      - file: the statement file (PDF, JPG, PNG, WebP)
      - language: translation language (default: xhosa)

    Saves the file and returns immediately (status: processing).
    Insight generation runs in a background thread.
    Poll GET /statements/<id>/status to check when ready.
    """
    user_id = int(get_jwt_identity())

    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({"error": "No file selected"}), 400

    original_name = secure_filename(file.filename)
    if not _allowed(original_name):
        return jsonify({"error": "Unsupported file type. Use PDF, JPG, PNG, or WebP."}), 400

    language = (request.form.get("language") or "xhosa").strip()

    UPLOAD_FOLDER.mkdir(exist_ok=True)
    suffix = Path(original_name).suffix.lower()
    saved_name = f"{user_id}_{uuid.uuid4().hex}{suffix}"
    file_path = str(UPLOAD_FOLDER / saved_name)
    file.save(file_path)

    db = SessionLocal()
    try:
        stmt_record = Statement(
            user_id=user_id,
            original_filename=original_name,
            file_path=file_path,
            status="processing",
        )
        db.add(stmt_record)
        db.commit()
        db.refresh(stmt_record)
        statement_id = stmt_record.id
    finally:
        db.close()

    # Launch background processing
    t = threading.Thread(
        target=_process_statement_background,
        args=(statement_id, file_path, original_name, language, user_id),
        daemon=True,
    )
    t.start()

    return jsonify({
        "statement_id": statement_id,
        "status": "processing",
        "message": "Your statement is being analysed. Check back in a moment.",
    }), 202


@statements_bp.get("/")
@jwt_required()
def list_statements():
    """Returns all uploaded statements for the authenticated user, newest first."""
    user_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        stmts = (
            db.query(Statement)
            .filter_by(user_id=user_id)
            .order_by(Statement.created_at.desc())
            .all()
        )
        result = []
        for s in stmts:
            item = {
                "id": s.id,
                "original_filename": s.original_filename,
                "status": s.status,
                "error_message": s.error_message,
                "created_at": s.created_at.isoformat(),
                "insight": None,
            }
            if s.insight:
                item["insight"] = {
                    "id": s.insight.id,
                    "simplified": s.insight.simplified_text,
                    "accounts": json.loads(s.insight.selected_accounts),
                    "translations": [
                        {"id": t.id, "language": t.language}
                        for t in s.insight.translations
                    ],
                }
            result.append(item)
        return jsonify({"statements": result})
    finally:
        db.close()


@statements_bp.get("/<int:statement_id>/status")
@jwt_required()
def statement_status(statement_id: int):
    """Poll this endpoint to check background processing progress."""
    user_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        stmt = db.query(Statement).filter_by(id=statement_id, user_id=user_id).first()
        if not stmt:
            return jsonify({"error": "Statement not found"}), 404
        return jsonify({
            "statement_id": stmt.id,
            "status": stmt.status,
            "error_message": stmt.error_message,
            "insight_id": stmt.insight_id,
        })
    finally:
        db.close()


@statements_bp.delete("/<int:statement_id>")
@jwt_required()
def delete_statement(statement_id: int):
    """Delete an uploaded statement and its linked insight. Notifies all linked supporters."""
    user_id = int(get_jwt_identity())
    db = SessionLocal()
    try:
        stmt = db.query(Statement).filter_by(id=statement_id, user_id=user_id).first()
        if not stmt:
            return jsonify({"error": "Statement not found"}), 404

        filename = stmt.original_filename

        # Delete the physical file
        try:
            Path(stmt.file_path).unlink(missing_ok=True)
        except Exception:
            pass

        # Delete linked insight (cascades translations)
        if stmt.insight_id:
            insight = db.query(Insight).filter_by(id=stmt.insight_id).first()
            if insight:
                db.delete(insight)

        db.delete(stmt)

        # Notify all registered linked supporters
        user = db.query(User).filter_by(id=user_id).first()
        user_name = user.full_name or user.email if user else "Your user"
        supporter_links = db.query(UserSupporter).filter_by(user_id=user_id).all()
        for link in supporter_links:
            if link.linked_supporter_id:
                notif = SupporterNotification(
                    from_user_id=user_id,
                    to_user_id=link.linked_supporter_id,
                    message=f"{user_name} deleted an uploaded bank statement: {filename}",
                )
                db.add(notif)

        db.commit()
        return jsonify({"deleted": True})
    finally:
        db.close()
