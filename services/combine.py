"""
Merges a list of TrxHistory API responses into a single combined dict
ready for the simplification pipeline. No file I/O.
"""

import re
from datetime import datetime
from decimal import Decimal

TRANSFER_TO_RE = re.compile(r"Trf to acc (\d+)", re.IGNORECASE)
TRANSFER_FROM_RE = re.compile(r"Trf from acc (\d+)", re.IGNORECASE)


def _detect_transfer(description: str) -> tuple[str | None, str | None]:
    m = TRANSFER_TO_RE.search(description)
    if m:
        return m.group(1), None
    m = TRANSFER_FROM_RE.search(description)
    if m:
        return None, m.group(1)
    return None, None


def _parse_account(raw: dict) -> dict:
    th = raw["transactionHistory"]
    transactions = []
    for line in sorted(
        th["accountHistoryLines"],
        key=lambda x: (x["transactionDate"], -x["lineNumber"]),
    ):
        desc = line["transactionDescription"]
        transfer_to, transfer_from = _detect_transfer(desc)
        transactions.append({
            "date": line["transactionDate"],
            "description": desc,
            "amount": line["transactionAmount"],
            "balance_after": line["balanceAmount"],
            "fee": line["transactionFee"],
            "category": line["transactionCategory"],
            "transfer_to_account": transfer_to,
            "transfer_from_account": transfer_from,
        })

    return {
        "account_number": th["fromAccount"],
        "account_name": th["fromAccountName"],
        "account_type": th["fromAccountType"],
        "current_balance": th["currentBalance"],
        "available_balance": th["availableBalance"],
        "uncleared_effects_amount": th.get("unclearedEffectsAmount"),
        "uncleared_effects_exist": th.get("unclearedEffectsExist", False),
        "period_from": th["fromDate"],
        "period_to": th["toDate"],
        "transactions": transactions,
    }


def combine_transactions(trx_history_responses: list[dict]) -> dict:
    """
    Takes a list of raw TrxHistoryConsentRequest API responses and returns
    a combined dict suitable for the simplification service.
    """
    accounts = []
    period_froms = []
    period_tos = []

    for raw in trx_history_responses:
        if raw.get("resultCode") != 200:
            continue
        account = _parse_account(raw)
        accounts.append(account)
        period_froms.append(account["period_from"])
        period_tos.append(account["period_to"])

    if not accounts:
        raise ValueError("No successful TrxHistory responses to combine.")

    total_current = sum(Decimal(a["current_balance"]) for a in accounts)
    total_available = sum(Decimal(a["available_balance"]) for a in accounts)
    total_transactions = sum(len(a["transactions"]) for a in accounts)

    return {
        "combined_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
        "export_period": {
            "from": min(period_froms),
            "to": max(period_tos),
        },
        "accounts": accounts,
        "summary": {
            "total_accounts": len(accounts),
            "total_transactions": total_transactions,
            "combined_current_balance": str(total_current),
            "combined_available_balance": str(total_available),
        },
    }
