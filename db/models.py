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


class Translation(Base):
    __tablename__ = "translations"

    id = Column(Integer, primary_key=True)
    insight_id = Column(Integer, ForeignKey("insights.id"), nullable=False)
    language = Column(String(50), nullable=False)
    translated_text = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    insight = relationship("Insight", back_populates="translations")
