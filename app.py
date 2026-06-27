import os
import json
import sqlite3
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import Flask, request, jsonify, render_template
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"
INSTANCE_DIR = BASE_DIR / "instance"
DB_PATH = INSTANCE_DIR / "bofhound.db"

UPLOAD_DIR.mkdir(exist_ok=True)
INSTANCE_DIR.mkdir(exist_ok=True)

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 512 * 1024 * 1024  # 512 MB


# ── Database ──────────────────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    with get_db() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS uploads (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            original_name TEXT    NOT NULL,
            stored_name   TEXT    NOT NULL,
            uploaded_at   TEXT    DEFAULT (datetime('now')),
            object_count  INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS objects (
            id                   INTEGER PRIMARY KEY AUTOINCREMENT,
            upload_id            INTEGER REFERENCES uploads(id) ON DELETE CASCADE,
            object_index         INTEGER,
            -- extracted key fields for fast filtering
            object_class         TEXT,
            primary_class        TEXT,   -- last element of objectClass list
            cn                   TEXT,
            distinguished_name   TEXT,
            sam_account_name     TEXT,
            user_principal_name  TEXT,
            description          TEXT,
            -- ISO-8601 UTC datetimes (NULL when not present / never / overflow)
            when_created         TEXT,
            when_changed         TEXT,
            pwd_last_set         TEXT,
            last_logon           TEXT,
            last_logon_timestamp TEXT,
            bad_password_time    TEXT,
            -- integer flags
            user_account_control INTEGER,
            admin_count          INTEGER,
            -- full object serialised as JSON
            fields_json          TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_obj_upload  ON objects(upload_id);
        CREATE INDEX IF NOT EXISTS idx_obj_class   ON objects(primary_class);
        CREATE INDEX IF NOT EXISTS idx_obj_sam     ON objects(sam_account_name);
        CREATE INDEX IF NOT EXISTS idx_obj_wch     ON objects(when_changed);
        CREATE INDEX IF NOT EXISTS idx_obj_pwd     ON objects(pwd_last_set);
        CREATE INDEX IF NOT EXISTS idx_obj_logon   ON objects(last_logon);
        CREATE INDEX IF NOT EXISTS idx_obj_logonts ON objects(last_logon_timestamp);
        """)


init_db()


# ── Timestamp helpers ─────────────────────────────────────────────────────────

_EPOCH_DELTA = 116_444_736_000_000_000  # 100-ns intervals from 1601-01-01 to 1970-01-01
_MAX_FILETIME = 9_223_372_036_854_775_800


def filetime_to_dt(raw) -> str | None:
    """Convert Windows FILETIME integer → ISO-8601 UTC string, or None."""
    try:
        ft = int(raw)
    except (TypeError, ValueError):
        return None
    if ft <= 0 or ft >= _MAX_FILETIME:
        return None
    try:
        seconds = (ft - _EPOCH_DELTA) / 10_000_000
        if seconds < 0 or seconds > 32_503_680_000:  # > year 3000
            return None
        dt = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=seconds)
        return dt.isoformat()
    except (OverflowError, OSError, ValueError):
        return None


def gentime_to_dt(raw) -> str | None:
    """Convert LDAP Generalized Time (YYYYMMDDHHmmss.0Z) → ISO-8601 UTC string."""
    if not raw:
        return None
    try:
        s = re.sub(r"\.\d+Z?$", "", str(raw).strip()).rstrip("Z")
        dt = datetime.strptime(s, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
        return dt.isoformat()
    except ValueError:
        return None


# ── Log parser ────────────────────────────────────────────────────────────────

_FIELD_RE = re.compile(r"^([A-Za-z][A-Za-z0-9_\-\.]*)\s*:\s*(.*)")
_SEP_RE = re.compile(r"^-{4,}\s*$")


def _parse_block(lines: list[str]) -> dict | None:
    fields: dict = {}
    key: str | None = None
    val_parts: list[str] = []

    def _flush():
        if key is None:
            return
        v = " ".join(val_parts).strip()
        existing = fields.get(key)
        if existing is None:
            fields[key] = v
        elif isinstance(existing, list):
            existing.append(v)
        else:
            fields[key] = [existing, v]

    for line in lines:
        if not line.strip():
            continue
        m = _FIELD_RE.match(line)
        if m:
            _flush()
            key = m.group(1)
            val_parts = [m.group(2)]
        elif key is not None:
            val_parts.append(line.strip())

    _flush()
    return fields if fields else None


def parse_log(path: str) -> list[dict]:
    objects: list[dict] = []
    block: list[str] = []

    with open(path, encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            line = raw.rstrip("\r\n")
            if _SEP_RE.match(line):
                if block:
                    obj = _parse_block(block)
                    if obj:
                        objects.append(obj)
                block = []
            else:
                block.append(line)

    if block:
        obj = _parse_block(block)
        if obj:
            objects.append(obj)

    return objects


def _int_or_none(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _str_field(obj: dict, key: str) -> str:
    v = obj.get(key, "")
    return "; ".join(v) if isinstance(v, list) else str(v)


def _primary_class(object_class: str) -> str:
    """Return the last (most specific) class from a comma-separated objectClass string."""
    parts = [p.strip() for p in object_class.split(",") if p.strip()]
    return parts[-1] if parts else object_class


def store_objects(upload_id: int, objects: list[dict]):
    rows = []
    for idx, obj in enumerate(objects):
        oc = _str_field(obj, "objectClass")
        pc = _primary_class(oc)
        rows.append((
            upload_id,
            idx,
            oc,
            pc,
            _str_field(obj, "cn"),
            _str_field(obj, "distinguishedName"),
            _str_field(obj, "sAMAccountName"),
            _str_field(obj, "userPrincipalName"),
            _str_field(obj, "description"),
            gentime_to_dt(obj.get("whenCreated")),
            gentime_to_dt(obj.get("whenChanged")),
            filetime_to_dt(obj.get("pwdLastSet")),
            filetime_to_dt(obj.get("lastLogon")),
            filetime_to_dt(obj.get("lastLogonTimestamp")),
            filetime_to_dt(obj.get("badPasswordTime")),
            _int_or_none(obj.get("userAccountControl")),
            _int_or_none(obj.get("adminCount")),
            json.dumps(obj, ensure_ascii=False),
        ))

    with get_db() as conn:
        conn.executemany(
            """INSERT INTO objects (
                upload_id, object_index, object_class, primary_class,
                cn, distinguished_name, sam_account_name, user_principal_name, description,
                when_created, when_changed, pwd_last_set,
                last_logon, last_logon_timestamp, bad_password_time,
                user_account_control, admin_count, fields_json
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            rows,
        )
        conn.execute(
            "UPDATE uploads SET object_count=? WHERE id=?",
            (len(objects), upload_id),
        )


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/upload", methods=["POST"])
def api_upload():
    if "file" not in request.files:
        return jsonify(error="No file in request"), 400
    f = request.files["file"]
    if not f.filename:
        return jsonify(error="Empty filename"), 400

    orig = f.filename
    stored = f"{uuid.uuid4().hex}_{secure_filename(orig)}"
    dest = UPLOAD_DIR / stored
    f.save(str(dest))

    try:
        objects = parse_log(str(dest))
    except Exception as exc:
        dest.unlink(missing_ok=True)
        return jsonify(error=f"Parse error: {exc}"), 500

    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO uploads (original_name, stored_name) VALUES (?,?)",
            (orig, stored),
        )
        upload_id = cur.lastrowid

    store_objects(upload_id, objects)

    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM uploads WHERE id=?", (upload_id,)
        ).fetchone()

    return jsonify(dict(row)), 201


@app.route("/api/uploads")
def api_list_uploads():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM uploads ORDER BY uploaded_at DESC"
        ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/uploads/<int:uid>", methods=["DELETE"])
def api_delete_upload(uid):
    with get_db() as conn:
        row = conn.execute(
            "SELECT stored_name FROM uploads WHERE id=?", (uid,)
        ).fetchone()
        if not row:
            return jsonify(error="Not found"), 404
        conn.execute("DELETE FROM objects  WHERE upload_id=?", (uid,))
        conn.execute("DELETE FROM uploads  WHERE id=?", (uid,))
    (UPLOAD_DIR / row["stored_name"]).unlink(missing_ok=True)
    return jsonify(ok=True)


@app.route("/api/objects")
def api_list_objects():
    p = request.args
    upload_id          = p.get("upload_id",          type=int)
    search             = p.get("search",             "").strip()
    object_class       = p.get("object_class",       "").strip()
    last_logon_after   = p.get("last_logon_after",   "").strip()
    pwd_changed_after  = p.get("pwd_changed_after",  "").strip()
    changed_after      = p.get("changed_after",      "").strip()
    created_after      = p.get("created_after",      "").strip()
    admin_only         = p.get("admin_only",          "").lower() in ("1", "true")
    page               = max(1, p.get("page",     1,  type=int))
    per_page           = min(200, max(10, p.get("per_page", 50, type=int)))

    where, params = ["1=1"], []

    if upload_id:
        where.append("upload_id = ?")
        params.append(upload_id)

    if search:
        like = f"%{search}%"
        where.append(
            "(fields_json LIKE ? OR cn LIKE ? OR sam_account_name LIKE ? "
            "OR distinguished_name LIKE ? OR description LIKE ?)"
        )
        params.extend([like, like, like, like, like])

    if object_class:
        where.append("primary_class = ?")
        params.append(object_class)

    if last_logon_after:
        where.append(
            "((last_logon IS NOT NULL AND last_logon >= ?) OR "
            " (last_logon_timestamp IS NOT NULL AND last_logon_timestamp >= ?))"
        )
        params.extend([last_logon_after, last_logon_after])

    if pwd_changed_after:
        where.append("pwd_last_set IS NOT NULL AND pwd_last_set >= ?")
        params.append(pwd_changed_after)

    if changed_after:
        where.append("when_changed IS NOT NULL AND when_changed >= ?")
        params.append(changed_after)

    if created_after:
        where.append("when_created IS NOT NULL AND when_created >= ?")
        params.append(created_after)

    if admin_only:
        where.append("admin_count = 1")

    sql_where = " AND ".join(where)
    offset = (page - 1) * per_page

    with get_db() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM objects WHERE {sql_where}", params
        ).fetchone()[0]

        rows = conn.execute(
            f"""SELECT id, upload_id, object_index, object_class, primary_class,
                       cn, distinguished_name, sam_account_name, user_principal_name,
                       description, when_created, when_changed, pwd_last_set,
                       last_logon, last_logon_timestamp, bad_password_time,
                       user_account_control, admin_count
                FROM objects WHERE {sql_where}
                ORDER BY when_changed DESC NULLS LAST, id ASC
                LIMIT ? OFFSET ?""",
            params + [per_page, offset],
        ).fetchall()

    return jsonify({
        "total":    total,
        "page":     page,
        "per_page": per_page,
        "objects":  [dict(r) for r in rows],
    })


@app.route("/api/objects/by-dn")
def api_by_dn():
    dn  = request.args.get("dn", "").strip()
    uid = request.args.get("upload_id", type=int)
    if not dn:
        return jsonify(error="Missing dn parameter"), 400
    with get_db() as conn:
        if uid:
            row = conn.execute(
                "SELECT id FROM objects WHERE upload_id=? AND distinguished_name=?",
                (uid, dn),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT id FROM objects WHERE distinguished_name=? LIMIT 1",
                (dn,),
            ).fetchone()
    if not row:
        return jsonify(error="Not found"), 404
    return jsonify({"id": row["id"]})


@app.route("/api/objects/<int:oid>")
def api_get_object(oid):
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM objects WHERE id=?", (oid,)
        ).fetchone()
    if not row:
        return jsonify(error="Not found"), 404
    d = dict(row)
    d["fields"] = json.loads(d.pop("fields_json", "{}"))
    return jsonify(d)


@app.route("/api/classes")
def api_classes():
    uid = request.args.get("upload_id", type=int)
    with get_db() as conn:
        if uid:
            rows = conn.execute(
                "SELECT primary_class, COUNT(*) as cnt FROM objects "
                "WHERE upload_id=? GROUP BY primary_class ORDER BY cnt DESC",
                (uid,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT primary_class, COUNT(*) as cnt FROM objects "
                "GROUP BY primary_class ORDER BY cnt DESC"
            ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/stats")
def api_stats():
    uid = request.args.get("upload_id", type=int)
    with get_db() as conn:
        if uid:
            base = "WHERE upload_id=?"
            args = [uid]
        else:
            base, args = "", []

        total = conn.execute(
            f"SELECT COUNT(*) FROM objects {base}", args
        ).fetchone()[0]

        users = conn.execute(
            f"SELECT COUNT(*) FROM objects {base + (' AND' if uid else 'WHERE')} primary_class='user'",
            args,
        ).fetchone()[0]

        computers = conn.execute(
            f"SELECT COUNT(*) FROM objects {base + (' AND' if uid else 'WHERE')} primary_class='computer'",
            args,
        ).fetchone()[0]

        groups = conn.execute(
            f"SELECT COUNT(*) FROM objects {base + (' AND' if uid else 'WHERE')} primary_class='group'",
            args,
        ).fetchone()[0]

    return jsonify({
        "total": total,
        "users": users,
        "computers": computers,
        "groups": groups,
    })


if __name__ == "__main__":
    app.run(debug=True, port=5000)
