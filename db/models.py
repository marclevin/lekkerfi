from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
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
    created_at = Column(DateTime, default=datetime.utcnow)

    sessions = relationship("AbsaSession", back_populates="user", cascade="all, delete-orphan")
    insights = relationship("Insight", back_populates="user", cascade="all, delete-orphan")
    statements = relationship("Statement", back_populates="user", cascade="all, delete-orphan")
    chat_sessions = relationship("FinanceChatSession", back_populates="user", cascade="all, delete-orphan")


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
