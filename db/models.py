from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import relationship

from db.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    email = Column(String(255), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    access_account = Column(String(50), nullable=False)  # ABSA account number
    user_number = Column(String(10), default="1")
    user_email = Column(String(255))  # email used for SureCheck lookup
    full_name = Column(String(255), nullable=True)
    role = Column(String(20), nullable=False, default='user')  # 'user' | 'supporter'
    supporter_id = Column(Integer, ForeignKey('users.id'), nullable=True)
    trusted_supporter_name = Column(String(255), nullable=True)
    trusted_supporter_contact = Column(String(255), nullable=True)
    preferred_language = Column(String(50), nullable=True, default='english')
    last_login_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    sessions = relationship("AbsaSession", back_populates="user", cascade="all, delete-orphan")
    insights = relationship("Insight", back_populates="user", cascade="all, delete-orphan")
    statements = relationship("Statement", back_populates="user", cascade="all, delete-orphan")
    chat_sessions = relationship("FinanceChatSession", back_populates="user", cascade="all, delete-orphan")
    my_supporters = relationship(
        "UserSupporter",
        foreign_keys="UserSupporter.user_id",
        back_populates="user",
        cascade="all, delete-orphan",
    )


class AbsaSession(Base):
    __tablename__ = "absa_sessions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    token = Column(Text)                  # ABSA OAuth token
    transaction_id = Column(String(255))  # from consent response
    surecheck_reference = Column(String(255))  # absaReference from surecheck
    reference_number = Column(String(50))      # unique ref used for this session's API calls
    status = Column(String(30), default="initiated")  # initiated | surecheck_pending | active | rejected
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="sessions")


class Insight(Base):
    __tablename__ = "insights"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    session_id = Column(Integer, ForeignKey("absa_sessions.id"), nullable=True)
    selected_accounts = Column(Text, nullable=False)  # JSON array of account numbers
    raw_transactions = Column(Text)                   # JSON combined payload
    simplified_text = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="insights")
    translations = relationship("Translation", back_populates="insight", cascade="all, delete-orphan")
    chat_sessions = relationship("FinanceChatSession", back_populates="insight")


class Translation(Base):
    __tablename__ = "translations"

    id = Column(Integer, primary_key=True)
    insight_id = Column(Integer, ForeignKey("insights.id"), nullable=False)
    language = Column(String(50), nullable=False)
    translated_text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    insight = relationship("Insight", back_populates="translations")


class Statement(Base):
    __tablename__ = "statements"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    original_filename = Column(String(255), nullable=False)
    file_path = Column(String(512), nullable=False)
    status = Column(String(20), default="processing")  # processing | done | error
    error_message = Column(Text, nullable=True)
    insight_id = Column(Integer, ForeignKey("insights.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="statements")
    insight = relationship("Insight")


class FinanceChatSession(Base):
    __tablename__ = "finance_chat_sessions"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    insight_id = Column(Integer, ForeignKey("insights.id"), nullable=True)
    title = Column(String(255), nullable=True)
    is_paused = Column(Boolean, default=False)
    paused_at = Column(DateTime, nullable=True)
    paused_reason = Column(String(50), nullable=True)
    paused_context_json = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="chat_sessions")
    insight = relationship("Insight", back_populates="chat_sessions")
    messages = relationship("FinanceChatMessage", back_populates="session", cascade="all, delete-orphan")


class FinanceChatMessage(Base):
    __tablename__ = "finance_chat_messages"

    id = Column(Integer, primary_key=True)
    session_id = Column(Integer, ForeignKey("finance_chat_sessions.id"), nullable=False)
    role = Column(String(20), nullable=False)  # user | assistant
    language = Column(String(50), nullable=False, default="english")
    original_text = Column(Text, nullable=False)  # message in user language
    english_text = Column(Text, nullable=False)   # translated/working text for GPT
    created_at = Column(DateTime, default=datetime.utcnow)

    session = relationship("FinanceChatSession", back_populates="messages")


class UserSupporter(Base):
    """Links a regular user to one or more supporters (registered or manual)."""
    __tablename__ = "user_supporters"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    linked_supporter_id = Column(Integer, ForeignKey("users.id"), nullable=True)  # registered supporter
    display_name = Column(String(255), nullable=True)   # for manual/unregistered
    contact = Column(String(255), nullable=True)         # phone or email
    added_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", foreign_keys=[user_id], back_populates="my_supporters")
    linked_supporter = relationship("User", foreign_keys=[linked_supporter_id])


class SupporterNotification(Base):
    """In-app messages between a linked user and their registered supporter."""
    __tablename__ = "supporter_notifications"

    id = Column(Integer, primary_key=True)
    from_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    to_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    message = Column(Text, nullable=False)
    read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    from_user = relationship("User", foreign_keys=[from_user_id])
    to_user = relationship("User", foreign_keys=[to_user_id])


class SupporterAlert(Base):
    """Auto-generated financial alerts visible to supporters for linked users."""
    __tablename__ = "supporter_alerts"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    supporter_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    alert_type = Column(String(50), nullable=False)
    severity = Column(String(20), nullable=False, default="info")
    safe_to_spend = Column(Numeric(14, 2), nullable=True)
    metadata_json = Column(Text, nullable=True)
    read = Column(Boolean, default=False)
    dismissed = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", foreign_keys=[user_id])
    supporter = relationship("User", foreign_keys=[supporter_id])


class UserSpendingLimit(Base):
    """Per-user thresholds configured by a specific supporter."""
    __tablename__ = "user_spending_limits"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    supporter_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    daily_spend_limit = Column(Numeric(14, 2), nullable=True)
    weekly_spend_limit = Column(Numeric(14, 2), nullable=True)
    monthly_spend_limit = Column(Numeric(14, 2), nullable=True)
    min_balance_threshold = Column(Numeric(14, 2), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", foreign_keys=[user_id])
    supporter = relationship("User", foreign_keys=[supporter_id])


class SupporterNote(Base):
    """Notes a supporter records for a linked user."""
    __tablename__ = "supporter_notes"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    supporter_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    note_text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", foreign_keys=[user_id])
    supporter = relationship("User", foreign_keys=[supporter_id])


class SupporterChatMessage(Base):
    """AI chat messages between a supporter and LekkerFi about a linked user."""
    __tablename__ = "supporter_chat_messages"

    id = Column(Integer, primary_key=True)
    supporter_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    role = Column(String(20), nullable=False)   # "supporter" | "assistant"
    text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    supporter = relationship("User", foreign_keys=[supporter_id])
    user = relationship("User", foreign_keys=[user_id])
