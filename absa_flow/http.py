import logging

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


class LoggedSessionFactory:
    def __init__(self, logger: logging.Logger, playpen_secret: str):
        self.logger = logger
        self.playpen_secret = playpen_secret

    def _log_response(self, response: requests.Response, *args, **kwargs) -> None:
        request = response.request
        self.logger.debug(">>> %s %s", request.method, request.url)
        safe_headers = {
            key: ("***" if key.lower() in ("authorization", "apikey") else value)
            for key, value in request.headers.items()
        }
        self.logger.debug("    req headers : %s", safe_headers)

        body = request.body
        if isinstance(body, memoryview):
            body = bytes(body)
        if isinstance(body, bytes):
            body = body.decode("utf-8", errors="replace")
        if isinstance(body, str) and body:
            masked = body.replace(self.playpen_secret, "***") if self.playpen_secret else body
            self.logger.debug("    req body    : %s", masked)

        self.logger.debug("<<< %s %s", response.status_code, response.reason)
        self.logger.debug("    resp headers: %s", dict(response.headers))
        self.logger.debug("    resp body   : %s", response.text[:2000])

    def create(self) -> requests.Session:
        session = requests.Session()
        session.verify = False
        session.hooks["response"].append(self._log_response)
        return session
