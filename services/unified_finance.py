import json
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation

from db.models import UnifiedFinanceSnapshot, UnifiedTransaction


def _to_decimal(value):
    if value is None or value == '':
        return Decimal('0')
    try:
        return Decimal(str(value).replace('R', '').replace(',', '').strip())
    except (InvalidOperation, ValueError):
        return Decimal('0')


def _parse_transaction_date(transaction_date):
    if not transaction_date:
        return None

    text = str(transaction_date).strip()
    if not text:
        return None

    candidates = [text, text[:10], text.replace('/', '-').replace('.', '-')]
    for candidate in candidates:
        try:
            return date.fromisoformat(candidate[:10])
        except ValueError:
            pass

    for fmt in ('%d-%m-%Y', '%m-%d-%Y', '%d/%m/%Y', '%m/%d/%Y', '%d.%m.%Y'):
        try:
            return datetime.strptime(text[:10], fmt).date()
        except ValueError:
            continue

    return None


def _within_window(transaction_date, cutoff):
    parsed = _parse_transaction_date(transaction_date)
    # Keep unparseable dates instead of dropping finance rows silently.
    if parsed is None:
        return True
    return parsed >= cutoff


def ingest_combined_transactions(db, *, user_id, source_type, source_ref, combined):
    if source_type not in {'absa', 'statement'}:
        raise ValueError('source_type must be absa or statement')

    # Idempotent write for a specific source event.
    (
        db.query(UnifiedTransaction)
        .filter_by(user_id=user_id, source_type=source_type, source_ref=str(source_ref))
        .delete(synchronize_session=False)
    )

    accounts = combined.get('accounts', []) if isinstance(combined, dict) else []
    for account in accounts:
        base = {
            'account_number': account.get('account_number'),
            'account_name': account.get('account_name'),
            'account_type': account.get('account_type'),
        }
        for tx in account.get('transactions', []) or []:
            row = UnifiedTransaction(
                user_id=user_id,
                source_type=source_type,
                source_ref=str(source_ref),
                account_number=base['account_number'],
                account_name=base['account_name'],
                account_type=base['account_type'],
                transaction_date=tx.get('date'),
                description=tx.get('description'),
                amount=_to_decimal(tx.get('amount')),
                balance_after=_to_decimal(tx.get('balance_after')),
                fee=_to_decimal(tx.get('fee')),
                category=str(tx.get('category')) if tx.get('category') is not None else None,
                transfer_to_account=tx.get('transfer_to_account'),
                transfer_from_account=tx.get('transfer_from_account'),
            )
            db.add(row)


def _build_combined_from_rows(rows, *, window_from, window_to):
    grouped = {}
    for row in rows:
        account_key = row.account_number or f"{row.source_type}:{row.source_ref}:{row.account_name or 'account'}"
        account = grouped.get(account_key)
        if account is None:
            account = {
                'account_number': row.account_number or account_key,
                'account_name': row.account_name or row.account_number or 'Account',
                'account_type': row.account_type or 'unknown',
                'current_balance': '0.00',
                'available_balance': '0.00',
                'uncleared_effects_amount': None,
                'uncleared_effects_exist': False,
                'period_from': window_from,
                'period_to': window_to,
                'transactions': [],
            }
            grouped[account_key] = account

        account['transactions'].append({
            'date': row.transaction_date,
            'description': row.description or '',
            'amount': str(row.amount if row.amount is not None else Decimal('0')),
            'balance_after': str(row.balance_after if row.balance_after is not None else Decimal('0')),
            'fee': str(row.fee if row.fee is not None else Decimal('0')),
            'category': row.category or '0',
            'transfer_to_account': row.transfer_to_account,
            'transfer_from_account': row.transfer_from_account,
            'source_type': row.source_type,
            'source_ref': row.source_ref,
        })

    total_current = Decimal('0')
    total_available = Decimal('0')
    total_transactions = 0

    for account in grouped.values():
        account['transactions'].sort(key=lambda x: (x.get('date') or '', x.get('description') or ''))
        if account['transactions']:
            latest = account['transactions'][-1]
            latest_balance = _to_decimal(latest.get('balance_after'))
            account['current_balance'] = str(latest_balance)
            account['available_balance'] = str(latest_balance)
            total_current += latest_balance
            total_available += latest_balance
            total_transactions += len(account['transactions'])

    return {
        'combined_at': datetime.utcnow().strftime('%Y-%m-%d %H:%M'),
        'export_period': {
            'from': window_from,
            'to': window_to,
        },
        'accounts': list(grouped.values()),
        'summary': {
            'total_accounts': len(grouped),
            'total_transactions': total_transactions,
            'combined_current_balance': str(total_current),
            'combined_available_balance': str(total_available),
        },
    }


def rebuild_unified_snapshot(db, *, user_id, window_days=90):
    today = date.today()
    cutoff = today - timedelta(days=window_days)
    rows = db.query(UnifiedTransaction).filter_by(user_id=user_id).all()
    filtered = [r for r in rows if _within_window(r.transaction_date, cutoff)]
    if not filtered and rows:
        # Defensive fallback: keep rows if date parsing/windowing excluded all records.
        filtered = rows

    combined = _build_combined_from_rows(
        filtered,
        window_from=cutoff.isoformat(),
        window_to=today.isoformat(),
    )

    snapshot = db.query(UnifiedFinanceSnapshot).filter_by(user_id=user_id).first()
    if snapshot is None:
        snapshot = UnifiedFinanceSnapshot(
            user_id=user_id,
            window_from=cutoff.isoformat(),
            window_to=today.isoformat(),
            raw_combined_json=json.dumps(combined),
            summary_json=json.dumps(combined.get('summary', {})),
            generated_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )
        db.add(snapshot)
    else:
        snapshot.window_from = cutoff.isoformat()
        snapshot.window_to = today.isoformat()
        snapshot.raw_combined_json = json.dumps(combined)
        snapshot.summary_json = json.dumps(combined.get('summary', {}))
        snapshot.generated_at = datetime.utcnow()
        snapshot.updated_at = datetime.utcnow()

    return combined


def get_latest_unified_combined(db, *, user_id):
    snapshot = db.query(UnifiedFinanceSnapshot).filter_by(user_id=user_id).first()
    if not snapshot:
        return None
    try:
        return json.loads(snapshot.raw_combined_json)
    except Exception:
        return None
