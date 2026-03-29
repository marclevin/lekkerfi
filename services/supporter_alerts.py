import json
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import cast

from db.models import SupporterAlert, SupporterNotification, User, UserSupporter

_SEVERITY_RANK = {"critical": 3, "warning": 2, "info": 1}


def _to_decimal(value) -> Decimal:
    if value is None:
        return Decimal("0")
    try:
        return Decimal(str(value).replace("R", "").replace(",", "").strip())
    except (InvalidOperation, ValueError):
        return Decimal("0")


def _linked_supporter_ids(db, user_id: int) -> set[int]:
    ids = set()
    user = db.get(User, user_id)
    if user and user.supporter_id:
        ids.add(int(user.supporter_id))

    for link in db.query(UserSupporter).filter(UserSupporter.user_id == user_id).all():
        if link.linked_supporter_id:
            ids.add(int(link.linked_supporter_id))
    return ids


def _build_concern_summary(coach_signals: dict) -> str:
    """Build a plain-English one-liner for the supporter alert card.

    Describes the financial/behavioural situation without naming any
    internal safety category — the supporter gets professional context,
    not a diagnostic label.
    """
    parts: list[str] = []

    purchase_amount = coach_signals.get("purchase_amount")
    safe_to_spend = coach_signals.get("safe_to_spend")
    days_to_payday = coach_signals.get("days_to_payday")

    if coach_signals.get("cannot_afford") and purchase_amount and safe_to_spend is not None:
        parts.append(
            f"user wants to spend R{purchase_amount} but only has R{safe_to_spend} safe to spend"
        )
    elif coach_signals.get("cannot_afford"):
        parts.append("user cannot afford the requested purchase")

    if coach_signals.get("runout_before_payday"):
        if days_to_payday is not None:
            parts.append(f"projected to run out of money before payday ({days_to_payday} days away)")
        else:
            parts.append("projected to run out of money before payday")

    if safe_to_spend is not None and _to_decimal(safe_to_spend) <= Decimal("0"):
        if not coach_signals.get("cannot_afford"):  # avoid double-mentioning
            parts.append("safe-to-spend is at or below zero")
    elif safe_to_spend is not None and _to_decimal(safe_to_spend) <= Decimal("500"):
        if not parts:
            parts.append(f"safe-to-spend is low (R{safe_to_spend})")

    anomaly_count = int(coach_signals.get("anomaly_count") or 0)
    if anomaly_count > 0:
        parts.append(
            f"{anomaly_count} unusual spending pattern{'s' if anomaly_count > 1 else ''} detected"
        )

    if coach_signals.get("repeated_intent"):
        parts.append("has raised this same topic multiple times in chat")

    if coach_signals.get("emotional_distress"):
        parts.append("showing signs of emotional distress in the conversation")

    urgency = str(coach_signals.get("urgency_level") or "").lower()
    if urgency == "high" and not coach_signals.get("emotional_distress"):
        parts.append("expressing high urgency")

    if coach_signals.get("safety_detected"):
        # Intentionally vague — do not expose the category name.
        parts.append("a concern was flagged that requires your personal review")

    if not parts:
        return "Supporter review recommended based on recent chat activity."

    summary = "User " + "; ".join(parts) + "."
    return summary[0].upper() + summary[1:]


def _build_alert_candidates(coach_signals: dict) -> list[dict]:
    alerts = []
    safe_to_spend_raw = coach_signals.get("safe_to_spend")
    safe_to_spend = None if safe_to_spend_raw is None else _to_decimal(safe_to_spend_raw)
    runout = bool(coach_signals.get("runout_before_payday"))
    anomaly_count = int(coach_signals.get("anomaly_count") or 0)
    days_to_payday = coach_signals.get("days_to_payday")
    pause_prompt = coach_signals.get("pause_prompt")
    supporter_flag_required = bool(coach_signals.get("supporter_flag_required"))
    supporter_priority = str(coach_signals.get("supporter_priority") or "low").lower()
    risk_score = int(coach_signals.get("risk_score") or 0)
    urgency_level = str(coach_signals.get("urgency_level") or "low")
    recommended_action = coach_signals.get("recommended_action")
    risk_tags = coach_signals.get("risk_tags") or []
    safety_detected = bool(coach_signals.get("safety_detected"))
    safety_category = coach_signals.get("safety_category")
    safety_confidence = str(coach_signals.get("safety_confidence") or "none")
    safety_label = coach_signals.get("safety_label")
    safety_evidence = coach_signals.get("safety_evidence") or []

    if runout:
        alerts.append({
            "alert_type": "payday_warning",
            "severity": "critical",
            "safe_to_spend": safe_to_spend,
            "metadata": {
                "days_to_payday": days_to_payday,
                "message": "Projected to run out before payday.",
            },
        })

    if safe_to_spend is not None:
        if safe_to_spend <= Decimal("0"):
            alerts.append({
                "alert_type": "low_balance",
                "severity": "critical",
                "safe_to_spend": safe_to_spend,
                "metadata": {
                    "message": "Safe-to-spend is at or below zero.",
                },
            })
        elif safe_to_spend <= Decimal("500"):
            alerts.append({
                "alert_type": "low_balance",
                "severity": "warning",
                "safe_to_spend": safe_to_spend,
                "metadata": {
                    "message": "Safe-to-spend is below R500.",
                },
            })

    if anomaly_count > 0:
        alerts.append({
            "alert_type": "unusual_spend",
            "severity": "warning",
            "safe_to_spend": safe_to_spend,
            "metadata": {
                "anomaly_count": anomaly_count,
                "message": "Unusual spending pattern detected.",
            },
        })

    if pause_prompt:
        alerts.append({
            "alert_type": "pause_prompt",
            "severity": "info",
            "safe_to_spend": safe_to_spend,
            "metadata": {
                "prompt": pause_prompt,
                "message": "User is considering a higher spend decision.",
            },
        })

    if supporter_flag_required:
        severity = "info"
        if supporter_priority == "high":
            severity = "critical"
        elif supporter_priority == "medium":
            severity = "warning"

        if safety_detected and safety_confidence == "high":
            severity = "critical"
        elif safety_detected and safety_confidence == "medium" and severity == "info":
            severity = "warning"

        alerts.append({
            "alert_type": "decision_support",
            "severity": severity,
            "safe_to_spend": safe_to_spend,
            "metadata": {
                "urgency_level": urgency_level,
                "risk_score": risk_score,
                "risk_tags": risk_tags,
                "recommended_action": recommended_action,
                "safety_category": safety_category,
                "safety_confidence": safety_confidence,
                "safety_label": safety_label,
                "safety_evidence": safety_evidence,
                "message": (
                    "Dangerous intent detected. Supporter review is required."
                    if safety_detected
                    else "Dynamic decision risk detected. Supporter review is recommended."
                ),
            },
        })

    return alerts


def _is_duplicate(db, user_id: int, supporter_id: int, candidate: dict, current_session_id) -> bool:
    """Decide whether to suppress a candidate alert to avoid noise.

    Rules (evaluated in order — first match wins):
    1. Same type + same session + unread + not dismissed → suppress (already alerted this turn).
    2. Same type + same session + read/dismissed → allow (supporter cleared it; fresh signal).
    3. Same type + different session → always allow (new conversation = new context).
    4. Same type + same session + higher severity → always allow (escalation must fire).
    5. Flat 30-minute window for non-session-matched duplicates of the same severity.
    """
    recent_cutoff = datetime.utcnow() - timedelta(minutes=30)
    existing = (
        db.query(SupporterAlert)
        .filter(
            SupporterAlert.user_id == user_id,
            SupporterAlert.supporter_id == supporter_id,
            SupporterAlert.alert_type == candidate["alert_type"],
            SupporterAlert.created_at >= recent_cutoff,
            SupporterAlert.dismissed.is_(False),
        )
        .all()
    )
    if not existing:
        return False

    new_severity_rank = _SEVERITY_RANK.get(candidate["severity"], 0)
    current_session_id_str = str(current_session_id) if current_session_id is not None else None

    for alert in existing:
        # Decode stored session id from metadata
        try:
            stored_meta = json.loads(alert.metadata_json or "{}")
            stored_session_id = str(stored_meta.get("coach_signals", {}).get("triggered_session_id") or "")
        except (json.JSONDecodeError, AttributeError):
            stored_session_id = ""

        same_session = (
            current_session_id_str is not None
            and stored_session_id != ""
            and stored_session_id == current_session_id_str
        )

        if same_session:
            # Rule 4: escalating severity in same session → always allow.
            existing_rank = _SEVERITY_RANK.get(alert.severity or "info", 0)
            if new_severity_rank > existing_rank:
                return False
            # Rule 1: same session, unread, same-or-lower severity → suppress.
            if not alert.read:
                return True
            # Rule 2: same session but already read → allow.
            return False
        else:
            # Rule 3: different session → allow (handled by returning False below).
            if current_session_id_str and stored_session_id and stored_session_id != current_session_id_str:
                continue
            # Rule 5: no session info — fall back to flat window suppression.
            if not alert.read:
                return True

    return False


def _build_supporter_notification_message(candidate: dict, coach_signals: dict) -> str | None:
    """Return the notification message text for a pause-triggering alert, or None
    if this alert type should not generate a push notification.

    Messages are purposely vague — they invite the supporter to check in without
    naming any internal safety category.
    """
    alert_type = candidate["alert_type"]
    safety_detected = bool(coach_signals.get("safety_detected"))
    safety_confidence = str(coach_signals.get("safety_confidence") or "").lower()
    severity = candidate["severity"]

    if alert_type == "decision_support":
        if safety_detected and safety_confidence == "high":
            return (
                "Your user needs your attention. Their chat has been paused "
                "and they may need your support now."
            )
        if safety_detected:
            return (
                "A concern was flagged in your user's chat. "
                "The chat is paused — please check in when you can."
            )
        # Non-safety decision_support: notify only when the session is actually paused.
        if coach_signals.get("pause_required"):
            return (
                "Your user's chat has been paused for a spending decision review. "
                "Your input would help them choose safely."
            )
        return None

    if alert_type == "pause_prompt":
        custom = (coach_signals.get("suggested_supporter_message") or "").strip()
        return custom or (
            "Your user's chat is paused for an affordability check. "
            "They'd like your input before proceeding."
        )

    if alert_type in ("payday_warning", "low_balance") and severity == "critical":
        return (
            "Your user is showing critical balance stress. "
            "A check-in today would make a real difference."
        )

    return None


def create_supporter_alerts(db, user_id: int, coach_signals: dict) -> list[int]:
    supporter_ids = _linked_supporter_ids(db, user_id)
    if not supporter_ids:
        return []

    candidates = _build_alert_candidates(coach_signals)
    if not candidates:
        return []

    current_session_id = coach_signals.get("triggered_session_id")
    concern_summary = _build_concern_summary(coach_signals)
    created_ids: list[int] = []

    for supporter_id in supporter_ids:
        pause_notification_created = False
        for candidate in candidates:
            if _is_duplicate(db, user_id, supporter_id, candidate, current_session_id):
                continue

            metadata = dict(candidate["metadata"])
            metadata["concern_summary"] = concern_summary
            metadata["coach_signals"] = {
                "safe_to_spend": coach_signals.get("safe_to_spend"),
                "runout_before_payday": coach_signals.get("runout_before_payday"),
                "days_to_payday": coach_signals.get("days_to_payday"),
                "anomaly_count": coach_signals.get("anomaly_count", 0),
                "pause_prompt": coach_signals.get("pause_prompt"),
                "pause_required": coach_signals.get("pause_required"),
                "pause_reason": coach_signals.get("pause_reason"),
                "purchase_amount": coach_signals.get("purchase_amount"),
                "can_afford": coach_signals.get("can_afford"),
                "cannot_afford": coach_signals.get("cannot_afford"),
                "decision_intent": coach_signals.get("decision_intent"),
                "urgency_level": coach_signals.get("urgency_level"),
                "emotional_distress": coach_signals.get("emotional_distress"),
                "repeated_intent": coach_signals.get("repeated_intent"),
                "supporter_flag_required": coach_signals.get("supporter_flag_required"),
                "supporter_priority": coach_signals.get("supporter_priority"),
                "risk_score": coach_signals.get("risk_score"),
                "risk_tags": coach_signals.get("risk_tags") or [],
                "recommended_action": coach_signals.get("recommended_action"),
                "safety_detected": coach_signals.get("safety_detected"),
                "safety_category": coach_signals.get("safety_category"),
                "safety_label": coach_signals.get("safety_label"),
                "safety_confidence": coach_signals.get("safety_confidence"),
                "safety_pause_reason": coach_signals.get("safety_pause_reason"),
                "safety_calming_template_key": coach_signals.get("safety_calming_template_key"),
                "safety_language_variant": coach_signals.get("safety_language_variant"),
                "safety_evidence": coach_signals.get("safety_evidence") or [],
                "trigger_user_message": coach_signals.get("trigger_user_message"),
                "trigger_user_english": coach_signals.get("trigger_user_english"),
                "trigger_assistant_english": coach_signals.get("trigger_assistant_english"),
                "triggered_session_id": current_session_id,
                "triggered_user_message_id": coach_signals.get("triggered_user_message_id"),
            }

            metadata["chat_context"] = {
                "user_message": coach_signals.get("trigger_user_message"),
                "user_message_english": coach_signals.get("trigger_user_english"),
                "assistant_response_english": coach_signals.get("trigger_assistant_english"),
                "evidence": (coach_signals.get("safety_evidence") or [])[:3],
            }

            alert = SupporterAlert(
                user_id=user_id,
                supporter_id=supporter_id,
                alert_type=candidate["alert_type"],
                severity=candidate["severity"],
                safe_to_spend=candidate["safe_to_spend"],
                metadata_json=json.dumps(metadata),
            )
            db.add(alert)
            db.flush()
            created_ids.append(cast(int, alert.id))

            if not pause_notification_created:
                notif_message = _build_supporter_notification_message(candidate, coach_signals)
                if notif_message:
                    notif = SupporterNotification(
                        from_user_id=user_id,
                        to_user_id=supporter_id,
                        message=notif_message,
                    )
                    db.add(notif)
                    pause_notification_created = True

    return created_ids
