# Simple-ADExplorer / BofHound Viewer

A web-based viewer for [bofhound](https://github.com/fortalice/bofhound) Active Directory log files.  
Upload a `.log` file collected from a domain environment, then search, filter and inspect every AD object it contains — all in a local dark-mode interface backed by SQLite.

---

## Features

- **Upload & parse** bofhound log files (drag-and-drop or file picker)
- **SQLite storage** — logs are persisted between sessions; switch between multiple uploads
- **Object table** with key columns: name / SAM account, object type, account status, last logon, password age, last changed
- **Sidebar filters**
  - Object type (user, computer, group, OU, GPO, schema objects, …) with object counts
  - Last logon — preset buttons (30 d / 90 d / 6 m / 1 y) or custom date
  - Password last set — same presets / custom date
  - Object last changed — same presets / custom date
  - Admin accounts only toggle
  - Full-text search across all fields
- **Detail panel** — click any object to see every attribute, with:
  - Timestamps decoded from Windows FILETIME and LDAP Generalized Time to human-readable dates
  - `userAccountControl` decoded to readable flag badges (Enabled / Disabled / Locked / No Pwd Expiry / …)
  - Long binary fields (e.g. `nTSecurityDescriptor`) collapsed by default with an expand toggle
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
├── templates/
│   └── index.html      # Single-page dark-mode frontend (Tailwind CSS, vanilla JS)
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
| `GET` | `/api/objects` | List objects with optional filters (see below) |
| `GET` | `/api/objects/<id>` | Full detail for one object |
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
| `page` | int | Page number (default `1`) |
| `per_page` | int | Results per page (default `50`, max `200`) |
