import os
import json
import sqlite3
import re
import uuid
import sys
import shutil
import subprocess
import tempfile
import shlex
from datetime import datetime, timedelta, timezone
from pathlib import Path

from flask import Flask, request, jsonify, render_template, Response
from werkzeug.utils import secure_filename

BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"
INSTANCE_DIR = BASE_DIR / "instance"
DB_PATH = INSTANCE_DIR / "bofhound.db"
ADEXPLORER_SCRIPT = BASE_DIR / "ADExplorerSnapshot" / "ADExplorerSnapshot.py"
ADEX_DEPS         = BASE_DIR / "adex_deps"

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
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            original_name       TEXT    NOT NULL,
            stored_name         TEXT    NOT NULL,
            uploaded_at         TEXT    DEFAULT (datetime('now')),
            object_count        INTEGER DEFAULT 0,
            snapshot_time       TEXT,
            based_on_upload_id  INTEGER REFERENCES uploads(id) ON DELETE SET NULL
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
            -- user annotations
            is_favorite          INTEGER DEFAULT 0,
            comment              TEXT,
            tags                 TEXT,
            -- identity key for cross-upload diff
            object_guid          TEXT,
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

        # Add missing columns if the DB was created before they existed.
        upload_cols = {row["name"] for row in conn.execute("PRAGMA table_info(uploads)")}
        if "snapshot_time" not in upload_cols:
            conn.execute("ALTER TABLE uploads ADD COLUMN snapshot_time TEXT")

        # Add missing columns to objects table if they don't exist.
        obj_cols = {row["name"] for row in conn.execute("PRAGMA table_info(objects)")}
        if "tags" not in obj_cols:
            conn.execute("ALTER TABLE objects ADD COLUMN tags TEXT")

        # Add object_guid column to objects table if it doesn't exist, and backfill it from fields_json.objectGUID.
        if "object_guid" not in obj_cols:
            conn.execute("ALTER TABLE objects ADD COLUMN object_guid TEXT")
            conn.execute("""
                UPDATE objects SET object_guid = json_extract(fields_json, '$.objectGUID')
                WHERE object_guid IS NULL AND fields_json IS NOT NULL
            """)

        upload_cols = {row["name"] for row in conn.execute("PRAGMA table_info(uploads)")}
        if "based_on_upload_id" not in upload_cols:
            conn.execute("ALTER TABLE uploads ADD COLUMN based_on_upload_id INTEGER REFERENCES uploads(id) ON DELETE SET NULL")

        # Backfill uploads made before snapshot-time detection existed, using
        # the original file if it's still sitting in UPLOAD_DIR.
        stale = conn.execute(
            "SELECT id, original_name, stored_name FROM uploads WHERE snapshot_time IS NULL"
        ).fetchall()
        for row in stale:
            dest = UPLOAD_DIR / row["stored_name"]
            if not dest.exists():
                continue
            detected = detect_snapshot_time(
                row["original_name"], dest, row["original_name"].lower().endswith(".dat")
            )
            if detected:
                conn.execute(
                    "UPDATE uploads SET snapshot_time=? WHERE id=?", (detected, row["id"])
                )


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


_BOFHOUND_LOG_RE = re.compile(r"_(\d{9,10})_bofhound\.log$", re.IGNORECASE)


def detect_snapshot_time(orig_filename: str, dest_path: Path, is_dat: bool) -> str | None:
    """Best-effort extraction of the snapshot/collection time (UTC) from the uploaded file.

    - .dat (AD Explorer snapshot): the capture FILETIME is baked into the binary
      header at a fixed offset (10-byte signature + 4-byte marker, then an 8-byte
      FILETIME) — see c3c/ADExplorerSnapshot's Header struct.
    - .log (bofhound output): ADExplorerSnapshot names its BOFHound export
      "<server>_<filetimeUnix>_bofhound.log", embedding that same capture time
      as a Unix epoch, so it survives even if only the .log is uploaded.
    """
    if is_dat:
        try:
            with open(dest_path, "rb") as fh:
                header = fh.read(22)
        except OSError:
            return None
        if len(header) < 22:
            return None
        return filetime_to_dt(int.from_bytes(header[14:22], "little"))

    m = _BOFHOUND_LOG_RE.search(orig_filename)
    if not m:
        return None
    try:
        dt = datetime.fromtimestamp(int(m.group(1)), tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None
    if dt.year < 2000 or dt.year > 2100:
        return None
    return dt.isoformat()


def parse_utc_datetime(raw: str) -> str | None:
    """Parse a user-supplied datetime string, assuming UTC when no offset is given."""
    try:
        dt = datetime.fromisoformat(raw.strip())
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat()


# ── Log parser ────────────────────────────────────────────────────────────────

_FIELD_RE    = re.compile(r"^([A-Za-z][A-Za-z0-9_\-\.]*)\s*:\s*(.*)")
_SEP_RE      = re.compile(r"^-{4,}\s*$")
_MULTI_DN_RE = re.compile(r",\s+(?=(?:CN|OU|DC|O|L|C|UID)=)", re.IGNORECASE)


def _parse_block(lines: list[str]) -> dict | None:
    fields: dict = {}
    key: str | None = None
    val_parts: list[str] = []

    def _flush():
        if key is None:
            return
        raw = " ".join(val_parts).strip()
        # Split "DN1, DN2, DN3" single-line multi-value fields into a list.
        # Intra-DN commas never have a trailing space; inter-DN separators do.
        if re.match(r"^(?:CN|OU|DC|O|L|C|UID)=", raw, re.IGNORECASE):
            parts = _MULTI_DN_RE.split(raw)
            v: str | list = parts if len(parts) > 1 else raw
        else:
            v = raw
        existing = fields.get(key)
        if existing is None:
            fields[key] = v
        elif isinstance(existing, list):
            if isinstance(v, list):
                existing.extend(v)
            else:
                existing.append(v)
        else:
            if isinstance(v, list):
                fields[key] = [existing] + v
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
            obj.get("objectGUID") or obj.get("objectguid"),
            json.dumps(obj, ensure_ascii=False),
        ))

    with get_db() as conn:
        conn.executemany(
            """INSERT INTO objects (
                upload_id, object_index, object_class, primary_class,
                cn, distinguished_name, sam_account_name, user_principal_name, description,
                when_created, when_changed, pwd_last_set,
                last_logon, last_logon_timestamp, bad_password_time,
                user_account_control, admin_count, object_guid, fields_json
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            rows,
        )
        conn.execute(
            "UPDATE uploads SET object_count=? WHERE id=?",
            (len(objects), upload_id),
        )


# ── Snapshot diff ────────────────────────────────────────────────────────────

SYSTEM_TAGS = {'new', 'missing'}


def diff_with_baseline(conn, new_upload_id: int, base_upload_id: int):
    """
    Compare new_upload against base_upload by objectGUID (fallback: distinguishedName).
    - Objects in new only     → tag 'new'
    - Objects in both         → inherit comment, non-system tags, is_favorite from base
    - Objects in base only    → copied into new upload tagged 'missing'
    """
    base_rows = conn.execute(
        "SELECT * FROM objects WHERE upload_id=?", (base_upload_id,)
    ).fetchall()

    base_by_guid: dict = {}
    base_by_dn:   dict = {}
    for row in base_rows:
        if row["object_guid"]:
            base_by_guid[row["object_guid"]] = row
        elif row["distinguished_name"]:
            base_by_dn[row["distinguished_name"]] = row

    new_rows = conn.execute(
        "SELECT id, object_guid, distinguished_name, tags FROM objects WHERE upload_id=?",
        (new_upload_id,)
    ).fetchall()

    matched_base_ids: set = set()

    for nr in new_rows:
        base = base_by_guid.get(nr["object_guid"]) if nr["object_guid"] else None
        if base is None and nr["distinguished_name"]:
            base = base_by_dn.get(nr["distinguished_name"])

        cur_tags   = [t for t in json.loads(nr["tags"] or "[]") if t not in SYSTEM_TAGS]

        if base is None:
            conn.execute("UPDATE objects SET tags=? WHERE id=?",
                         (json.dumps(["new"] + cur_tags), nr["id"]))
        else:
            matched_base_ids.add(base["id"])
            old_tags  = [t for t in json.loads(base["tags"] or "[]") if t not in SYSTEM_TAGS]
            merged    = list(dict.fromkeys(cur_tags + old_tags))
            conn.execute(
                "UPDATE objects SET comment=?, tags=?, is_favorite=? WHERE id=?",
                (base["comment"],
                 json.dumps(merged) if merged else None,
                 base["is_favorite"],
                 nr["id"]),
            )

    for row in base_rows:
        if row["id"] in matched_base_ids:
            continue
        old_tags = [t for t in json.loads(row["tags"] or "[]") if t not in SYSTEM_TAGS]
        conn.execute(
            """INSERT INTO objects (
                upload_id, object_index, object_class, primary_class,
                cn, distinguished_name, sam_account_name, user_principal_name,
                description, when_created, when_changed, pwd_last_set,
                last_logon, last_logon_timestamp, bad_password_time,
                user_account_control, admin_count,
                is_favorite, comment, tags, object_guid, fields_json
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (new_upload_id, row["object_index"], row["object_class"], row["primary_class"],
             row["cn"], row["distinguished_name"], row["sam_account_name"],
             row["user_principal_name"], row["description"],
             row["when_created"], row["when_changed"], row["pwd_last_set"],
             row["last_logon"], row["last_logon_timestamp"], row["bad_password_time"],
             row["user_account_control"], row["admin_count"],
             row["is_favorite"], row["comment"],
             json.dumps(["missing"] + old_tags),
             row["object_guid"], row["fields_json"]),
        )

    total = conn.execute(
        "SELECT COUNT(*) FROM objects WHERE upload_id=?", (new_upload_id,)
    ).fetchone()[0]
    conn.execute("UPDATE uploads SET object_count=? WHERE id=?", (total, new_upload_id))


# ── ADExplorer snapshot conversion ───────────────────────────────────────────

def convert_adsnapshot(snapshot_path: str) -> str:
    """Convert a .adsnapshot file to a bofhound .log using ADExplorerSnapshot.
    Returns path to the converted log file (temporary — caller must delete it)."""
    if not ADEXPLORER_SCRIPT.exists():
        raise RuntimeError(
            "ADExplorerSnapshot tool not found. "
            "Run: git clone --depth 1 https://github.com/c3c/ADExplorerSnapshot.git ADExplorerSnapshot"
        )

    tmp_out = Path(tempfile.mkdtemp(prefix="adex_"))
    try:
        env = os.environ.copy()
        env["PYTHONPATH"] = str(ADEX_DEPS) + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")

        result = subprocess.run(
            [sys.executable, str(ADEXPLORER_SCRIPT), "-o", str(tmp_out), "-m", "BOFHound", snapshot_path],
            capture_output=True,
            text=True,
            timeout=600,
            env=env,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or "Conversion failed with no output")

        logs = list(tmp_out.glob("*.log"))
        if not logs:
            raise RuntimeError("Conversion produced no .log output file")

        # Move out of the temp dir before it is deleted
        out_path = snapshot_path + ".converted.log"
        shutil.move(str(logs[0]), out_path)
        return out_path
    finally:
        shutil.rmtree(str(tmp_out), ignore_errors=True)


init_db()


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
    is_dat = orig.lower().endswith(".dat")

    user_snapshot_time  = (request.form.get("snapshot_time") or "").strip()
    based_on_upload_id  = request.form.get("based_on_upload_id", type=int) or None

    snapshot_time = None
    if user_snapshot_time:
        snapshot_time = parse_utc_datetime(user_snapshot_time)
        if snapshot_time is None:
            return jsonify(error="Invalid snapshot_time"), 400

    stored = f"{uuid.uuid4().hex}_{secure_filename(orig)}"
    dest = UPLOAD_DIR / stored
    f.save(str(dest))

    if snapshot_time is None:
        snapshot_time = detect_snapshot_time(orig, dest, is_dat) or datetime.now(timezone.utc).isoformat()

    converted_log = None
    try:
        if is_dat:
            converted_log = convert_adsnapshot(str(dest))
            log_path = converted_log
        else:
            log_path = str(dest)
        objects = parse_log(log_path)
    except Exception as exc:
        dest.unlink(missing_ok=True)
        return jsonify(error=str(exc)), 500
    finally:
        if converted_log:
            Path(converted_log).unlink(missing_ok=True)

    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO uploads (original_name, stored_name, snapshot_time, based_on_upload_id) VALUES (?,?,?,?)",
            (orig, stored, snapshot_time, based_on_upload_id),
        )
        upload_id = cur.lastrowid

    store_objects(upload_id, objects)

    if based_on_upload_id:
        with get_db() as conn:
            diff_with_baseline(conn, upload_id, based_on_upload_id)

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


@app.route("/api/uploads/<int:uid>/snapshot_time", methods=["PATCH"])
def api_set_snapshot_time(uid):
    body = request.get_json(force=True, silent=True) or {}
    raw = str(body.get("snapshot_time", "")).strip()
    if not raw:
        return jsonify(error="snapshot_time is required"), 400
    snapshot_time = parse_utc_datetime(raw)
    if snapshot_time is None:
        return jsonify(error="Invalid snapshot_time"), 400

    with get_db() as conn:
        if not conn.execute("SELECT 1 FROM uploads WHERE id=?", (uid,)).fetchone():
            return jsonify(error="Not found"), 404
        conn.execute("UPDATE uploads SET snapshot_time=? WHERE id=?", (snapshot_time, uid))
    return jsonify({"snapshot_time": snapshot_time})


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


# ── Search query parser ───────────────────────────────────────────────────────

_SEARCH_TOKEN_RE  = re.compile(r'^(-?)([A-Za-z_]+):(.+)$')
_RELATIVE_DATE_RE = re.compile(r'^([<>])(\d+)(d|m|y)$', re.IGNORECASE)
_ABS_DATE_RE      = re.compile(r'^([<>])(\d{4}-\d{2}-\d{2}.*)$')

_OP_STRING = {
    'type': 'primary_class', 'class': 'primary_class',
    'cn':   'cn',
    'sam':  'sam_account_name',
    'dn':   'distinguished_name',
    'desc': 'description',
}

_OP_DATE = {
    'logon':   'LOGON',       # LOGON = MAX of last_logon / last_logon_timestamp
    'nologon': 'LOGON',
    'pwd':     'pwd_last_set',
    'created': 'when_created',
    'changed': 'when_changed',
}


def _date_condition(col: str, value: str, negate: bool, now: datetime):
    is_logon = col == 'LOGON'
    expr = "MAX(COALESCE(last_logon,''), COALESCE(last_logon_timestamp,''))" if is_logon else col

    if value.lower() == 'never':
        core = "(last_logon IS NULL AND last_logon_timestamp IS NULL)" if is_logon else f"({col} IS NULL)"
        return (f"NOT {core}" if negate else core), []

    m = _RELATIVE_DATE_RE.match(value)
    if m:
        direction = m.group(1)
        amt, unit = int(m.group(2)), m.group(3).lower()
        days = amt * (365 if unit == 'y' else 30 if unit == 'm' else 1)
        cutoff = (now - timedelta(days=days)).isoformat()
        # >Nd = "older than N days" → col < cutoff; <Nd = "newer than N days" → col >= cutoff
        op_sql = ('>=' if negate else '<') if direction == '>' else ('<' if negate else '>=')
        return f"({expr} IS NOT NULL AND {expr} {op_sql} ?)", [cutoff]

    m = _ABS_DATE_RE.match(value)
    if m:
        direction, date_val = m.group(1), m.group(2)
        op_sql = ('<=' if negate else '>') if direction == '>' else ('>' if negate else '<=')
        return f"({expr} IS NOT NULL AND {expr} {op_sql} ?)", [date_val]

    return None, []


def parse_search_query(search_str: str, now: datetime):
    """Parse a search string with optional operators into (conditions, params)."""
    conditions, params, plain_terms = [], [], []

    try:
        tokens = shlex.split(search_str)
    except ValueError:
        tokens = search_str.split()

    for token in tokens:
        m = _SEARCH_TOKEN_RE.match(token)
        if not m:
            plain_terms.append(token)
            continue

        negate = m.group(1) == '-'
        op     = m.group(2).lower()
        value  = m.group(3)
        NOT    = "NOT " if negate else ""

        if op in _OP_STRING:
            like = value.replace('*', '%')
            conditions.append(f"LOWER({_OP_STRING[op]}) {NOT}LIKE LOWER(?)")
            params.append(like)

        elif op == 'admin':
            yes = value.lower() in ('yes', 'true', '1', 'y')
            if yes ^ negate:
                conditions.append("admin_count = 1")
            else:
                conditions.append("(admin_count IS NULL OR admin_count != 1)")

        elif op in ('disabled', 'locked'):
            bit = 0x0002 if op == 'disabled' else 0x0010
            yes = value.lower() in ('yes', 'true', '1', 'y')
            if yes ^ negate:
                conditions.append(f"(user_account_control & {bit}) != 0")
            else:
                conditions.append(f"(user_account_control IS NOT NULL AND (user_account_control & {bit}) = 0)")

        elif op == 'fav':
            yes = value.lower() in ('yes', 'true', '1', 'y')
            if yes ^ negate:
                conditions.append("is_favorite = 1")
            else:
                conditions.append("(is_favorite IS NULL OR is_favorite = 0)")

        elif op == 'notes':
            yes = value.lower() in ('yes', 'true', '1', 'y')
            if yes ^ negate:
                conditions.append("(comment IS NOT NULL AND comment != '')")
            else:
                conditions.append("(comment IS NULL OR comment = '')")

        elif op == 'tag':
            pat = f'%"{value.replace("*", "%")}"%'
            if negate:
                conditions.append("(tags IS NULL OR tags NOT LIKE ?)")
            else:
                conditions.append("(tags IS NOT NULL AND tags LIKE ?)")
            params.append(pat)

        elif op in _OP_DATE:
            cond, p = _date_condition(_OP_DATE[op], value, negate, now)
            if cond:
                conditions.append(cond)
                params.extend(p)
            else:
                plain_terms.append(token)

        else:
            plain_terms.append(token)

    for term in plain_terms:
        like = '%' + term.replace('*', '%') + '%'
        conditions.append(
            "(fields_json LIKE ? OR cn LIKE ? OR sam_account_name LIKE ? "
            "OR distinguished_name LIKE ? OR description LIKE ?)"
        )
        params.extend([like, like, like, like, like])

    return conditions, params


_SORT_EXPRS = {
    "cn":                   "LOWER(COALESCE(cn, ''))",
    "primary_class":        "LOWER(COALESCE(primary_class, ''))",
    "user_account_control": "user_account_control",
    "description":          "LOWER(COALESCE(description, ''))",
    "last_logon":           "MAX(COALESCE(last_logon, ''), COALESCE(last_logon_timestamp, ''))",
    "pwd_last_set":         "pwd_last_set",
    "when_changed":         "when_changed",
    "when_created":         "when_created",
}


def build_object_filter(p):
    """Turn the shared object-list query params into (where_sql, params, order_sql).

    Shared by /api/objects and /api/objects/export so the two never drift apart.
    """
    upload_id          = p.get("upload_id",          type=int)
    search             = p.get("search",             "").strip()
    object_class       = p.get("object_class",       "").strip()
    last_logon_after   = p.get("last_logon_after",   "").strip()
    pwd_changed_after  = p.get("pwd_changed_after",  "").strip()
    changed_after      = p.get("changed_after",      "").strip()
    created_after      = p.get("created_after",      "").strip()
    admin_only         = p.get("admin_only",          "").lower() in ("1", "true")
    favorites_only     = p.get("favorites_only",      "").lower() in ("1", "true")

    where, params = ["1=1"], []

    if upload_id:
        where.append("upload_id = ?")
        params.append(upload_id)

    if search:
        search_conds, search_params = parse_search_query(search, datetime.now(timezone.utc))
        where.extend(search_conds)
        params.extend(search_params)

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

    if favorites_only:
        where.append("is_favorite = 1")

    sort_by  = p.get("sort_by",  "").strip()
    sort_dir = p.get("sort_dir", "desc").lower()
    if sort_dir not in ("asc", "desc"):
        sort_dir = "desc"
    if sort_by and sort_by in _SORT_EXPRS:
        order_sql = f"{_SORT_EXPRS[sort_by]} {sort_dir.upper()} NULLS LAST"
    else:
        order_sql = "id ASC"

    return " AND ".join(where), params, order_sql


@app.route("/api/objects")
def api_list_objects():
    p = request.args
    page     = max(1, p.get("page", 1, type=int))
    per_page = min(200, max(10, p.get("per_page", 50, type=int)))

    sql_where, params, order_sql = build_object_filter(p)
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
                       user_account_control, admin_count, is_favorite, comment, tags
                FROM objects WHERE {sql_where}
                ORDER BY {order_sql}
                LIMIT ? OFFSET ?""",
            params + [per_page, offset],
        ).fetchall()

    return jsonify({
        "total":    total,
        "page":     page,
        "per_page": per_page,
        "objects":  [{**dict(r), "tags": json.loads(r["tags"] or "[]")} for r in rows],
    })


# ── Markdown export ──────────────────────────────────────────────────────────

EXPORT_FIELDS = {
    "cn":                  "Name",
    "sam_account_name":    "SAM Account Name",
    "primary_class":       "Type",
    "distinguished_name":  "Distinguished Name",
    "user_principal_name": "UPN",
    "description":         "Description",
    "status":              "Status",
    "last_logon":          "Last Logon",
    "pwd_last_set":        "Pwd Changed",
    "when_changed":        "Changed",
    "when_created":        "Created",
    "comment":             "Notes",
}


def _export_field_value(row, field):
    if field == "status":
        uac = row["user_account_control"]
        if uac is None:
            return "—"
        status = "Disabled" if uac & 0x0002 else "Locked" if uac & 0x0010 else "Enabled"
        if row["admin_count"] == 1:
            status += ", Admin"
        return status
    if field == "last_logon":
        return max(row["last_logon"] or "", row["last_logon_timestamp"] or "") or "—"
    val = row[field]
    return str(val) if val not in (None, "") else "—"


def _md_escape(s):
    return s.replace("|", "\\|").replace("\n", " ").strip()


@app.route("/api/objects/export")
def api_export_objects():
    p = request.args
    sql_where, params, order_sql = build_object_filter(p)

    fields = [f for f in p.get("fields", "").split(",") if f in EXPORT_FIELDS]
    if not fields:
        return jsonify(error="No valid fields selected"), 400

    needed_cols = {"id"}
    for f in fields:
        if f == "status":
            needed_cols.update(["user_account_control", "admin_count"])
        elif f == "last_logon":
            needed_cols.update(["last_logon", "last_logon_timestamp"])
        else:
            needed_cols.add(f)

    with get_db() as conn:
        rows = conn.execute(
            f"SELECT {', '.join(sorted(needed_cols))} FROM objects "
            f"WHERE {sql_where} ORDER BY {order_sql}",
            params,
        ).fetchall()

    headers = [EXPORT_FIELDS[f] for f in fields]
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        lines.append(
            "| " + " | ".join(_md_escape(_export_field_value(row, f)) for f in fields) + " |"
        )

    filename = f"adexplorer-export-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.md"
    return Response(
        "\n".join(lines) + "\n",
        mimetype="text/markdown",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


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


@app.route("/api/objects/<int:oid>/comment", methods=["PATCH"])
def api_set_comment(oid):
    body = request.get_json(silent=True) or {}
    comment = str(body.get("comment", "")).strip() or None
    with get_db() as conn:
        if not conn.execute("SELECT 1 FROM objects WHERE id=?", (oid,)).fetchone():
            return jsonify(error="Not found"), 404
        conn.execute("UPDATE objects SET comment=? WHERE id=?", (comment, oid))
    return jsonify({"comment": comment})


@app.route("/api/objects/<int:oid>/tags", methods=["PATCH"])
def api_set_tags(oid):
    body = request.get_json(silent=True) or {}
    raw = body.get("tags", [])
    if not isinstance(raw, list):
        return jsonify(error="tags must be an array"), 400
    cleaned = list(dict.fromkeys(
        t.strip().lstrip('#') for t in raw if isinstance(t, str) and t.strip()
    ))
    with get_db() as conn:
        if not conn.execute("SELECT 1 FROM objects WHERE id=?", (oid,)).fetchone():
            return jsonify(error="Not found"), 404
        conn.execute("UPDATE objects SET tags=? WHERE id=?",
                     (json.dumps(cleaned) if cleaned else None, oid))
    return jsonify({"tags": cleaned})


@app.route("/api/objects/<int:oid>/favorite", methods=["PATCH"])
def api_toggle_favorite(oid):
    with get_db() as conn:
        row = conn.execute("SELECT is_favorite FROM objects WHERE id=?", (oid,)).fetchone()
        if not row:
            return jsonify(error="Not found"), 404
        new_val = 0 if row["is_favorite"] else 1
        conn.execute("UPDATE objects SET is_favorite=? WHERE id=?", (new_val, oid))
    return jsonify({"is_favorite": bool(new_val)})


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
    d["tags"] = json.loads(d.get("tags") or "[]")
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
            base      = "WHERE upload_id=?"
            base_real = "WHERE upload_id=? AND (tags IS NULL OR tags NOT LIKE '%\"missing\"%')"
            base_miss = "WHERE upload_id=? AND tags LIKE '%\"missing\"%'"
            args = [uid]
        else:
            base = base_real = base_miss = ""
            args = []

        def _and(clause):
            return ("AND" if args else "WHERE") + " " + clause

        total     = conn.execute(f"SELECT COUNT(*) FROM objects {base_real}", args).fetchone()[0]
        missing_t = conn.execute(f"SELECT COUNT(*) FROM objects {base_miss}", args).fetchone()[0]

        clause_user     = _and("primary_class='user'")
        clause_computer = _and("primary_class='computer'")
        clause_group    = _and("primary_class='group'")

        users     = conn.execute(f"SELECT COUNT(*) FROM objects {base_real} {clause_user}",     args).fetchone()[0]
        missing_u = conn.execute(f"SELECT COUNT(*) FROM objects {base_miss} {clause_user}",     args).fetchone()[0]

        computers     = conn.execute(f"SELECT COUNT(*) FROM objects {base_real} {clause_computer}", args).fetchone()[0]
        missing_c     = conn.execute(f"SELECT COUNT(*) FROM objects {base_miss} {clause_computer}", args).fetchone()[0]

        groups     = conn.execute(f"SELECT COUNT(*) FROM objects {base_real} {clause_group}",   args).fetchone()[0]
        missing_g  = conn.execute(f"SELECT COUNT(*) FROM objects {base_miss} {clause_group}",   args).fetchone()[0]

    return jsonify({
        "total":            total,
        "total_missing":    missing_t,
        "users":            users,
        "users_missing":    missing_u,
        "computers":        computers,
        "computers_missing": missing_c,
        "groups":           groups,
        "groups_missing":   missing_g,
    })


if __name__ == "__main__":
    app.run(debug=True, port=5000)
