from pathlib import Path

from flask import Flask

from .absa_client import AbsaPlaypenClient
from .config import Settings
from .logging_utils import configure_logging
from .routes import register_routes


def create_app() -> Flask:
    settings = Settings.from_env()
    logger = configure_logging()

    logger.info("=== LekkerFi modular app starting ===")
    logger.info("Gateway host: %s", settings.gateway_host)

    template_dir = Path(__file__).resolve().parent.parent / "templates"
    static_dir = Path(__file__).resolve().parent.parent / "static"
    app = Flask(__name__, template_folder=str(template_dir), static_folder=str(static_dir))
    app.config["SECRET_KEY"] = settings.secret_key

    client = AbsaPlaypenClient(settings=settings, logger=logger)
    register_routes(app=app, client=client, logger=logger)
    return app
