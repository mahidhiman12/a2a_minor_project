"""
Login & roles for the Citizen Concierge (demo-grade auth, standard library + itsdangerous).

  * users table in data/db/users.db (PBKDF2-SHA256 + per-user random salt)
  * session = signed, timestamped cookie (HttpOnly, SameSite=Lax, expires after
    SESSION_HOURS); it only carries the user id, the role is re-read from the DB
  * complaint_owners links each complaint id to the citizen who filed it, so the
    A2A payload sent to the Orchestrator stays exactly as before

Roles:  citizen | officer (with a department key) | admin
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import sqlite3
from datetime import datetime, timezone

from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

from common import config

DB = config.DB_DIR / "users.db"
COOKIE = "nagrik_session"
ROLES = ("citizen", "officer", "admin")
PBKDF2_ITERATIONS = 200_000
USERNAME_RX = re.compile(r"^[a-z0-9_.-]{3,32}$")

_signer = URLSafeTimedSerializer(config.SECRET_KEY, salt="nagrik-session")


def db():
    c = sqlite3.connect(DB)
    c.row_factory = sqlite3.Row
    return c


def init_db():
    with db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS users(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('citizen','officer','admin')),
            department TEXT,
            display_name TEXT,
            created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS complaint_owners(
            complaint_id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            created_at TEXT NOT NULL);
        """)


# ------------------------------ passwords ------------------------------
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iters, salt, digest = stored.split("$")
    except ValueError:
        return False
    if algo != "pbkdf2_sha256":
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(iters))
    return hmac.compare_digest(dk.hex(), digest)


_DUMMY_HASH = hash_password(secrets.token_hex(8))


# ------------------------------ users ------------------------------
def public(row: sqlite3.Row | None) -> dict | None:
    """User fields that are safe to send to the browser (never the hash)."""
    if row is None:
        return None
    return {"id": row["id"], "username": row["username"], "role": row["role"],
            "department": row["department"], "display_name": row["display_name"]}


def get_user(user_id) -> dict | None:
    with db() as c:
        return public(c.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone())


def create_user(username: str, password: str, role: str, department: str | None = None,
                display_name: str | None = None) -> dict:
    username = (username or "").strip().lower()
    if not USERNAME_RX.match(username):
        raise ValueError("Username must be 3-32 characters: lowercase letters, digits, _ . -")
    if len(password or "") < 6:
        raise ValueError("Password must be at least 6 characters")
    if role not in ROLES:
        raise ValueError(f"role must be one of {ROLES}")
    if (role == "officer") != bool(department):
        raise ValueError("Officers need a department; other roles must not have one")
    try:
        with db() as c:
            cur = c.execute(
                "INSERT INTO users(username, password_hash, role, department, display_name, "
                "created_at) VALUES(?,?,?,?,?,?)",
                (username, hash_password(password), role, department,
                 ((display_name or "").strip() or username)[:60],
                 datetime.now(timezone.utc).isoformat()))
            uid = cur.lastrowid
    except sqlite3.IntegrityError:
        raise ValueError("That username is already taken") from None
    return get_user(uid)


def authenticate(username: str, password: str) -> dict | None:
    with db() as c:
        row = c.execute("SELECT * FROM users WHERE username=?",
                        ((username or "").strip().lower(),)).fetchone()
    if row is None:
        verify_password(password or "", _DUMMY_HASH)  # same cost whether or not the user exists
        return None
    return public(row) if verify_password(password or "", row["password_hash"]) else None


def user_exists(username: str) -> bool:
    with db() as c:
        return c.execute("SELECT 1 FROM users WHERE username=?", (username,)).fetchone() is not None


def officer_departments() -> set[str]:
    with db() as c:
        return {r[0] for r in c.execute("SELECT DISTINCT department FROM users WHERE role='officer'")}


# ------------------------------ demo accounts ------------------------------
def demo_password(username: str, default: str) -> str:
    """DEMO_PASSWORD_<USERNAME> overrides the shared default for one account."""
    return os.getenv("DEMO_PASSWORD_" + re.sub(r"[^A-Z0-9]", "_", username.upper()), default)


def _seed(username, default_pw, role, department=None, display_name=None):
    if not user_exists(username):
        create_user(username, demo_password(username, default_pw), role, department, display_name)


def seed_static_accounts():
    _seed("citizen1", config.DEMO_CITIZEN_PASSWORD, "citizen", display_name="Asha Verma")
    _seed("admin", config.DEMO_ADMIN_PASSWORD, "admin", display_name="Grievance Cell Admin")


def seed_department_officers(departments) -> None:
    """One <key>_officer account per department discovered through Agent Cards, so a
    brand-new department agent gets a login with zero code changes."""
    for key in departments:
        if USERNAME_RX.match(f"{key}_officer"):
            _seed(f"{key}_officer", config.DEMO_OFFICER_PASSWORD, "officer", key,
                  f"{key.replace('_', ' ').title()} Officer")


# ------------------------------ sessions ------------------------------
def make_session(user: dict) -> str:
    return _signer.dumps({"uid": user["id"]})


def read_session(token: str | None) -> dict | None:
    if not token:
        return None
    try:
        data = _signer.loads(token, max_age=int(config.SESSION_HOURS * 3600))
    except (BadSignature, SignatureExpired):
        return None
    return get_user(data.get("uid")) if isinstance(data, dict) else None


def home_for(user: dict) -> str:
    if user["role"] == "officer":
        return f"/dept/{user['department']}"
    return "/admin" if user["role"] == "admin" else "/home"


# ------------------------------ complaint ownership ------------------------------
def record_owner(complaint_id: str, user_id: int):
    with db() as c:
        c.execute("INSERT OR IGNORE INTO complaint_owners VALUES(?,?,?)",
                  (complaint_id.upper(), user_id, datetime.now(timezone.utc).isoformat()))


def owner_of(complaint_id: str) -> int | None:
    with db() as c:
        r = c.execute("SELECT user_id FROM complaint_owners WHERE complaint_id=?",
                      (complaint_id.upper(),)).fetchone()
    return r[0] if r else None


def complaints_of(user_id: int) -> list[str]:
    with db() as c:
        return [r[0] for r in c.execute("SELECT complaint_id FROM complaint_owners WHERE user_id=? "
                                        "ORDER BY created_at DESC", (user_id,))]


def owners_map() -> dict[str, str]:
    """complaint_id -> citizen display name (admin overview)."""
    with db() as c:
        return {r[0]: r[1] for r in c.execute(
            "SELECT o.complaint_id, u.display_name FROM complaint_owners o "
            "JOIN users u ON u.id=o.user_id")}


init_db()
seed_static_accounts()
