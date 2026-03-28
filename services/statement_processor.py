"""
Processes bank statement images/PDFs to extract transaction data.
Converts them to JSON format compatible with the simplification service.
Uses GPT-4 Vision to extract and parse transaction details.
"""

import base64
import json
import os
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()


def _get_client(model: str = "gpt-4o") -> tuple[OpenAI, str]:
    """Get OpenAI client and model name."""
    api_key = os.getenv("OPENAI_API_KEY") or os.getenv("openai_key")
    if not api_key:
        raise ValueError("OpenAI API key not found. Set OPENAI_API_KEY in your environment.")
    return OpenAI(api_key=api_key), model


def _encode_file_to_base64(file_path: str) -> str:
    """Encode a file to base64 for the API."""
    with open(file_path, "rb") as file:
        return base64.standard_b64encode(file.read()).decode("utf-8")


def _get_media_type(file_path: str) -> str:
    """Determine the media type based on file extension."""
    ext = Path(file_path).suffix.lower()
    media_types = {
        ".pdf": "application/pdf",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
    }
    if ext not in media_types:
        raise ValueError(f"Unsupported file type: {ext}. Supported: {list(media_types.keys())}")
    return media_types[ext]


def process_statement(file_path: str) -> dict:
    """
    Process a bank statement PDF or image file and extract transaction data.
    
    Args:
        file_path: Path to the PDF or image file
    
    Returns:
        dict with keys:
        - transactions: List of extracted transactions
        - account_info: Dict with account details
        - metadata: Processing metadata
    
    Raises:
        ValueError: If file type is not supported or cannot be processed
    """
    if not os.path.exists(file_path):
        raise ValueError(f"File not found: {file_path}")
    
    client, model = _get_client()
    media_type = _get_media_type(file_path)
    file_data = _encode_file_to_base64(file_path)
    
    # Build the message content using OpenAI's content format
    filename = Path(file_path).name
    if media_type == "application/pdf":
        content = [
            {
                "type": "file",
                "file": {
                    "filename": filename,
                    "file_data": f"data:{media_type};base64,{file_data}",
                },
            },
            {
                "type": "text",
                "text": _get_extraction_prompt(),
            },
        ]
    else:
        # Image file
        content = [
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:{media_type};base64,{file_data}",
                },
            },
            {
                "type": "text",
                "text": _get_extraction_prompt(),
            },
        ]
    
    # Call GPT to extract transaction data
    completion = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a financial document analyzer. Extract transaction data from bank statements "
                    "and images. Return ONLY valid JSON with no additional text, explanations, or markdown."
                ),
            },
            {
                "role": "user",
                "content": content,
            },
        ],
        temperature=0.1,
    )
    
    response_text = completion.choices[0].message.content or "{}"
    
    # Parse the JSON response
    try:
        # Clean up response if it has markdown code blocks
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0]
        elif "```" in response_text:
            response_text = response_text.split("```")[1].split("```")[0]
        
        extracted_data = json.loads(response_text.strip())
    except json.JSONDecodeError as e:
        raise ValueError(f"Failed to parse GPT response as JSON: {e}\nResponse: {response_text}")
    
    # Validate and structure the extracted data
    return _structure_transaction_data(extracted_data)


def _get_extraction_prompt() -> str:
    """Get the prompt for GPT to extract transaction data."""
    return """Extract all transaction data from this bank statement. Return a JSON object with this exact structure:

{
    "account_info": {
        "account_number": "string or null",
        "account_name": "string or null",
        "account_type": "string or null",
        "current_balance": "decimal string e.g. 1234.56 or null",
        "available_balance": "decimal string e.g. 1234.56 or null"
    },
    "transactions": [
        {
            "date": "YYYY-MM-DD",
            "description": "description string",
            "amount": "decimal string, negative for debits e.g. -250.00, positive for credits e.g. 1000.00",
            "balance": "decimal string e.g. 5678.90 or null",
            "reference": "reference/cheque number or null"
        }
    ],
    "period": {
        "from_date": "YYYY-MM-DD or null",
        "to_date": "YYYY-MM-DD or null"
    }
}

Rules:
- Extract ALL visible transactions
- All monetary amounts MUST be plain decimal strings with no currency symbols, spaces, or commas (e.g. 1234.56 not R 1,234.56)
- Dates must be in YYYY-MM-DD format only
- For debits/withdrawals use negative amounts; for credits/deposits use positive
- If a balance or amount cannot be determined, use null — never use empty string
- Return ONLY the JSON object, no additional text, no markdown
"""


def _structure_transaction_data(extracted: dict) -> dict:
    """
    Structure and validate the extracted transaction data.
    Ensures it matches the format expected by simplification service.
    """
    account_info = extracted.get("account_info", {})
    transactions = extracted.get("transactions", [])
    period = extracted.get("period", {})
    
    # Normalize and validate transactions
    normalized_transactions = []
    for trx in transactions:
        normalized_trx = {
            "transactionDate": _normalize_date(trx.get("date")),
            "transactionDescription": trx.get("description", ""),
            "transactionAmount": _normalize_amount(trx.get("amount", "0")),
            "balanceAmount": _normalize_amount(trx.get("balance", "")),
            "reference": trx.get("reference", ""),
            "lineNumber": len(normalized_transactions),
            "transactionFee": "0.00",
            "transactionCategory": 0,
        }
        if normalized_trx["transactionDate"] and normalized_trx["transactionDescription"]:
            normalized_transactions.append(normalized_trx)
    
    # Build the response matching the expected format
    result = {
        "transactionHistory": {
            "availableBalance": _normalize_amount(account_info.get("available_balance")),
            "currentBalance": _normalize_amount(account_info.get("current_balance")),
            "fromAccount": account_info.get("account_number", ""),
            "fromAccountName": account_info.get("account_name", "Bank Statement Import"),
            "fromAccountType": account_info.get("account_type", ""),
            "fromDate": period.get("from_date", ""),
            "toDate": period.get("to_date", datetime.now().strftime("%Y-%m-%d")),
            "unclearedEffectsAmount": "0.00",
            "unclearedEffectsEnabled": False,
            "unclearedEffectsExist": False,
            "powerOfAttorney": False,
            "stampedTransactionHistory": False,
            "accountHistoryLines": normalized_transactions,
            "statementType": "BANK_STATEMENT_IMPORT",
            "fromControlAccount": 0,
        },
        "resultCode": 200,
        "requestId": "",
        "timestamp": datetime.now().isoformat(),
    }
    
    return result


def _normalize_date(date_str: str) -> str:
    """Normalize a date string to YYYY-MM-DD format."""
    if not date_str:
        return ""
    
    date_str = date_str.strip()
    
    # Try various date formats
    formats = ["%Y-%m-%d", "%d-%m-%Y", "%m/%d/%Y", "%Y/%m/%d", "%d/%m/%Y"]
    
    for fmt in formats:
        try:
            parsed = datetime.strptime(date_str.split()[0], fmt)  # Handle time part if present
            return parsed.strftime("%Y-%m-%d")
        except ValueError:
            continue
    
    # If no format matched, return as-is
    return date_str


def _normalize_amount(amount_str: str) -> str:
    """
    Normalize an amount string to a decimal format.
    Handles currency symbols and various formats.
    """
    if not amount_str or isinstance(amount_str, (int, float)):
        return "0.00"
    
    amount_str = str(amount_str).strip()
    
    # Remove currency symbols and whitespace
    amount_str = amount_str.replace("R", "").replace("$", "").replace(",", "").strip()
    
    try:
        amount = float(amount_str)
        return f"{amount:.2f}"
    except ValueError:
        return "0.00"
