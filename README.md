# Simple-ADExplorer / BofHound Viewer

A web-based viewer for [bofhound](https://github.com/fortalice/bofhound) Active Directory log files.  
Upload a `.log` file collected from a domain environment, then search, filter and inspect every AD object it contains — all in a local dark-mode interface backed by SQLite.

---

## Features

- **Upload & parse** bofhound `.log` files and SysInternals ADExplorer `.dat` snapshot files (drag-and-drop or file picker); snapshots are converted automatically via [ADExplorerSnapshot](https://github.com/c3c/ADExplorerSnapshot)
- **SQLite storage** — logs are persisted between sessions; switch between multiple uploads
- **Object table** with sortable columns: name / SAM account, object type, account status, description, last logon, password age, last changed
  - Click any column header to sort ascending / descending; active column is highlighted with a ↑ / ↓ indicator
  - Description is truncated in the table; full text appears on hover
- **Sidebar filters**
  - Object type (user, computer, group, OU, GPO, schema objects, …) with object counts
  - Last logon — preset buttons (30 d / 90 d / 6 m / 1 y) or custom date
  - Password last set — same presets / custom date
  - Object last changed — same presets / custom date
  - Object created — same presets / custom date
  - Admin accounts only toggle
  - Favourites-only toggle
  - Full-text search across all fields with optional search operators (see [Search operators](#search-operators))
- **Detail panel** — click any row to see every attribute grouped by category, with:
  - Timestamps decoded from Windows FILETIME and LDAP Generalized Time to human-readable dates + relative age
  - `userAccountControl` decoded to readable flag badges (Enabled / Disabled / Locked / No Pwd Expiry / …)
  - Long binary fields (e.g. `nTSecurityDescriptor`) collapsed by default with an expand toggle
  - **DN navigation** — any Distinguished Name value is a clickable link that opens the referenced object directly in the detail panel; a **← Back** button lets you retrace your path (e.g. open a group → click a `member` DN → navigate to that user)
  - **Tags** — attach arbitrary `#tag` labels to any object; tags persist in the database and are searchable with the `tag:` operator
  - **Notes** — free-text notes field per object; persists in the database; searchable with `notes:yes`
- **Favourites** — click the star (☆/★) on any row or in the detail panel header to mark objects; a dedicated sidebar toggle shows only favourited objects; favourite flags persist in the database across sessions
- **Export** — export the current filtered view as a Markdown table; choose which columns to include via a modal
- **Snapshot time** — each upload records its collection time (auto-detected from the file or set manually via the clock button in the top bar); all relative-age displays ("3 months ago") use this as the reference point instead of wall-clock time
- **Multiple log support** — upload logs from several DCs and switch between them via the top bar

---

## Requirements

- Python 3.11 or later
- Pip / venv

---

## Installation

```bash
# 1. Clone the repository
git clone ssh://forgejo@forgejo.nm1ss.net/Nm1ss/Simple-ADExplorer.git
cd Simple-ADExplorer

# 2. Create and activate a virtual environment
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt
```

---

## Running the application

```bash
python app.py
```

The server starts on **http://localhost:5000** in debug mode.

For a production deployment (optional):

```bash
pip install gunicorn          # Linux / macOS
gunicorn -w 2 -b 0.0.0.0:5000 app:app

# Windows (waitress)
pip install waitress
waitress-serve --port=5000 app:app
```

> **Note:** The application is intended for local/internal use only.  
> Do not expose it to an untrusted network — log files may contain sensitive AD data.

---

## Docker

### Build the image

```bash
make release
# or with a custom version tag
make release VERSION=1.0.0
```

### Run with `docker run`

```bash
docker run -d \
  -p 5000:5000 \
  -v adexplorer-instance:/app/instance \
  -v adexplorer-uploads:/app/uploads \
  --name adexplorer \
  simple-adexplorer:latest
```

Named volumes keep the SQLite database and uploaded log files alive across container restarts and upgrades, while always starting empty on first use.

### Run with Docker Compose

A ready-made `docker-compose.yml` is included:

```bash
docker compose up -d
```

To stop without losing data:

```bash
docker compose down
```

To stop **and wipe all data** (volumes included):

```bash
docker compose down -v
```

The compose file uses named volumes and sets `restart: unless-stopped` so the container starts automatically after a reboot.

---

## Usage

1. Open **http://localhost:5000** in your browser.
2. Click **Upload Log** in the top-right corner.
3. Drag and drop (or browse to) a bofhound `.log` file and click **Upload**.  
   Parsing a 90 000-line log typically takes a few seconds.
4. Use the **sidebar** to filter by object type, date ranges, or keywords.
5. Click any row in the table to open the **detail panel** with all attributes.
6. Switch between previously uploaded logs with the dropdown in the top bar.

### Example log file format

```
cn: Mike Clelland
distinguishedName: CN=Mike Clelland,OU=3rd Line,...
objectClass: top, person, organizationalPerson, user
sAMAccountName: mclelland
userAccountControl: 66048
pwdLastSet: 134129938822946410
lastLogon: 134266146598383587
whenChanged: 20260616150734.0Z
--------------------
cn: Domain Admins
objectClass: top, group
groupType: -2147483646
member: CN=Mike Clelland,...
--------------------
```

Objects are separated by a line of dashes (`--------------------`).

---

## Project structure

```
Simple-ADExplorer/
├── app.py              # Flask application — parser, SQLite logic, REST API
├── requirements.txt    # Python dependencies
├── Makefile            # setup / run / release / clean targets
├── Dockerfile          # Production image (gunicorn, python:3.11-slim)
├── docker-compose.yml  # Compose file with volume mounts for persistence
├── templates/
│   └── index.html      # HTML structure only (no inline CSS or JS)
├── static/
│   ├── style.css       # All custom styles (dark theme, badges, layout)
│   └── app.js          # All application logic (state, API calls, rendering)
├── instance/           # Created at runtime — contains bofhound.db (SQLite)
├── uploads/            # Created at runtime — stores uploaded log files
└── data_origin/        # Sample log files (not committed if added to .gitignore)
```

---

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Main web UI |
| `POST` | `/api/upload` | Upload and parse a log file |
| `GET` | `/api/uploads` | List all uploaded logs |
| `DELETE` | `/api/uploads/<id>` | Delete an upload and all its objects |
| `GET` | `/api/objects` | List objects with optional filters and sorting (see below) |
| `GET` | `/api/objects/<id>` | Full detail for one object |
| `PATCH` | `/api/objects/<id>/favorite` | Toggle the favourite flag for one object |
| `PATCH` | `/api/objects/<id>/comment` | Set or clear the notes text for one object |
| `PATCH` | `/api/objects/<id>/tags` | Replace the tag list for one object (`{"tags": [...]}`) |
| `GET` | `/api/objects/by-dn` | Look up an object by exact Distinguished Name |
| `GET` | `/api/objects/export` | Download the current filtered view as a Markdown table |
| `PATCH` | `/api/uploads/<id>/snapshot_time` | Override the snapshot time for an upload |
| `GET` | `/api/classes` | Object-type counts for the filter sidebar |
| `GET` | `/api/stats` | Summary counts (total, users, computers, groups) |

### `/api/objects` query parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `upload_id` | int | Restrict to one upload |
| `search` | string | Full-text search (CN, SAM, DN, description, all fields) |
| `object_class` | string | Exact primary class (e.g. `user`, `computer`, `group`) |
| `last_logon_after` | ISO-8601 | Objects with last logon after this date |
| `pwd_changed_after` | ISO-8601 | Objects with `pwdLastSet` after this date |
| `changed_after` | ISO-8601 | Objects with `whenChanged` after this date |
| `admin_only` | `1` | Only objects with `adminCount=1` |
| `favorites_only` | `1` | Only objects marked as favourite |
| `sort_by` | string | Column to sort by: `cn`, `primary_class`, `description`, `user_account_control`, `last_logon`, `pwd_last_set`, `when_changed`, `when_created`; omit for natural (parse) order |
| `sort_dir` | `asc` / `desc` | Sort direction (default: `desc`); objects with no value always appear last |
| `page` | int | Page number (default `1`) |
| `per_page` | int | Results per page (default `50`, max `200`) |

### `/api/objects/by-dn` query parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `dn` | string | Exact Distinguished Name to look up |
| `upload_id` | int | Restrict the search to one upload (recommended) |


## Search operators

The search bar accepts plain text (searches CN, SAM, DN, description and all raw fields) and structured `key:value` operators.  Multiple tokens are combined with **AND**.  Prefix any token with `-` to negate it.  The `*` character acts as a wildcard.

| Operator | Description | Examples |
|----------|-------------|---------|
| `type:` / `class:` | Primary object class | `type:user`, `type:computer`, `class:group` |
| `cn:` | Common name | `cn:admin*`, `cn:"John Smith"` |
| `sam:` | SAM account name | `sam:svc_*` |
| `dn:` | Distinguished name | `dn:*,OU=Admin*` |
| `desc:` | Description field | `desc:*server*` |
| `admin:yes/no` | adminCount = 1 | `admin:yes`, `-admin:yes` |
| `disabled:yes/no` | UAC disabled flag | `disabled:yes` |
| `locked:yes/no` | UAC locked-out flag | `locked:yes` |
| `fav:yes/no` | Favourited objects | `fav:yes` |
| `notes:yes/no` | Objects that have a note | `notes:yes`, `-notes:yes` |
| `tag:value` | Objects carrying a specific tag | `tag:group1`, `tag:web*`, `-tag:legacy` |
| `logon:` | Last logon date | `logon:>90d`, `logon:<30d`, `logon:never` |
| `pwd:` | Password last set | `pwd:>365d`, `pwd:>1y`, `pwd:never` |
| `created:` | whenCreated | `created:>1y`, `created:<30d` |
| `changed:` | whenChanged | `changed:>90d`, `changed:<7d` |

**Date value formats:**

| Format | Meaning |
|--------|---------|
| `>Nd` / `>Nm` / `>Ny` | Older than N days / months / years |
| `<Nd` / `<Nm` / `<Ny` | More recent than N days / months / years |
| `>YYYY-MM-DD` | After an absolute date |
| `<YYYY-MM-DD` | Before an absolute date |
| `never` | Value is NULL / never set |

**Examples:**

```
# All enabled admin users
type:user admin:yes -disabled:yes

# Service accounts that haven't logged on in 6 months
cn:svc_* logon:>180d

# Computers with stale passwords
type:computer pwd:>1y

# Users created in the last 30 days
type:user created:<30d

# Objects with "backup" anywhere in their fields
backup

# Groups whose DN contains "Admin"
type:group dn:*Admin*
```

---

## TODO
- Diff two uploads — which objects are new / gone between two snapshots?
