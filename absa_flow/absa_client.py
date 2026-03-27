import json
import uuid
from typing import Any

from .config import Settings
from .http import LoggedSessionFactory


class AbsaPlaypenClient:
    def __init__(self, settings: Settings, logger):
        self.settings = settings
        self.logger = logger
        self._session_factory = LoggedSessionFactory(logger, settings.playpen_secret)

    # ── Auth ──────────────────────────────────────────────────────────────────

    def get_oauth_token(self) -> str:
        if self.settings.static_token:
            self.logger.info("Token: using static token from env")
            return self.settings.static_token

        if not self.settings.playpen_key or not self.settings.playpen_secret:
            raise ValueError("playpen_key and playpen_secret must be set in the environment")

        self.logger.info("Token: requesting OAuth token")
        response = self._session_factory.create().post(
            self.settings.token_url,
            data={"grant_type": "client_credentials"},
            auth=(self.settings.playpen_key, self.settings.playpen_secret),
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=20,
        )
        response.raise_for_status()
        token = response.json()["access_token"]
        self.logger.info("Token: success")
        return token

    def playpen_headers(self, token: str) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {token}",
            "ApiKey": self.settings.playpen_key,
            "Content-Type": "application/json",
        }

    # ── Consent ───────────────────────────────────────────────────────────────

    def create_consent(
        self,
        *,
        token: str,
        access_account: str,
        user_number: str,
        org_name: str,
        org_id: str,
        merchant_id: str,
        reference_number: str,
    ) -> dict[str, Any]:
        self.logger.info("Consent: requesting long-lived consent for account=%s", access_account)
        payload = {
            "requestId": str(uuid.uuid4()),
            "accessAccount": access_account,
            "userNumber": user_number,
            "purposeCode": "0002",
            "requestingOrgName": org_name,
            "requestingOrgId": org_id,
            "merchantId": merchant_id,
            "referenceNumber": reference_number,
        }
        self.logger.debug("Consent payload: %s", json.dumps(payload, indent=2))
        result = self._post(
            self.settings.consent_url,
            token=token,
            payload=payload,
            extra_headers={"sync-response": "true"},
        )
        self.logger.info(
            "Consent: resultCode=%s transactionId=%s",
            result.get("resultCode"),
            result.get("transactionId", ""),
        )
        return result

    # ── SureCheck ─────────────────────────────────────────────────────────────

    def create_surecheck(
        self,
        *,
        token: str,
        transaction_id: str,
        org_name: str,
        access_account: str,
    ) -> dict[str, Any]:
        self.logger.info("SureCheck create: Long-term for transactionId=%s", transaction_id)
        payload = {
            "type": "Long-term",
            "reason": "Long-lived account information and transaction data access for LekkerFi",
            "organisation": org_name,
            "absaReference": transaction_id,
            "requestId": str(uuid.uuid4()),
            "customerReference": f"REF-{access_account[:8]}",
        }
        self.logger.debug("SureCheck create payload: %s", json.dumps(payload, indent=2))
        result = self._post(self.settings.surecheck_create_url, token=token, payload=payload)
        self.logger.info("SureCheck create: done")
        return result

    def list_surechecks(self, *, token: str, user_email: str) -> list[dict[str, Any]]:
        self.logger.info("SureCheck list: fetching for userId=%s", user_email)
        payload = {"userId": user_email}
        result = self._post(self.settings.surecheck_list_url, token=token, payload=payload)
        # listSureChecks returns an array directly
        if isinstance(result, list):
            self.logger.info("SureCheck list: found %d items", len(result))
            return result
        # Wrapped in an object — extract
        items = result.get("data", result.get("items", []))
        self.logger.info("SureCheck list: found %d items", len(items))
        return items

    def respond_surecheck(self, *, token: str, absa_reference: str, action: str) -> dict[str, Any]:
        self.logger.info("SureCheck respond: absaReference=%s action=%s", absa_reference, action)
        payload = {"absaReference": absa_reference, "status": action}
        result = self._post(self.settings.surecheck_respond_url, token=token, payload=payload)
        self.logger.info("SureCheck respond: resultCode=%s", result.get("resultCode"))
        return result

    # ── AIS ───────────────────────────────────────────────────────────────────

    def fetch_accounts(
        self,
        *,
        token: str,
        access_account: str,
        user_number: str,
        org_name: str,
        org_id: str,
        reference_number: str,
    ) -> dict[str, Any]:
        self.logger.info("AIS accounts: fetching for account=%s", access_account)
        payload = {
            "requestId": str(uuid.uuid4()),
            "userNumber": user_number,
            "accountNumber": access_account,
            "purposeCode": "0002",
            "requestingOrgName": org_name,
            "requestingOrgId": org_id,
            "referenceNumber": reference_number,
        }
        self.logger.debug("AIS accounts payload: %s", json.dumps(payload, indent=2))
        result = self._post(self.settings.ais_url, token=token, payload=payload)
        self.logger.info("AIS accounts: resultCode=%s accounts=%d",
                         result.get("resultCode"), len(result.get("accounts", [])))
        return result

    def fetch_transactions(
        self,
        *,
        token: str,
        access_account: str,
        target_account_number: str,
        user_number: str,
        org_name: str,
        org_id: str,
        reference_number: str,
        selected_date: str,
    ) -> dict[str, Any]:
        self.logger.info(
            "AIS transactions: account=%s target=%s date=%s",
            access_account, target_account_number, selected_date,
        )
        payload = {
            "requestId": str(uuid.uuid4()),
            "accountNumber": access_account,
            "userNumber": user_number,
            "targetAccountNumber": target_account_number,
            "purposeCode": "0002",
            "requestingOrgName": org_name,
            "requestingOrgId": org_id,
            "referenceNumber": reference_number,
            "selectedDate": selected_date,
        }
        self.logger.debug("TrxList payload: %s", json.dumps(payload, indent=2))
        result = self._post(self.settings.trx_list_url, token=token, payload=payload)
        self.logger.info("AIS transactions: resultCode=%s", result.get("resultCode"))
        return result

    # ── TrxHistory (one-time consent) ────────────────────────────────────────

    def fetch_trx_history(
        self,
        *,
        token: str,
        account_number: str,
        org_name: str,
        org_id: str,
        from_date: str,
        to_date: str,
        document_format: str = "JSON",
    ) -> dict[str, Any]:
        self.logger.info(
            "TrxHistory: account=%s from=%s to=%s", account_number, from_date, to_date
        )
        payload = {
            "requestId": str(uuid.uuid4()),
            "accountNumber": account_number,
            "purposeCode": "0001",
            "documentFormat": document_format,
            "fromDate": from_date,
            "toDate": to_date,
            "requestingOrgName": org_name,
            "requestingOrgId": org_id,
        }
        self.logger.debug("TrxHistory payload: %s", json.dumps(payload, indent=2))
        result = self._post(
            self.settings.trx_history_url,
            token=token,
            payload=payload,
            extra_headers={"sync-response": "true"},
        )
        self.logger.info("TrxHistory: resultCode=%s", result.get("resultCode"))
        return result

    # ── Internal ──────────────────────────────────────────────────────────────

    def _post(
        self,
        url: str,
        *,
        token: str,
        payload: dict[str, Any],
        extra_headers: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        headers = self.playpen_headers(token)
        if extra_headers:
            headers.update(extra_headers)

        response = self._session_factory.create().post(
            url,
            json=payload,
            headers=headers,
            timeout=20,
        )
        response.raise_for_status()
        return response.json()
