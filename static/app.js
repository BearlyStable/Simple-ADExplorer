// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function qs(sel, ctx = document) { return ctx.querySelector(sel); }
function qsa(sel, ctx = document) { return ctx.querySelectorAll(sel); }

function showToast(msg, type = 'ok') {
  const el = qs('#toast');
  el.textContent = msg;
  el.style.background = type === 'ok' ? '#14532d' : '#7f1d1d';
  el.style.color       = type === 'ok' ? '#86efac' : '#fca5a5';
  el.style.border      = type === 'ok' ? '1px solid #16a34a' : '1px solid #991b1b';
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 3000);
}

function timeAgo(iso) {
  if (!iso) return '—';
  const sec = (Date.now() - new Date(iso)) / 1000;
  if (sec < 0)          return new Date(iso).toLocaleDateString();
  if (sec < 3600)       return `${Math.round(sec / 60)}m ago`;
  if (sec < 86400)      return `${Math.round(sec / 3600)}h ago`;
  if (sec < 86400 * 30) return `${Math.round(sec / 86400)}d ago`;
  if (sec < 86400 * 365) return `${Math.round(sec / 86400 / 30)}mo ago`;
  return `${Math.round(sec / 86400 / 365)}y ago`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toISOString().slice(0, 16).replace('T', ' ');
}

function daysAgoISO(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────────────────────────
// Type badges & UAC
// ─────────────────────────────────────────────────────────────────────────────

function classBadge(primaryClass) {
  const c = (primaryClass || '').toLowerCase();
  let css = 'tag-default', label = primaryClass || '?';
  if (c === 'user' || c === 'person')                                   { css = 'tag-user';     label = 'user'; }
  else if (c === 'computer')                                            { css = 'tag-computer'; label = 'computer'; }
  else if (c === 'group')                                               { css = 'tag-group';    label = 'group'; }
  else if (['classschema','attributeschema','subschema'].includes(c))   { css = 'tag-schema';   label = c; }
  else if (c === 'organizationalunit')                                  { css = 'tag-ou';       label = 'OU'; }
  else if (c === 'grouppolicycontainer')                                { css = 'tag-policy';   label = 'GPO'; }
  else if (['pkicertificatetemplate','certificationauthority'].includes(c)) { css = 'tag-cert'; label = 'PKI'; }
  else { label = c.length > 18 ? c.slice(0, 16) + '…' : c; }
  return `<span class="badge ${css}">${esc(label)}</span>`;
}

const UAC_FLAGS = [
  [0x0002,    'Disabled',           'uac-disabled'],
  [0x0010,    'Locked',             'uac-disabled'],
  [0x0200,    'Normal Acct',        'uac-ok'],
  [0x2000,    'Interdomain Trust',  'uac-flag'],
  [0x10000,   'No Pwd Expiry',      'uac-flag'],
  [0x20000,   'Smartcard Req',      'uac-flag'],
  [0x80000,   'Trusted Delegation', 'uac-flag'],
  [0x400000,  'No Preauth',         'uac-disabled'],
  [0x1000000, 'Auth Delegation',    'uac-flag'],
];

function uacBadges(uac) {
  if (!uac) return '';
  const flags = UAC_FLAGS.filter(([bit]) => uac & bit);
  if (!flags.length) return `<span class="badge tag-default">${uac}</span>`;
  return flags.map(([, label, css]) => `<span class="badge ${css}">${label}</span>`).join(' ');
}

function statusBadge(uac, adminCount) {
  if (uac === null || uac === undefined) return '<span style="color:#475569">—</span>';
  const disabled = uac & 0x0002;
  const locked   = uac & 0x0010;
  let html = disabled
    ? '<span class="badge uac-disabled">Disabled</span> '
    : locked
      ? '<span class="badge uac-disabled">Locked</span> '
      : '<span class="badge uac-ok">Enabled</span> ';
  if (adminCount === 1) html += '<span class="badge" style="background:#3a1a10;color:#fb923c;border-color:#ea580c">Admin</span>';
  return html;
}

// ─────────────────────────────────────────────────────────────────────────────
// Timestamp helpers (mirror server-side logic in the browser)
// ─────────────────────────────────────────────────────────────────────────────

function filetime_client(raw) {
  const ft = parseInt(raw);
  if (!raw || isNaN(ft) || ft <= 0 || ft >= 9223372036854775800) return null;
  const ms = (ft - 116444736000000000) / 10000;
  if (ms < 0) return null;
  return new Date(ms).toISOString();
}

function gentimeClient(raw) {
  if (!raw) return null;
  try {
    const s  = raw.replace(/\.\d+Z?$/, '').replace(/Z$/, '');
    const y  = s.slice(0, 4), mo = s.slice(4, 6), d  = s.slice(6, 8);
    const h  = s.slice(8, 10)  || '00';
    const mi = s.slice(10, 12) || '00';
    const sec = s.slice(12, 14) || '00';
    return new Date(`${y}-${mo}-${d}T${h}:${mi}:${sec}Z`).toISOString();
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

const state = {
  uploads: [],
  selectedUploadId: null,
  selectedClassFilter: null,
  logonDate: '',
  pwdDate: '',
  changedDate: '',
  search: '',
  adminOnly: false,
  page: 1,
  perPage: 50,
  total: 0,
  selectedObjectId: null,
  logonPreset: null,
  pwdPreset: null,
  changedPreset: null,
  sortBy: 'when_changed',
  sortDir: 'desc',
};

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────

async function api(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Uploads
// ─────────────────────────────────────────────────────────────────────────────

async function loadUploads() {
  const data = await api('/api/uploads');
  state.uploads = data;
  const sel = qs('#upload-select');
  sel.innerHTML = '<option value="">— no log loaded —</option>' +
    data.map(u =>
      `<option value="${u.id}">${esc(u.original_name)} (${u.object_count} objects, ${u.uploaded_at.slice(0, 16)})</option>`
    ).join('');
  if (data.length > 0 && !state.selectedUploadId) {
    state.selectedUploadId = data[0].id;
    sel.value = data[0].id;
  } else if (state.selectedUploadId) {
    sel.value = state.selectedUploadId;
  }
  qs('#delete-upload-btn').style.display = data.length ? '' : 'none';
  await refreshAll();
}

qs('#upload-select').addEventListener('change', async e => {
  state.selectedUploadId = e.target.value ? parseInt(e.target.value) : null;
  state.page = 1;
  state.selectedClassFilter = null;
  qs('#delete-upload-btn').style.display = state.selectedUploadId ? '' : 'none';
  await refreshAll();
});

qs('#delete-upload-btn').addEventListener('click', async () => {
  if (!state.selectedUploadId) return;
  const name = qs('#upload-select').options[qs('#upload-select').selectedIndex].text;
  if (!confirm(`Delete "${name}"?\nThis will remove all parsed data.`)) return;
  const r = await fetch(`/api/uploads/${state.selectedUploadId}`, { method: 'DELETE' });
  if (!r.ok) { showToast('Delete failed', 'err'); return; }
  state.selectedUploadId = null;
  showToast('Upload deleted');
  await loadUploads();
});

// ─────────────────────────────────────────────────────────────────────────────
// Stats & Classes
// ─────────────────────────────────────────────────────────────────────────────

async function loadStats() {
  const url = state.selectedUploadId
    ? `/api/stats?upload_id=${state.selectedUploadId}`
    : '/api/stats';
  const s = await api(url);
  qs('#stat-total').textContent     = s.total;
  qs('#stat-users').textContent     = s.users;
  qs('#stat-computers').textContent = s.computers;
  qs('#stat-groups').textContent    = s.groups;
}

async function loadClasses() {
  const url = state.selectedUploadId
    ? `/api/classes?upload_id=${state.selectedUploadId}`
    : '/api/classes';
  const classes = await api(url);
  const container = qs('#class-list');

  if (!classes.length) {
    container.innerHTML = '<div style="color:#475569;font-size:0.78rem;padding:4px">—</div>';
    return;
  }

  const total = classes.reduce((a, c) => a + c.cnt, 0);
  const all = `<div class="class-item ${!state.selectedClassFilter ? 'active' : ''}" data-class="">
    <span>All types</span>
    <span style="color:#475569;font-size:0.7rem">${total}</span>
  </div>`;

  const items = classes.map(c => {
    const active = state.selectedClassFilter === c.primary_class ? 'active' : '';
    return `<div class="class-item ${active}" data-class="${esc(c.primary_class)}">
      <span>${classBadge(c.primary_class)}</span>
      <span style="color:#475569;font-size:0.7rem">${c.cnt}</span>
    </div>`;
  }).join('');

  container.innerHTML = all + items;
  qsa('.class-item', container).forEach(el => {
    el.addEventListener('click', () => {
      state.selectedClassFilter = el.dataset.class || null;
      state.page = 1;
      loadClasses();
      loadObjects();
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Objects list
// ─────────────────────────────────────────────────────────────────────────────

function buildQueryParams() {
  const p = new URLSearchParams();
  if (state.selectedUploadId)    p.set('upload_id',        state.selectedUploadId);
  if (state.search)              p.set('search',           state.search);
  if (state.selectedClassFilter) p.set('object_class',     state.selectedClassFilter);
  if (state.logonDate)           p.set('last_logon_after', state.logonDate + 'T00:00:00+00:00');
  if (state.pwdDate)             p.set('pwd_changed_after', state.pwdDate + 'T00:00:00+00:00');
  if (state.changedDate)         p.set('changed_after',    state.changedDate + 'T00:00:00+00:00');
  if (state.adminOnly)           p.set('admin_only',       '1');
  p.set('sort_by',  state.sortBy);
  p.set('sort_dir', state.sortDir);
  p.set('page',     state.page);
  p.set('per_page', state.perPage);
  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// Column sorting
// ─────────────────────────────────────────────────────────────────────────────

function setSortColumn(col) {
  if (state.sortBy === col) {
    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
  } else {
    state.sortBy  = col;
    // sensible defaults: dates descend (newest first), text ascends
    const dateCols = new Set(['last_logon', 'pwd_last_set', 'when_changed']);
    state.sortDir = dateCols.has(col) ? 'desc' : 'asc';
  }
  state.page = 1;
  updateSortHeaders();
  loadObjects();
}

function updateSortHeaders() {
  qsa('th[data-sort]').forEach(th => {
    const icon = th.querySelector('.sort-icon');
    if (!icon) return;
    if (th.dataset.sort === state.sortBy) {
      icon.textContent = state.sortDir === 'asc' ? '↑' : '↓';
      icon.style.opacity = '1';
      th.style.color = '#93c5fd';
    } else {
      icon.textContent = '↕';
      icon.style.opacity = '0.4';
      th.style.color = '';
    }
  });
}

async function loadObjects() {
  const tbody = qs('#objects-tbody');
  tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:#475569">Loading…</td></tr>`;

  const data = await api('/api/objects?' + buildQueryParams());
  state.total = data.total;
  renderObjects(data.objects);
  renderPagination(data.total, data.page, data.per_page);

  qs('#filter-info').textContent = data.total > 0
    ? `Showing ${(data.page - 1) * data.per_page + 1}–${Math.min(data.page * data.per_page, data.total)} of ${data.total}`
    : 'No results';
}

function renderObjects(objects) {
  const tbody = qs('#objects-tbody');
  if (!objects.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:40px;color:#475569">No objects match the current filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = objects.map(o => {
    const bg = o.id === state.selectedObjectId ? 'background:#1e3a5f' : '';

    const nameCell = o.sam_account_name
      ? `<div style="font-weight:600;color:#e2e8f0">${esc(o.cn || o.distinguished_name.split(',')[0])}</div>
         <div style="color:#64748b;font-size:0.7rem">${esc(o.sam_account_name)}</div>`
      : `<div style="font-weight:600;color:#e2e8f0">${esc(o.cn || '?')}</div>
         <div style="color:#475569;font-size:0.7rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px">${esc((o.distinguished_name || '').replace(/,DC=.+$/, ''))}</div>`;

    const bestLogon = (o.last_logon && o.last_logon_timestamp)
      ? (o.last_logon > o.last_logon_timestamp ? o.last_logon : o.last_logon_timestamp)
      : (o.last_logon || o.last_logon_timestamp);

    const logonCell   = bestLogon     ? `<span title="${fmtDate(bestLogon)}">${timeAgo(bestLogon)}</span>`         : `<span style="color:#334155">Never</span>`;
    const pwdCell     = o.pwd_last_set ? `<span title="${fmtDate(o.pwd_last_set)}">${timeAgo(o.pwd_last_set)}</span>` : `<span style="color:#334155">—</span>`;
    const changedCell = o.when_changed ? `<span title="${fmtDate(o.when_changed)}">${timeAgo(o.when_changed)}</span>` : '—';

    return `<tr class="row-hover" data-id="${o.id}" style="border-bottom:1px solid #1e293b;${bg}">
      <td style="padding:7px 10px">${nameCell}</td>
      <td style="padding:7px 10px">${classBadge(o.primary_class)}</td>
      <td style="padding:7px 10px">${statusBadge(o.user_account_control, o.admin_count)}</td>
      <td style="padding:7px 10px;color:#94a3b8">${logonCell}</td>
      <td style="padding:7px 10px;color:#94a3b8">${pwdCell}</td>
      <td style="padding:7px 10px;color:#94a3b8">${changedCell}</td>
    </tr>`;
  }).join('');

  qsa('tr[data-id]', tbody).forEach(row => {
    row.addEventListener('click', () => showDetail(parseInt(row.dataset.id)));
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Pagination
// ─────────────────────────────────────────────────────────────────────────────

function renderPagination(total, page, perPage) {
  const totalPages = Math.ceil(total / perPage);
  const ctrl = qs('#pagination-controls');
  if (totalPages <= 1) { ctrl.innerHTML = ''; return; }

  const pageNums = [];
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || (p >= page - 2 && p <= page + 2)) {
      pageNums.push(p);
    } else if (pageNums.at(-1) !== '…') {
      pageNums.push('…');
    }
  }

  ctrl.innerHTML = `
    <button class="pagination-btn" id="pg-prev" ${page <= 1 ? 'disabled' : ''}>&#8592;</button>
    ${pageNums.map(p => p === '…'
      ? `<span style="color:#475569;padding:0 4px">…</span>`
      : `<button class="pagination-btn ${p === page ? 'current' : ''}" data-page="${p}">${p}</button>`
    ).join('')}
    <button class="pagination-btn" id="pg-next" ${page >= totalPages ? 'disabled' : ''}>&#8594;</button>
  `;

  qs('#pg-prev')?.addEventListener('click', () => { if (state.page > 1) { state.page--; loadObjects(); } });
  qs('#pg-next')?.addEventListener('click', () => { if (state.page < totalPages) { state.page++; loadObjects(); } });
  qsa('[data-page]', ctrl).forEach(btn => {
    btn.addEventListener('click', () => { state.page = parseInt(btn.dataset.page); loadObjects(); });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail panel — navigation history
// ─────────────────────────────────────────────────────────────────────────────

const detailHistory = [];

async function showDetail(id, pushToHistory = true) {
  if (pushToHistory && state.selectedObjectId !== null && state.selectedObjectId !== id) {
    detailHistory.push(state.selectedObjectId);
  }
  state.selectedObjectId = id;
  qs('#detail-back-btn').style.display = detailHistory.length ? '' : 'none';

  qsa('tr[data-id]').forEach(r => {
    r.style.background = parseInt(r.dataset.id) === id ? '#1e3a5f' : '';
  });

  qs('#detail-panel').style.display = 'flex';
  qs('#detail-content').innerHTML = '<div style="color:#475569;padding:20px">Loading…</div>';

  const obj = await api(`/api/objects/${id}`);
  renderDetail(obj);
}

async function navigateToDN(dn) {
  const uid = state.selectedUploadId;
  const url = '/api/objects/by-dn?dn=' + encodeURIComponent(dn) +
              (uid ? '&upload_id=' + uid : '');
  try {
    const result = await api(url);
    await showDetail(result.id, true);
  } catch {
    showToast('Object not found in this upload', 'err');
  }
}

qs('#detail-back-btn').addEventListener('click', async () => {
  if (!detailHistory.length) return;
  const prevId = detailHistory.pop();
  qs('#detail-back-btn').style.display = detailHistory.length ? '' : 'none';
  await showDetail(prevId, false);
});

qs('#close-detail-btn').addEventListener('click', () => {
  qs('#detail-panel').style.display = 'none';
  state.selectedObjectId = null;
  detailHistory.length = 0;
  qs('#detail-back-btn').style.display = 'none';
  qsa('tr[data-id]').forEach(r => r.style.background = '');
});

// ─────────────────────────────────────────────────────────────────────────────
// Detail panel — DN link helpers
// ─────────────────────────────────────────────────────────────────────────────

let _dnRegistry = [];

function isDN(s) {
  return typeof s === 'string' && /^(?:CN|OU|DC|O|L|C|UID)=/i.test(s) && s.includes(',');
}

function renderDNLink(dn) {
  const idx = _dnRegistry.length;
  _dnRegistry.push(dn);
  return `<a class="dn-link" href="#" data-dn-idx="${idx}" title="Open this object in detail panel">${esc(dn)}</a>`;
}

function maybeDNLink(v) {
  return isDN(v) ? renderDNLink(v) : `<span style="color:#e2e8f0">${esc(v)}</span>`;
}

function attachDNLinks(container) {
  qsa('.dn-link', container).forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      navigateToDN(_dnRegistry[parseInt(a.dataset.dnIdx)]);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Detail panel — field rendering
// ─────────────────────────────────────────────────────────────────────────────

const LONG_FIELDS = new Set([
  'nTSecurityDescriptor', 'auditingPolicy', 'dSASignature',
  'cACertificate', 'certificateRevocationList', 'deltaRevocationList',
  'authorityRevocationList', 'retiredReplDSASignatures', 'replUpToDateVector',
  'dSCorePropagationData', 'msDS-KeyCredentialLink',
]);

const DATE_FIELDS   = new Set(['pwdLastSet','lastLogon','lastLogonTimestamp','badPasswordTime','creationTime','accountExpires']);
const GENTIME_FIELDS = new Set(['whenCreated','whenChanged']);

const GROUP_ORDER = [
  ['Identity',    ['cn','name','sAMAccountName','userPrincipalName','distinguishedName','objectGUID','objectSid','objectClass','primaryGroupID']],
  ['Account',     ['userAccountControl','adminCount','description','givenName','sn','displayName','codePage','countryCode','l','ou']],
  ['Timestamps',  ['whenCreated','whenChanged','pwdLastSet','lastLogon','lastLogonTimestamp','badPasswordTime','accountExpires','creationTime']],
  ['Group Info',  ['member','memberOf','groupType']],
  ['Security',    ['adminCount','nTSecurityDescriptor','auditingPolicy']],
  ['Replication', ['uSNCreated','uSNChanged','dSCorePropagationData','instanceType','isCriticalSystemObject','systemFlags']],
];

function renderDetail(obj) {
  _dnRegistry = [];
  const fields = obj.fields || {};
  const title  = fields.cn || fields.name || obj.cn || 'Object';
  qs('#detail-title').textContent = title;

  const seen = new Set();
  let html = '';

  if (fields.userAccountControl !== undefined) {
    const uac = parseInt(fields.userAccountControl) || 0;
    html += `<div style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px 14px;margin-bottom:14px">
      <div style="color:#64748b;font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Account Status</div>
      <div>${uacBadges(uac)}</div>
    </div>`;
  }

  function renderField(key, val) {
    if (seen.has(key)) return '';
    seen.add(key);
    if (val === undefined || val === null || val === '') return '';

    const valStr = Array.isArray(val) ? val.join('\n') : String(val);
    let displayVal = '';

    if (DATE_FIELDS.has(key)) {
      const dt = filetime_client(valStr);
      if (dt) {
        displayVal = `<span style="color:#e2e8f0">${fmtDate(dt)}</span> <span style="color:#475569;font-size:0.72rem">(${timeAgo(dt)})</span><br><span style="color:#334155;font-size:0.7rem">raw: ${esc(valStr)}</span>`;
      } else if (valStr === '0') {
        displayVal = `<span style="color:#475569">Never / Not set</span>`;
      } else {
        displayVal = `<span style="color:#475569;font-size:0.72rem">${esc(valStr)}</span>`;
      }
    } else if (GENTIME_FIELDS.has(key)) {
      const iso = gentimeClient(valStr);
      displayVal = iso
        ? `<span style="color:#e2e8f0">${fmtDate(iso)}</span> <span style="color:#475569;font-size:0.72rem">(${timeAgo(iso)})</span>`
        : `<span style="color:#e2e8f0">${esc(valStr)}</span>`;
    } else if (Array.isArray(val)) {
      displayVal = val.map(v => `<div>${maybeDNLink(v)}</div>`).join('');
    } else if (LONG_FIELDS.has(key) || valStr.length > 300) {
      const shortId = `field-${key}-${obj.id}`;
      displayVal = `<span style="color:#334155;font-size:0.7rem" id="${shortId}-short">${esc(valStr.slice(0, 120))}… <a href="#" style="color:#3b82f6" onclick="toggleLong('${shortId}');return false">show</a></span>
        <span class="field-long" id="${shortId}-long" style="display:none">${esc(valStr)} <a href="#" style="color:#3b82f6" onclick="toggleLong('${shortId}');return false">hide</a></span>`;
    } else {
      displayVal = maybeDNLink(valStr);
    }

    return `<tr>
      <td class="detail-key" style="padding:5px 10px 5px 0;vertical-align:top;white-space:nowrap">${esc(key)}</td>
      <td class="detail-val" style="padding:5px 0">${displayVal}</td>
    </tr>`;
  }

  for (const [groupName, keys] of GROUP_ORDER) {
    const rows = keys.map(k => renderField(k, fields[k])).join('');
    if (!rows) continue;
    html += `<div style="margin-bottom:12px">
      <div style="color:#3b82f6;font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #1e293b">${groupName}</div>
      <table style="width:100%;border-collapse:collapse">${rows}</table>
    </div>`;
  }

  const remaining = Object.entries(fields)
    .filter(([k]) => !seen.has(k))
    .sort(([a], [b]) => a.localeCompare(b));

  if (remaining.length) {
    const rows = remaining.map(([k, v]) => renderField(k, v)).join('');
    if (rows) {
      html += `<div style="margin-bottom:12px">
        <div style="color:#475569;font-size:0.68rem;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #1e293b">Other Attributes</div>
        <table style="width:100%;border-collapse:collapse">${rows}</table>
      </div>`;
    }
  }

  const detailContent = qs('#detail-content');
  detailContent.innerHTML = html || '<div style="color:#475569;padding:20px">No displayable fields.</div>';
  attachDNLinks(detailContent);
}

function toggleLong(id) {
  const short = qs(`#${id}-short`);
  const long  = qs(`#${id}-long`);
  if (!short || !long) return;
  const hidden = long.style.display === 'none';
  short.style.display = hidden ? 'none' : '';
  long.style.display  = hidden ? ''     : 'none';
}
window.toggleLong = toggleLong;

// ─────────────────────────────────────────────────────────────────────────────
// Filters
// ─────────────────────────────────────────────────────────────────────────────

let searchTimer = null;
qs('#search-input').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.search = e.target.value.trim();
    state.page = 1;
    loadObjects();
  }, 350);
});

qs('#admin-only').addEventListener('change', e => {
  state.adminOnly = e.target.checked;
  state.page = 1;
  loadObjects();
});

qs('#per-page-select').addEventListener('change', e => {
  state.perPage = parseInt(e.target.value);
  state.page = 1;
  loadObjects();
});

function setupPresets(containerSel, inputSel, stateKey, presetKey) {
  qsa(`${containerSel} .preset-btn`).forEach(btn => {
    btn.addEventListener('click', () => {
      const days = parseInt(btn.dataset.days);
      const same = state[presetKey] === days;
      state[presetKey] = same ? null : days;
      const iso = same ? '' : daysAgoISO(days);
      state[stateKey] = iso;
      qs(inputSel).value = iso;
      qsa(`${containerSel} .preset-btn`).forEach(b =>
        b.classList.toggle('active', !same && parseInt(b.dataset.days) === days)
      );
      state.page = 1;
      loadObjects();
    });
  });
  qs(inputSel).addEventListener('change', e => {
    state[stateKey] = e.target.value;
    state[presetKey] = null;
    qsa(`${containerSel} .preset-btn`).forEach(b => b.classList.remove('active'));
    state.page = 1;
    loadObjects();
  });
}

setupPresets('#logon-presets',   '#logon-date',   'logonDate',   'logonPreset');
setupPresets('#pwd-presets',     '#pwd-date',     'pwdDate',     'pwdPreset');
setupPresets('#changed-presets', '#changed-date', 'changedDate', 'changedPreset');

qs('#clear-filters-btn').addEventListener('click', () => {
  state.search = '';       qs('#search-input').value = '';
  state.logonDate = '';    qs('#logon-date').value   = '';
  state.pwdDate = '';      qs('#pwd-date').value     = '';
  state.changedDate = '';  qs('#changed-date').value = '';
  state.adminOnly = false; qs('#admin-only').checked = false;
  state.selectedClassFilter = null;
  state.logonPreset = null; state.pwdPreset = null; state.changedPreset = null;
  qsa('.preset-btn').forEach(b => b.classList.remove('active'));
  state.page = 1;
  loadClasses();
  loadObjects();
});

// ─────────────────────────────────────────────────────────────────────────────
// Upload modal
// ─────────────────────────────────────────────────────────────────────────────

let selectedFile = null;

qs('#upload-btn').addEventListener('click', () => {
  selectedFile = null;
  qs('#selected-file-name').textContent = '';
  qs('#do-upload-btn').disabled = true;
  qs('#upload-progress-wrap').style.display = 'none';
  qs('#file-input').value = '';
  qs('#upload-modal').style.display = 'flex';
});

qs('#cancel-upload-btn').addEventListener('click', () => {
  qs('#upload-modal').style.display = 'none';
});

qs('#upload-modal').addEventListener('click', e => {
  if (e.target === qs('#upload-modal')) qs('#upload-modal').style.display = 'none';
});

qs('#browse-link').addEventListener('click', () => qs('#file-input').click());
qs('#drop-zone').addEventListener('click', () => qs('#file-input').click());
qs('#file-input').addEventListener('change', e => {
  if (e.target.files[0]) setFile(e.target.files[0]);
});

const dropZone = qs('#drop-zone');
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
});

function setFile(f) {
  selectedFile = f;
  qs('#selected-file-name').textContent = `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`;
  qs('#do-upload-btn').disabled = false;
}

qs('#do-upload-btn').addEventListener('click', async () => {
  if (!selectedFile) return;
  const fill   = qs('#progress-fill');
  const status = qs('#upload-status');

  qs('#upload-progress-wrap').style.display = '';
  fill.style.width = '5%';
  status.textContent = 'Uploading…';
  qs('#do-upload-btn').disabled = true;

  const fd = new FormData();
  fd.append('file', selectedFile);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');

  xhr.upload.addEventListener('progress', e => {
    if (e.lengthComputable) {
      fill.style.width = Math.round(20 + (e.loaded / e.total) * 40) + '%';
      status.textContent = `Uploading… ${Math.round(e.loaded / 1024 / 1024)} / ${Math.round(e.total / 1024 / 1024)} MB`;
    }
  });

  xhr.addEventListener('load', async () => {
    if (xhr.status === 201) {
      fill.style.width = '100%';
      const data = JSON.parse(xhr.responseText);
      status.textContent = `Done — ${data.object_count} objects imported.`;
      state.selectedUploadId = data.id;
      await loadUploads();
      setTimeout(() => { qs('#upload-modal').style.display = 'none'; }, 1200);
      showToast(`Imported ${data.object_count} objects from ${data.original_name}`);
    } else {
      status.textContent = 'Upload failed: ' + xhr.responseText;
      fill.style.background = '#991b1b';
      qs('#do-upload-btn').disabled = false;
    }
  });

  xhr.addEventListener('error', () => {
    status.textContent = 'Network error';
    qs('#do-upload-btn').disabled = false;
  });

  xhr.send(fd);
});

// ─────────────────────────────────────────────────────────────────────────────
// Init
// ─────────────────────────────────────────────────────────────────────────────

async function refreshAll() {
  await Promise.all([loadStats(), loadClasses(), loadObjects()]);
}

// Wire up sortable column headers
qsa('th[data-sort]').forEach(th => {
  th.addEventListener('click', () => setSortColumn(th.dataset.sort));
});
updateSortHeaders();

loadUploads();
