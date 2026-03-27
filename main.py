from api import create_app
from absa_flow.absa_client import AbsaPlaypenClient
from absa_flow.config import Settings
from absa_flow.logging_utils import configure_logging


def ping_playpen() -> None:
    settings = Settings.from_env()
    logger = configure_logging()
    client = AbsaPlaypenClient(settings=settings, logger=logger)
    token = client.get_oauth_token()
    print(f"Token OK: {token[:30]}...")


def main() -> None:
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "ping":
        ping_playpen()
        return

    app = create_app()
    app.run(debug=True, port=5000)


if __name__ == "__main__":
    main()
