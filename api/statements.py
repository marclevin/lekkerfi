import json
import uuid
from pathlib import Path

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from werkzeug.utils import secure_filename

from db.database import SessionLocal
from db.models import Insight, Statement, Translation
from services.combine import combine_transactions
from services.simplify import simplify
from services.statement_processor import process_statement
from services.translate import translate

statements_bp = Blueprint("statements", __name__)

UPLOAD_FOLDER = Path("uploads")
ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png", ".webp"}


def _allowed(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


@statements_bp.post("/upload")
@jwt_required()
def upload_statement():
    """
    Accepts a multipart/form-data upload with fields:
      - file: the statement file (PDF, JPG, PNG, WebP)
      - language: translation language (default: xhosa)

    Processes via GPT-4o vision, generates and persists an insight, and returns
    the same shape as /api/insights/generate.
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

    # Save file to disk before opening a DB session
    UPLOAD_FOLDER.mkdir(exist_ok=True)
    suffix = Path(original_name).suffix.lower()
    saved_name = f"{user_id}_{uuid.uuid4().hex}{suffix}"
    file_path = str(UPLOAD_FOLDER / saved_name)
    file.save(file_path)

    db = SessionLocal()
    stmt_record = Statement(
        user_id=user_id,
        original_filename=original_name,
        file_path=file_path,
        status="processing",
    )
    db.add(stmt_record)
    db.flush()  # get stmt_record.id before processing starts

    try:
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

        stmt_record.status = "done"
        stmt_record.insight_id = insight.id

        db.commit()
        db.refresh(insight)

        return jsonify({
            "statement_id": stmt_record.id,
            "insight_id": insight.id,
            "accounts": [account_label],
            "simplified": simplified_text,
            "translated": translated_text,
            "language": language,
            "created_at": insight.created_at.isoformat(),
        }), 201

    except Exception as exc:
        db.rollback()
        # Persist the error state in a fresh session so the statement record survives
        db2 = SessionLocal()
        try:
            err_record = Statement(
                user_id=user_id,
                original_filename=original_name,
                file_path=file_path,
                status="error",
                error_message=str(exc)[:500],
            )
            db2.add(err_record)
            db2.commit()
        finally:
            db2.close()
        return jsonify({"error": str(exc)}), 500
    finally:
        db.close()


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
