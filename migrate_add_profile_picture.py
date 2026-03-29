#!/usr/bin/env python
"""
Migration script to add profile_picture_data and profile_picture_type columns to users table.
"""
import sqlite3
from pathlib import Path

# Find the database file
db_path = Path("lekkerfi.db")
if not db_path.exists():
    print(f"Database not found at {db_path}")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

try:
    # Check if columns already exist
    cursor.execute("PRAGMA table_info(users)")
    columns = {row[1] for row in cursor.fetchall()}
    
    if "profile_picture_data" not in columns:
        print("Adding profile_picture_data column...")
        cursor.execute("ALTER TABLE users ADD COLUMN profile_picture_data BLOB")
    else:
        print("profile_picture_data column already exists")
    
    if "profile_picture_type" not in columns:
        print("Adding profile_picture_type column...")
        cursor.execute("ALTER TABLE users ADD COLUMN profile_picture_type VARCHAR(50)")
    else:
        print("profile_picture_type column already exists")
    
    conn.commit()
    print("✓ Migration complete!")
except Exception as e:
    print(f"✗ Migration failed: {e}")
    conn.rollback()
finally:
    conn.close()
