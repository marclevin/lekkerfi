"""
Backend API tests.

Covers:
- PUT /api/auth/me  — supporter profile updates
- GET /api/insights/weekly-win  — payload shape
- POST /api/chat/sessions/<id>/messages  — supporter name fallback from profile
- Chat pause flow + supporter decision endpoints
"""

import bcrypt
import json
from unittest.mock import patch

import pytest

from db.database import SessionLocal
from db.models import SupporterAlert, SupporterNotification, User, UserSupporter


# ── Helpers ────────────────────────────────────────────────────────────────────

FAKE_REPLY = {
    "user_english": "Hello",
    "assistant_english": "Hi there! Here is your summary.",
    "assistant_user_language": "Hi there! Here is your summary.",
    "language": "english",
    "safe_to_spend": "4000.00",
    "runout_before_payday": False,
    "days_to_payday": 12,
    "anomaly_count": 0,
    "pause_prompt": None,
    "pause_required": False,
    "pause_reason": None,
    "purchase_amount": None,
    "can_afford": None,
    "suggested_supporter_message": None,
    "decision_intent": False,
    "urgency_level": "low",
    "emotional_distress": False,
    "repeated_intent": False,
    "supporter_flag_required": False,
    "supporter_priority": "low",
    "risk_score": 0,
    "risk_tags": [],
    "recommended_action": "continue_monitoring",
    "safety_detected": False,
    "safety_category": None,
    "safety_label": None,
    "safety_confidence": "none",
    "safety_pause_reason": None,
    "safety_calming_template_key": "general_pause",
    "safety_language_variant": "standard",
    "safety_evidence": [],
    "generated_at": "2026-03-28T00:00:00",
}


# ── PUT /api/auth/me ───────────────────────────────────────────────────────────

class TestUpdateMe:
    def test_updates_supporter_name(self, client, user, auth_header):
        resp = client.put(
            "/api/auth/me",
            json={"trusted_supporter_name": "Nomsa"},
            headers=auth_header,
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["trusted_supporter_name"] == "Nomsa"

    def test_updates_supporter_contact(self, client, user, auth_header):
        resp = client.put(
            "/api/auth/me",
            json={"trusted_supporter_contact": "083 123 4567"},
            headers=auth_header,
        )
        assert resp.status_code == 200
        assert resp.get_json()["trusted_supporter_contact"] == "083 123 4567"

    def test_updates_both_fields_together(self, client, user, auth_header):
        resp = client.put(
            "/api/auth/me",
            json={"trusted_supporter_name": "Thabo", "trusted_supporter_contact": "083 999 0000"},
            headers=auth_header,
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["trusted_supporter_name"] == "Thabo"
        assert data["trusted_supporter_contact"] == "083 999 0000"

    def test_clears_supporter_name_with_empty_string(self, client, user_with_supporter, auth_header_supporter):
        resp = client.put(
            "/api/auth/me",
            json={"trusted_supporter_name": ""},
            headers=auth_header_supporter,
        )
        assert resp.status_code == 200
        assert resp.get_json()["trusted_supporter_name"] is None

    def test_ignores_unknown_fields(self, client, user, auth_header):
        resp = client.put(
            "/api/auth/me",
            json={"email": "hacker@evil.com", "trusted_supporter_name": "Safe"},
            headers=auth_header,
        )
        assert resp.status_code == 200
        data = resp.get_json()
        # email must not change; known field updated
        assert data["email"] == "test@example.com"
        assert data["trusted_supporter_name"] == "Safe"

    def test_requires_auth(self, client):
        resp = client.put("/api/auth/me", json={"trusted_supporter_name": "X"})
        assert resp.status_code == 401


class TestAuthLoginActivity:
    def test_login_sets_last_login_at(self, client, user):
        resp = client.post(
            "/api/auth/login",
            json={"email": "test@example.com", "password": "password123"},
        )
        assert resp.status_code == 200
        payload = resp.get_json()
        assert payload["user"]["last_login_at"] is not None


class TestAssistedLogin:
    def test_assist_request_sends_code_to_linked_supporter(self, client, user):
        db = SessionLocal()
        try:
            pw_hash = bcrypt.hashpw("password123".encode(), bcrypt.gensalt()).decode()
            supporter = User(
                email="assist-supporter@example.com",
                password_hash=pw_hash,
                access_account="111222333",
                role="supporter",
                full_name="Assist Supporter",
            )
            db.add(supporter)
            db.commit()
            db.refresh(supporter)

            link = UserSupporter(user_id=user.id, linked_supporter_id=supporter.id)
            db.add(link)
            db.commit()
        finally:
            db.close()

        req = client.post(
            "/api/auth/login-assist/request",
            json={"email": user.email},
        )
        assert req.status_code == 200
        payload = req.get_json()
        assert payload.get("ticket_id")
        assert payload.get("supporter_count") == 1

        db = SessionLocal()
        try:
            notif = db.query(SupporterNotification).filter(
                SupporterNotification.to_user_id == supporter.id,
                SupporterNotification.message.ilike("%Assisted login request%"),
            ).first()
            assert notif is not None
        finally:
            db.close()

    def test_assist_verify_logs_user_in(self, client, user):
        db = SessionLocal()
        try:
            pw_hash = bcrypt.hashpw("password123".encode(), bcrypt.gensalt()).decode()
            supporter = User(
                email="assist-supporter-verify@example.com",
                password_hash=pw_hash,
                access_account="111222334",
                role="supporter",
            )
            db.add(supporter)
            db.commit()
            db.refresh(supporter)

            link = UserSupporter(user_id=user.id, linked_supporter_id=supporter.id)
            db.add(link)
            db.commit()
        finally:
            db.close()

        req = client.post(
            "/api/auth/login-assist/request",
            json={"email": user.email},
        )
        assert req.status_code == 200
        ticket_id = req.get_json().get("ticket_id")
        assert ticket_id

        app = client.application
        ticket = app.config["AUTH_ASSIST_TICKETS"].get(ticket_id)
        assert ticket is not None
        code = ticket["code"]

        verify = client.post(
            "/api/auth/login-assist/verify",
            json={"email": user.email, "ticket_id": ticket_id, "code": code},
        )
        assert verify.status_code == 200
        data = verify.get_json()
        assert data.get("access_token")
        assert data.get("user", {}).get("id") == user.id

    def test_assist_verify_limits_incorrect_attempts(self, client, user):
        db = SessionLocal()
        try:
            pw_hash = bcrypt.hashpw("password123".encode(), bcrypt.gensalt()).decode()
            supporter = User(
                email="assist-supporter-limit@example.com",
                password_hash=pw_hash,
                access_account="111222335",
                role="supporter",
            )
            db.add(supporter)
            db.commit()
            db.refresh(supporter)

            link = UserSupporter(user_id=user.id, linked_supporter_id=supporter.id)
            db.add(link)
            db.commit()
        finally:
            db.close()

        req = client.post(
            "/api/auth/login-assist/request",
            json={"email": user.email},
        )
        ticket_id = req.get_json().get("ticket_id")
        assert ticket_id

        for _ in range(4):
            bad = client.post(
                "/api/auth/login-assist/verify",
                json={"email": user.email, "ticket_id": ticket_id, "code": "000000"},
            )
            assert bad.status_code == 401

        final_bad = client.post(
            "/api/auth/login-assist/verify",
            json={"email": user.email, "ticket_id": ticket_id, "code": "000000"},
        )
        assert final_bad.status_code == 429


# ── GET /api/insights/weekly-win ──────────────────────────────────────────────

class TestWeeklyWin:
    def test_returns_expected_shape_with_insight(self, client, user, insight, auth_header):
        resp = client.get("/api/insights/weekly-win", headers=auth_header)
        assert resp.status_code == 200
        data = resp.get_json()

        assert "wins" in data, "payload must have 'wins'"
        assert isinstance(data["wins"], list), "'wins' must be a list"
        assert len(data["wins"]) >= 1, "must have at least one win"
        assert all(isinstance(w, str) for w in data["wins"]), "each win must be a string"

        assert "share_text" in data, "payload must have 'share_text'"
        assert isinstance(data["share_text"], str)
        assert len(data["share_text"]) > 0

        assert "generated_at" in data
        assert "insight_id" in data
        assert data["insight_id"] == insight.id

    def test_returns_fallback_without_insight(self, client, user, auth_header):
        """No insight in DB → friendly fallback message, not an error."""
        resp = client.get("/api/insights/weekly-win", headers=auth_header)
        assert resp.status_code == 200
        data = resp.get_json()
        assert "wins" in data
        assert len(data["wins"]) >= 1

    def test_wins_reflect_positive_net_flow(self, client, user, insight, auth_header):
        """Minimal fixture has income > spend → net win message expected."""
        resp = client.get("/api/insights/weekly-win", headers=auth_header)
        data = resp.get_json()
        combined = " ".join(data["wins"])
        assert any(
            keyword in combined.lower()
            for keyword in ("positive", "flow", "income", "tracked")
        )

    def test_requires_auth(self, client):
        resp = client.get("/api/insights/weekly-win")
        assert resp.status_code == 401


class TestAccessibleInsights:
    @patch("api.insights._build_visualization_result")
    @patch("api.insights.generate_accessible_carousel")
    def test_returns_accessible_cards_payload(
        self, mock_generate_cards, mock_build_viz, client, insight, auth_header
    ):
        mock_build_viz.return_value = {
            "summary": {
                "total_income": 15000,
                "total_expenses": 999,
                "net_flow": 14001,
                "account_balance": 5000,
            },
            "visualizations": [
                {
                    "type": "spending_overview",
                    "title": "Spending overview",
                    "url": "/api/visualizations/spending.png",
                }
            ],
        }
        mock_generate_cards.return_value = {
            "language": "zulu",
            "intro": "Sizohamba kancane kuleli khadi.",
            "cards": [
                {
                    "id": "spending_overview",
                    "title": "Ukubuka ukusetshenziswa",
                    "chart_type": "spending_overview",
                    "chart_url": "/api/visualizations/spending.png",
                    "headline": "Nansi into ebalulekile.",
                    "explanation": "Siyichaza ngesinyathelo ngesinyathelo.",
                    "what_to_do_now": "Khetha isinyathelo esisodwa namuhla.",
                    "chat_prompt": "Ngicela uchaze leli khadi kalula.",
                }
            ],
        }

        resp = client.get(
            f"/api/insights/{insight.id}/accessible?language=zulu",
            headers=auth_header,
        )
        assert resp.status_code == 200
        data = resp.get_json()

        assert data["insight_id"] == insight.id
        assert data["language"] == "zulu"
        assert isinstance(data["cards"], list)
        assert len(data["cards"]) == 1
        assert data["cards"][0]["chat_prompt"]
        assert "summary" in data

    @patch("api.insights._build_visualization_result")
    @patch("api.insights.generate_accessible_carousel")
    def test_uses_user_preferred_language_when_query_missing(
        self, mock_generate_cards, mock_build_viz, client, user, insight, auth_header
    ):
        db = SessionLocal()
        try:
            db_user = db.get(User, user.id)
            assert db_user is not None
            setattr(db_user, "preferred_language", "afrikaans")
            db.commit()
        finally:
            db.close()

        mock_build_viz.return_value = {"summary": {}, "visualizations": []}
        mock_generate_cards.return_value = {
            "language": "afrikaans",
            "intro": "Ons gaan stadig deur dit.",
            "cards": [
                {
                    "id": "summary_only",
                    "title": "Opsomming",
                    "chart_type": "summary",
                    "chart_url": "",
                    "headline": "Een belangrike punt.",
                    "explanation": "Hier is die eenvoudige verduideliking.",
                    "what_to_do_now": "Doen een klein stap.",
                    "chat_prompt": "Verduidelik dit in eenvoudige stappe.",
                }
            ],
        }

        resp = client.get(f"/api/insights/{insight.id}/accessible", headers=auth_header)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["language"] == "afrikaans"
        _, kwargs = mock_generate_cards.call_args
        assert kwargs.get("language") == "afrikaans"

    @patch("api.insights._build_visualization_result")
    @patch("api.insights.generate_accessible_carousel")
    def test_caches_accessible_cards_for_same_insight_and_language(
        self, mock_generate_cards, mock_build_viz, client, insight, auth_header
    ):
        mock_build_viz.return_value = {
            "summary": {"net_flow": 14001},
            "visualizations": [
                {
                    "type": "spending_overview",
                    "title": "Spending overview",
                    "url": "/api/visualizations/spending.png",
                }
            ],
        }
        mock_generate_cards.return_value = {
            "language": "english",
            "intro": "We will go slowly.",
            "cards": [
                {
                    "id": "spending_overview",
                    "title": "Spending overview",
                    "chart_type": "spending_overview",
                    "chart_url": "/api/visualizations/spending.png",
                    "headline": "One key pattern.",
                    "explanation": "Simple explanation.",
                    "what_to_do_now": "Take one step.",
                    "chat_prompt": "Explain this in simple steps.",
                }
            ],
        }

        first = client.get(f"/api/insights/{insight.id}/accessible?language=english", headers=auth_header)
        second = client.get(f"/api/insights/{insight.id}/accessible?language=english", headers=auth_header)

        assert first.status_code == 200
        assert second.status_code == 200
        assert mock_generate_cards.call_count == 1


# ── Chat supporter name fallback ───────────────────────────────────────────────

class TestChatSupporterFallback:
    @patch("api.chat.generate_finance_chat_reply")
    def test_uses_profile_name_when_not_in_request(
        self, mock_reply, client, user_with_supporter, auth_header_supporter,
        insight_for_supporter, chat_session_for_supporter,
    ):
        """When request omits trusted_supporter_name, backend must fall back to user profile."""
        mock_reply.return_value = FAKE_REPLY

        resp = client.post(
            f"/api/chat/sessions/{chat_session_for_supporter.id}/messages",
            json={"message": "Can I afford this?", "language": "english"},
            headers=auth_header_supporter,
        )
        assert resp.status_code == 201

        _, kwargs = mock_reply.call_args
        assert kwargs.get("trusted_supporter_name") == "Nomsa", (
            "backend should fall back to profile supporter name when not in request"
        )

    @patch("api.chat.generate_finance_chat_reply")
    def test_explicit_name_overrides_profile(
        self, mock_reply, client, user_with_supporter, auth_header_supporter,
        insight_for_supporter, chat_session_for_supporter,
    ):
        """Explicit name in request body takes precedence over profile."""
        mock_reply.return_value = FAKE_REPLY

        resp = client.post(
            f"/api/chat/sessions/{chat_session_for_supporter.id}/messages",
            json={"message": "hello", "language": "english", "trusted_supporter_name": "Thabo"},
            headers=auth_header_supporter,
        )
        assert resp.status_code == 201

        _, kwargs = mock_reply.call_args
        assert kwargs.get("trusted_supporter_name") == "Thabo"

    @patch("api.chat.generate_finance_chat_reply")
    def test_coach_signals_returned(
        self, mock_reply, client, user, auth_header, insight, chat_session
    ):
        """Response must include coach_signals block with expected keys."""
        mock_reply.return_value = FAKE_REPLY

        resp = client.post(
            f"/api/chat/sessions/{chat_session.id}/messages",
            json={"message": "how am I doing?", "language": "english"},
            headers=auth_header,
        )
        assert resp.status_code == 201
        data = resp.get_json()

        assert "coach_signals" in data
        signals = data["coach_signals"]
        assert "safe_to_spend" in signals
        assert "runout_before_payday" in signals
        assert "days_to_payday" in signals
        assert "anomaly_count" in signals
        assert "supporter_flag_required" in signals
        assert "supporter_priority" in signals
        assert "risk_score" in signals
        assert "safety_detected" in signals
        assert "safety_category" in signals
        assert "safety_confidence" in signals


class TestChatPauseFlow:
    @patch("api.chat.generate_finance_chat_reply")
    def test_pause_creates_alert_and_supporter_notification(
        self, mock_reply, client, user, auth_header, insight, chat_session
    ):
        mock_reply.return_value = {
            **FAKE_REPLY,
            "assistant_english": "We should pause this spending choice.",
            "assistant_user_language": "We should pause this spending choice.",
            "pause_prompt": "Would you like to check with your supporter?",
            "pause_required": True,
            "pause_reason": "cannot_afford",
            "purchase_amount": "3000",
            "can_afford": False,
            "suggested_supporter_message": "Purchase check-in: user asked about buying an item for R3,000.00.",
            "decision_intent": True,
            "urgency_level": "high",
            "emotional_distress": False,
            "repeated_intent": True,
            "supporter_flag_required": True,
            "supporter_priority": "high",
            "risk_score": 9,
            "risk_tags": ["decision_intent", "cannot_afford", "urgency_high"],
            "recommended_action": "pause_and_review",
        }

        db = SessionLocal()
        try:
            pw_hash = bcrypt.hashpw("password123".encode(), bcrypt.gensalt()).decode()
            supporter = User(
                email="trusted@example.com",
                password_hash=pw_hash,
                access_account="999000111",
                role="supporter",
                full_name="Trusted Person",
            )
            db.add(supporter)
            db.commit()
            db.refresh(supporter)

            link = UserSupporter(user_id=user.id, linked_supporter_id=supporter.id)
            db.add(link)
            db.commit()
        finally:
            db.close()

        resp = client.post(
            f"/api/chat/sessions/{chat_session.id}/messages",
            json={"message": "Can I buy R3000 headphones?", "language": "english"},
            headers=auth_header,
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["chat_paused"] is True
        assert data["pause_reason"] == "cannot_afford"
        assert len(data["supporter_alert_ids"]) >= 1

        db = SessionLocal()
        try:
            paused_session = db.get(type(chat_session), chat_session.id)
            assert paused_session is not None
            assert paused_session.is_paused is True

            alerts = db.query(SupporterAlert).filter(SupporterAlert.user_id == user.id).all()
            assert any(a.alert_type == "pause_prompt" for a in alerts)

            pause_alert = next((a for a in alerts if a.alert_type == "pause_prompt"), None)
            assert pause_alert is not None
            metadata = json.loads(pause_alert.metadata_json or "{}")
            assert metadata.get("chat_context", {}).get("user_message") == "Can I buy R3000 headphones?"
            assert metadata.get("chat_context", {}).get("assistant_response_english") == "We should pause this spending choice."
            assert metadata.get("coach_signals", {}).get("supporter_priority") == "high"
            assert metadata.get("coach_signals", {}).get("risk_score") == 9

            notifs = db.query(SupporterNotification).filter(
                SupporterNotification.from_user_id == user.id
            ).all()
            assert len(notifs) >= 1
        finally:
            db.close()

    @patch("api.chat.generate_finance_chat_reply")
    def test_dynamic_decision_support_alert_created_without_pause(
        self, mock_reply, client, user, auth_header, insight, chat_session
    ):
        mock_reply.return_value = {
            **FAKE_REPLY,
            "assistant_english": "This sounds urgent. Let us involve your supporter now.",
            "assistant_user_language": "This sounds urgent. Let us involve your supporter now.",
            "pause_required": False,
            "supporter_flag_required": True,
            "supporter_priority": "high",
            "risk_score": 7,
            "urgency_level": "high",
            "decision_intent": True,
            "recommended_action": "urgent_supporter_checkin",
            "risk_tags": ["decision_intent", "urgency_high"],
        }

        db = SessionLocal()
        try:
            pw_hash = bcrypt.hashpw("password123".encode(), bcrypt.gensalt()).decode()
            supporter = User(
                email="watcher@example.com",
                password_hash=pw_hash,
                access_account="999000112",
                role="supporter",
                full_name="Watch Supporter",
            )
            db.add(supporter)
            db.commit()
            db.refresh(supporter)

            link = UserSupporter(user_id=user.id, linked_supporter_id=supporter.id)
            db.add(link)
            db.commit()
        finally:
            db.close()

        resp = client.post(
            f"/api/chat/sessions/{chat_session.id}/messages",
            json={"message": "I need to buy this right now", "language": "english"},
            headers=auth_header,
        )
        assert resp.status_code == 201
        payload = resp.get_json()
        assert payload["chat_paused"] is False
        assert payload["coach_signals"]["supporter_flag_required"] is True

        db = SessionLocal()
        try:
            alerts = db.query(SupporterAlert).filter(SupporterAlert.user_id == user.id).all()
            decision_alert = next((a for a in alerts if a.alert_type == "decision_support"), None)
            assert decision_alert is not None
            metadata = json.loads(decision_alert.metadata_json or "{}")
            assert metadata.get("risk_score") == 7
            assert metadata.get("coach_signals", {}).get("supporter_priority") == "high"
        finally:
            db.close()

    @patch("api.chat.generate_finance_chat_reply")
    def test_safety_pause_sets_safety_payload(
        self, mock_reply, client, user, auth_header, insight, chat_session
    ):
        mock_reply.return_value = {
            **FAKE_REPLY,
            "assistant_english": "We are pausing for safety.",
            "assistant_user_language": "We are pausing for safety.",
            "pause_required": True,
            "pause_reason": "safety_weapons_purchase",
            "decision_intent": True,
            "supporter_flag_required": True,
            "supporter_priority": "high",
            "risk_score": 10,
            "risk_tags": ["decision_intent", "safety_weapons_purchase"],
            "recommended_action": "pause_and_review",
            "safety_detected": True,
            "safety_category": "weapons_purchase",
            "safety_label": "weapon purchase intent",
            "safety_confidence": "high",
            "safety_pause_reason": "safety_weapons_purchase",
            "safety_calming_template_key": "weapons_pause",
            "safety_language_variant": "simplified",
            "safety_evidence": ["buy a gun"],
        }

        resp = client.post(
            f"/api/chat/sessions/{chat_session.id}/messages",
            json={"message": "Can I buy a gun today?", "language": "english"},
            headers=auth_header,
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["chat_paused"] is True
        assert data["pause_reason"] == "safety_weapons_purchase"
        assert data["safety"]["detected"] is True
        assert data["safety"]["category"] == "weapons_purchase"

        db = SessionLocal()
        try:
            paused_session = db.get(type(chat_session), chat_session.id)
            assert paused_session is not None
            context = json.loads(paused_session.paused_context_json or "{}")
            assert context.get("triggered_by") == "chat_safety"
            assert context.get("safety", {}).get("category") == "weapons_purchase"
            assert context.get("safety", {}).get("confidence") == "high"
        finally:
            db.close()

    @patch("api.chat.generate_finance_chat_reply")
    def test_paused_session_blocks_new_messages(
        self, mock_reply, client, auth_header, chat_session
    ):
        db = SessionLocal()
        try:
            session = db.get(type(chat_session), chat_session.id)
            assert session is not None
            session.is_paused = True
            session.paused_reason = "cannot_afford"
            db.commit()
        finally:
            db.close()

        resp = client.post(
            f"/api/chat/sessions/{chat_session.id}/messages",
            json={"message": "Please continue", "language": "english"},
            headers=auth_header,
        )
        assert resp.status_code == 423
        assert mock_reply.call_count == 0


class TestSupporterAlertDecision:
    def test_decision_unpauses_session_and_notifies_user(
        self, client, user, chat_session
    ):
        supporter_id = None
        db = SessionLocal()
        try:
            pw_hash = bcrypt.hashpw("password123".encode(), bcrypt.gensalt()).decode()
            supporter = User(
                email="supporter-role@example.com",
                password_hash=pw_hash,
                access_account="222333444",
                role="supporter",
                full_name="Community Supporter",
            )
            db.add(supporter)
            db.commit()
            db.refresh(supporter)
            supporter_id = supporter.id

            link = UserSupporter(user_id=user.id, linked_supporter_id=supporter.id)
            db.add(link)

            session = db.get(type(chat_session), chat_session.id)
            assert session is not None
            session.is_paused = True
            session.paused_reason = "cannot_afford"

            alert = SupporterAlert(
                user_id=user.id,
                supporter_id=supporter.id,
                alert_type="pause_prompt",
                severity="info",
                metadata_json=json.dumps({"coach_signals": {"purchase_amount": "3000"}}),
            )
            db.add(alert)
            db.commit()
            db.refresh(alert)
        finally:
            db.close()

        login = client.post(
            "/api/auth/login",
            json={"email": "supporter-role@example.com", "password": "password123"},
        )
        assert login.status_code == 200
        token = login.get_json()["access_token"]
        supporter_header = {"Authorization": f"Bearer {token}"}

        resp = client.post(
            f"/api/supporters/dashboard/alerts/{alert.id}/decision",
            json={"decision": "approve", "note": "Looks okay if you delay non-essentials."},
            headers=supporter_header,
        )
        assert resp.status_code == 200
        assert resp.get_json()["session_unpaused"] is True

        db = SessionLocal()
        try:
            resolved = db.get(type(chat_session), chat_session.id)
            assert resolved is not None
            assert resolved.is_paused is False

            resolved_alert = db.get(SupporterAlert, alert.id)
            assert resolved_alert is not None
            assert resolved_alert.dismissed is True

            review_notif = db.query(SupporterNotification).filter(
                SupporterNotification.from_user_id == supporter_id,
                SupporterNotification.to_user_id == user.id,
            ).first()
            assert review_notif is not None
            assert "approved" in review_notif.message
        finally:
            db.close()


class TestSupporterChatPauseControls:
    def test_supporter_can_pause_and_unpause_user_chat(self, client, user, chat_session):
        db = SessionLocal()
        try:
            pw_hash = bcrypt.hashpw("password123".encode(), bcrypt.gensalt()).decode()
            supporter = User(
                email="supporter-controls@example.com",
                password_hash=pw_hash,
                access_account="99887766",
                role="supporter",
                full_name="Support Controls",
            )
            db.add(supporter)
            db.commit()
            db.refresh(supporter)

            link = UserSupporter(user_id=user.id, linked_supporter_id=supporter.id)
            db.add(link)

            session = db.get(type(chat_session), chat_session.id)
            assert session is not None
            session.is_paused = False
            session.paused_reason = None
            session.paused_at = None
            db.commit()

            supporter_id = supporter.id
        finally:
            db.close()

        login = client.post(
            "/api/auth/login",
            json={"email": "supporter-controls@example.com", "password": "password123"},
        )
        assert login.status_code == 200
        token = login.get_json()["access_token"]
        supporter_header = {"Authorization": f"Bearer {token}"}

        pause_resp = client.post(
            f"/api/supporters/dashboard/users/{user.id}/chat-pause",
            json={"action": "pause", "reason": "manual review required"},
            headers=supporter_header,
        )
        assert pause_resp.status_code == 200
        pause_payload = pause_resp.get_json()
        assert pause_payload["chat_pause"]["is_paused"] is True
        assert pause_payload["chat_pause"]["paused_reason"] == "manual review required"

        db = SessionLocal()
        try:
            resolved = db.get(type(chat_session), chat_session.id)
            assert resolved is not None
            assert resolved.is_paused is True
            assert resolved.paused_reason == "manual review required"

            notif = db.query(SupporterNotification).filter(
                SupporterNotification.from_user_id == supporter_id,
                SupporterNotification.to_user_id == user.id,
                SupporterNotification.message.ilike("%paused your chat%"),
            ).first()
            assert notif is not None
        finally:
            db.close()

        unpause_resp = client.post(
            f"/api/supporters/dashboard/users/{user.id}/chat-pause",
            json={"action": "unpause", "reason": "you can continue"},
            headers=supporter_header,
        )
        assert unpause_resp.status_code == 200
        unpause_payload = unpause_resp.get_json()
        assert unpause_payload["chat_pause"]["is_paused"] is False
        assert unpause_payload["chat_pause"]["paused_reason"] is None

        db = SessionLocal()
        try:
            resolved = db.get(type(chat_session), chat_session.id)
            assert resolved is not None
            assert resolved.is_paused is False
            assert resolved.paused_reason is None
        finally:
            db.close()

    def test_supporter_details_include_chat_pause_state(self, client, user, chat_session):
        db = SessionLocal()
        try:
            pw_hash = bcrypt.hashpw("password123".encode(), bcrypt.gensalt()).decode()
            supporter = User(
                email="supporter-details@example.com",
                password_hash=pw_hash,
                access_account="55443322",
                role="supporter",
                full_name="Support Details",
            )
            db.add(supporter)
            db.commit()
            db.refresh(supporter)

            link = UserSupporter(user_id=user.id, linked_supporter_id=supporter.id)
            db.add(link)

            session = db.get(type(chat_session), chat_session.id)
            assert session is not None
            session.is_paused = True
            session.paused_reason = "cannot_afford"
            db.commit()
        finally:
            db.close()

        login = client.post(
            "/api/auth/login",
            json={"email": "supporter-details@example.com", "password": "password123"},
        )
        assert login.status_code == 200
        token = login.get_json()["access_token"]
        supporter_header = {"Authorization": f"Bearer {token}"}

        details_resp = client.get(
            f"/api/supporters/dashboard/users/{user.id}/details",
            headers=supporter_header,
        )
        assert details_resp.status_code == 200
        details_payload = details_resp.get_json()
        assert details_payload["chat_pause"]["is_paused"] is True
        assert details_payload["chat_pause"]["paused_reason"] == "cannot_afford"

        users_resp = client.get(
            "/api/supporters/dashboard/users",
            headers=supporter_header,
        )
        assert users_resp.status_code == 200
        users_payload = users_resp.get_json()["users"]
        linked_summary = next((u for u in users_payload if u["id"] == user.id), None)
        assert linked_summary is not None
        assert linked_summary["chat_pause"]["is_paused"] is True
