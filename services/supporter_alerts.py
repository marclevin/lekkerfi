import json
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import cast

from db.models import SupporterAlert, SupporterNotification, User, UserSupporter


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


def _build_alert_candidates(coach_signals: dict) -> list[dict]:
    alerts = []
    safe_to_spend = _to_decimal(coach_signals.get("safe_to_spend"))
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


def create_supporter_alerts(db, user_id: int, coach_signals: dict) -> list[int]:
    supporter_ids = _linked_supporter_ids(db, user_id)
    if not supporter_ids:
        return []

    candidates = _build_alert_candidates(coach_signals)
    if not candidates:
        return []

    recent_cutoff = datetime.utcnow() - timedelta(minutes=5)
    created_ids: list[int] = []

    for supporter_id in supporter_ids:
        pause_notification_created = False
        for candidate in candidates:
            duplicate = (
                db.query(SupporterAlert)
                .filter(
                    SupporterAlert.user_id == user_id,
                    SupporterAlert.supporter_id == supporter_id,
                    SupporterAlert.alert_type == candidate["alert_type"],
                    SupporterAlert.created_at >= recent_cutoff,
                    SupporterAlert.dismissed.is_(False),
                )
                .first()
            )
            if duplicate:
                continue

            metadata = dict(candidate["metadata"])
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
                "triggered_session_id": coach_signals.get("triggered_session_id"),
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

            if candidate["alert_type"] == "pause_prompt" and not pause_notification_created:
                message = (coach_signals.get("suggested_supporter_message") or "").strip()
                if not message:
                    message = "Spending pause: user requested a high-value affordability check and supporter review."

                notif = SupporterNotification(
                    from_user_id=user_id,
                    to_user_id=supporter_id,
                    message=message,
                )
                db.add(notif)
                pause_notification_created = True

    return created_ids
