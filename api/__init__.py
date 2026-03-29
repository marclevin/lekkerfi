import os
import secrets
from datetime import timedelta
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, send_from_directory
from flask_jwt_extended import JWTManager

from absa_flow.absa_client import AbsaPlaypenClient
from absa_flow.config import Settings
from absa_flow.logging_utils import configure_logging
from db.database import init_db

_VIZ_DIR = Path(__file__).resolve().parent.parent / "exports" / "visualizations"


def _get_jwt_secret() -> str:
    """
    Return a stable JWT secret across server restarts.
    Priority: JWT_SECRET_KEY env var (if ≥32 bytes) → .jwt_secret file → generate + persist.
    """
    env_secret = os.getenv("JWT_SECRET_KEY", "")
    if len(env_secret.encode()) >= 32:
        return env_secret

    secret_file = Path(".jwt_secret")
    if secret_file.exists():
        stored = secret_file.read_text().strip()
        if len(stored.encode()) >= 32:
            return stored

    secret = secrets.token_hex(32)  # 64-char hex = 32 bytes
    secret_file.write_text(secret)
    return secret


def create_app() -> Flask:
    load_dotenv()
    app = Flask(__name__)

    app.config["JWT_SECRET_KEY"] = _get_jwt_secret()
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(days=30)
    app.config["VIZ_CACHE"] = {}
    app.config["ACCESSIBLE_INSIGHTS_CACHE"] = {}
    app.config["AUTH_ASSIST_TICKETS"] = {}
    JWTManager(app)

    settings = Settings.from_env()
    logger = configure_logging()
    client = AbsaPlaypenClient(settings=settings, logger=logger)
    app.config["ABSA_CLIENT"] = client
    app.config["ABSA_SETTINGS"] = settings

    init_db()

    from api.auth import auth_bp
    from api.absa import absa_bp
    from api.chat import chat_bp
    from api.insights import insights_bp
    from api.statements import statements_bp
    from api.supporters import supporters_bp

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(absa_bp, url_prefix="/api/absa")
    app.register_blueprint(chat_bp, url_prefix="/api/chat")
    app.register_blueprint(insights_bp, url_prefix="/api/insights")
    app.register_blueprint(statements_bp, url_prefix="/api/statements")
    app.register_blueprint(supporters_bp, url_prefix="/api/supporters")

    @app.route("/api/visualizations/<path:filename>")
    def serve_visualization(filename):
        return send_from_directory(str(_VIZ_DIR), filename)

    return app
