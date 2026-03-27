import os
import secrets

from dotenv import load_dotenv
from flask import Flask
from flask_jwt_extended import JWTManager

from absa_flow.absa_client import AbsaPlaypenClient
from absa_flow.config import Settings
from absa_flow.logging_utils import configure_logging
from db.database import init_db


def create_app() -> Flask:
    load_dotenv()
    app = Flask(__name__)

    app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY", secrets.token_hex(32))
    JWTManager(app)

    settings = Settings.from_env()
    logger = configure_logging()
    client = AbsaPlaypenClient(settings=settings, logger=logger)
    app.config["ABSA_CLIENT"] = client
    app.config["ABSA_SETTINGS"] = settings

    init_db()

    from api.auth import auth_bp
    from api.absa import absa_bp
    from api.insights import insights_bp

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(absa_bp, url_prefix="/api/absa")
    app.register_blueprint(insights_bp, url_prefix="/api/insights")

    return app
