import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    playpen_key: str
    playpen_secret: str
    static_token: str
    gateway_host: str
    token_url: str
    consent_url: str
    ais_url: str
    trx_list_url: str
    trx_history_url: str
    surecheck_create_url: str
    surecheck_respond_url: str
    surecheck_list_url: str
    org_name: str
    org_id: str
    merchant_id: str
    secret_key: str

    @classmethod
    def from_env(cls) -> "Settings":
        load_dotenv()
        token_host = "https://www.api.absa.africa"
        gateway_host = os.getenv("GATEWAY_HOST", "https://gw-sb.api.absa.africa")
        return cls(
            playpen_key=os.getenv("playpen_key", ""),
            playpen_secret=os.getenv("playpen_secret", ""),
            static_token=os.getenv("token", ""),
            gateway_host=gateway_host,
            token_url=f"{token_host}/oauth2/token",
            consent_url=f"{gateway_host}/consentPlaypen/1.0.3/ConsentRequest",
            ais_url=f"{gateway_host}/accountInfo/1.0.2/AccountInformationRequest",
            trx_list_url=f"{gateway_host}/accountInfo/1.0.2/TrxListRequest",
            trx_history_url=f"{gateway_host}/PlaypenTrxHistory/1.1.9/TrxHistoryConsentRequest",
            surecheck_create_url=f"{gateway_host}/sureCheckSimulator/1.0.2/surecheck",
            surecheck_respond_url=f"{gateway_host}/sureCheckSimulator/1.0.2/surecheckResponse",
            surecheck_list_url=f"{gateway_host}/sureCheckSimulator/1.0.2/listSureChecks",
            org_name=os.getenv("ORG_NAME", "LekkerFi"),
            org_id=os.getenv("requesting_org_id", "C90200F0-60E7-4E40-9C4B-83940CF12D6B"),
            merchant_id=os.getenv("merchant_id", "6E882387-5957-4389-BB62-558DF6EC04A1"),
            secret_key=os.getenv("FLASK_SECRET_KEY", os.urandom(24).hex()),
        )
