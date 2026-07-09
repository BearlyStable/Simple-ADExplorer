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

function referenceNow() {
  return state.snapshotTime ? new Date(state.snapshotTime) : new Date();
}

function timeAgo(iso) {
  if (!iso) return '—';
  const sec = (referenceNow() - new Date(iso)) / 1000;
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

// datetime-local inputs in this app always hold a wall-clock UTC value (no
// timezone conversion — same convention as the existing date filter inputs).
function isoToDatetimeLocal(iso) {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 19);
}

function daysAgoISO(days) {
  const d = referenceNow();
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
  snapshotTime: null,
  selectedClassFilter: null,
  logonDate: '',
  pwdDate: '',
  createdDate: '',
  changedDate: '',
  search: '',
  adminOnly: false,
  favoritesOnly: false,
  page: 1,
  perPage: 50,
  total: 0,
  selectedObjectId: null,
  logonPreset: null,
  pwdPreset: null,
  createdPreset: null,
  changedPreset: null,
  sortBy: '',
  sortDir: 'desc',
};

// ─────────────────────────────────────────────────────────────────────────────
// API
// ─────────────────────────────────────────────────────────────────────────────

async function api(url, opts = {}) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Uploads
// ─────────────────────────────────────────────────────────────────────────────

function syncSnapshotTime() {
  const upload = state.uploads.find(u => u.id === state.selectedUploadId);
  state.snapshotTime = upload?.snapshot_time || null;
  const btn = qs('#snapshot-time-btn');
  if (state.snapshotTime) {
    qs('#snapshot-time-label').textContent = fmtDate(state.snapshotTime) + ' UTC';
    btn.style.display = '';
  } else {
    btn.style.display = 'none';
  }
}

async function loadUploads() {
  const data = await api('/api/uploads');
  state.uploads = data;
  const sel = qs('#upload-select');
  sel.innerHTML = '<option value="">— no dataset loaded —</option>' +
    data.map(u => {
      const fname = u.original_name.replace(/.*[\\/]/, '');
      return `<option value="${u.id}">${esc(fname)} (${u.object_count} objects, ${u.uploaded_at.slice(0, 16)})</option>`;
    }).join('');
  if (data.length > 0 && !state.selectedUploadId) {
    state.selectedUploadId = data[0].id;
    sel.value = data[0].id;
  } else if (state.selectedUploadId) {
    sel.value = state.selectedUploadId;
  }
  qs('#delete-upload-btn').style.display = data.length ? '' : 'none';
  syncSnapshotTime();
  await refreshAll();
}

qs('#upload-select').addEventListener('change', async e => {
  state.selectedUploadId = e.target.value ? parseInt(e.target.value) : null;
  state.page = 1;
  state.selectedClassFilter = null;
  qs('#delete-upload-btn').style.display = state.selectedUploadId ? '' : 'none';
  syncSnapshotTime();
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
  function fmtStat(count, missing) {
    if (!missing) return String(count);
    return `${count} <span style="color:#f87171;font-size:0.85em">+${missing}</span>`;
  }
  qs('#stat-total').innerHTML     = fmtStat(s.total,     s.total_missing);
  qs('#stat-users').innerHTML     = fmtStat(s.users,     s.users_missing);
  qs('#stat-computers').innerHTML = fmtStat(s.computers, s.computers_missing);
  qs('#stat-groups').innerHTML    = fmtStat(s.groups,    s.groups_missing);
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
  if (state.createdDate)         p.set('created_after',    state.createdDate + 'T00:00:00+00:00');
  if (state.changedDate)         p.set('changed_after',    state.changedDate + 'T00:00:00+00:00');
  if (state.adminOnly)           p.set('admin_only',       '1');
  if (state.favoritesOnly)       p.set('favorites_only',   '1');
  if (state.sortBy) {
    p.set('sort_by',  state.sortBy);
    p.set('sort_dir', state.sortDir);
  }
  p.set('page',     state.page);
  p.set('per_page', state.perPage);
  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// Favourites

async function toggleFavorite(id) {
  const result = await api(`/api/objects/${id}/favorite`, { method: 'PATCH' });
  // Update every star in the table that belongs to this object
  qsa(`.star-btn[data-id="${id}"]`).forEach(btn => {
    btn.textContent = result.is_favorite ? '★' : '☆';
    btn.classList.toggle('active', result.is_favorite);
  });
  // Update the detail-panel star if it's showing the same object
  const detailStar = qs('#detail-fav-btn');
  if (detailStar && String(state.selectedObjectId) === String(id)) {
    detailStar.textContent = result.is_favorite ? '★' : '☆';
    detailStar.classList.toggle('active', result.is_favorite);
  }
  if (state.favoritesOnly) loadObjects();
  return result.is_favorite;
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
    const dateCols = new Set(['last_logon', 'pwd_last_set', 'when_created']);
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
  tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:#475569">Loading…</td></tr>`;

  const data = await api('/api/objects?' + buildQueryParams());
  state.total = data.total;
  renderObjects(data.objects);
  renderPagination(data.total, data.page, data.per_page);

  qs('#filter-info').textContent = data.total > 0
    ? `Showing ${(data.page - 1) * data.per_page + 1}–${Math.min(data.page * data.per_page, data.total)} of ${data.total}`
    : 'No results';
}

function noteCellHtml(note) {
  return note
    ? `<span title="${esc(note)}" style="color:#94a3b8">${esc(note.length > 60 ? note.slice(0, 58) + '…' : note)}</span>`
    : `<span style="color:#334155">—</span>`;
}

function renderObjects(objects) {
  const tbody = qs('#objects-tbody');
  if (!objects.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:#475569">No objects match the current filters.</td></tr>`;
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

    const logonCell   = bestLogon      ? `<span title="${fmtDate(bestLogon)}">${timeAgo(bestLogon)}</span>`          : `<span style="color:#334155">Never</span>`;
    const pwdCell     = o.pwd_last_set  ? `<span title="${fmtDate(o.pwd_last_set)}">${timeAgo(o.pwd_last_set)}</span>` : `<span style="color:#334155">—</span>`;
    const createdCell = o.when_created  ? `<span title="${fmtDate(o.when_created)}">${timeAgo(o.when_created)}</span>` : '—';

    const desc = o.description || '';
    const descCell = desc
      ? `<span title="${esc(desc)}" style="color:#94a3b8">${esc(desc.length > 60 ? desc.slice(0, 58) + '…' : desc)}</span>`
      : `<span style="color:#334155">—</span>`;

    const noteCell = noteCellHtml(o.comment || '');

    const isFav = !!o.is_favorite;
    const tags = Array.isArray(o.tags) ? o.tags : [];
    const diffClass = tags.includes('missing') ? ' row-missing' : tags.includes('new') ? ' row-new' : '';
    return `<tr class="row-hover${diffClass}" data-id="${o.id}" style="border-bottom:1px solid #1e293b;${bg}">
      <td style="padding:4px 6px;width:28px;text-align:center">
        <button class="star-btn${isFav ? ' active' : ''}" data-id="${o.id}" title="Toggle favourite">${isFav ? '★' : '☆'}</button>
      </td>
      <td style="padding:7px 10px">${nameCell}</td>
      <td style="padding:7px 10px">${classBadge(o.primary_class)}</td>
      <td style="padding:7px 10px">${statusBadge(o.user_account_control, o.admin_count)}</td>
      <td style="padding:7px 10px">${descCell}</td>
      <td style="padding:7px 10px;color:#94a3b8">${logonCell}</td>
      <td style="padding:7px 10px;color:#94a3b8">${pwdCell}</td>
      <td style="padding:7px 10px;color:#94a3b8">${createdCell}</td>
      <td style="padding:7px 10px">${noteCell}</td>
    </tr>`;
  }).join('');

  qsa('tr[data-id]', tbody).forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('.star-btn')) return;
      showDetail(parseInt(row.dataset.id));
    });
  });

  qsa('.star-btn', tbody).forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleFavorite(parseInt(btn.dataset.id));
    });
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
// Security descriptor (nTSecurityDescriptor) — binary parsing & rendering
//
// nTSecurityDescriptor arrives as a base64-encoded, self-relative SECURITY_DESCRIPTOR
// (MS-DTYP 2.4.6): a fixed 20-byte header followed by an owner SID, a group SID,
// a SACL and a DACL, each a list of ACEs (MS-DTYP 2.4.4/2.4.5).
// ─────────────────────────────────────────────────────────────────────────────

// Universal / BUILTIN principals — not real AD objects, so never linkable.
const WELL_KNOWN_SIDS = {
  'S-1-0-0': 'Nobody', 'S-1-1-0': 'Everyone',
  'S-1-3-0': 'Creator Owner', 'S-1-3-1': 'Creator Group',
  'S-1-5-1': 'Dialup', 'S-1-5-2': 'Network', 'S-1-5-3': 'Batch', 'S-1-5-4': 'Interactive',
  'S-1-5-6': 'Service', 'S-1-5-7': 'Anonymous Logon',
  'S-1-5-9': 'Enterprise Domain Controllers', 'S-1-5-10': 'Principal Self',
  'S-1-5-11': 'Authenticated Users', 'S-1-5-18': 'Local System',
  'S-1-5-19': 'Local Service', 'S-1-5-20': 'Network Service',
  'S-1-5-32-544': 'BUILTIN\\Administrators', 'S-1-5-32-545': 'BUILTIN\\Users',
  'S-1-5-32-546': 'BUILTIN\\Guests', 'S-1-5-32-548': 'BUILTIN\\Account Operators',
  'S-1-5-32-549': 'BUILTIN\\Server Operators', 'S-1-5-32-550': 'BUILTIN\\Print Operators',
  'S-1-5-32-551': 'BUILTIN\\Backup Operators', 'S-1-5-32-554': 'BUILTIN\\Pre-Windows 2000 Compatible Access',
  'S-1-5-32-555': 'BUILTIN\\Remote Desktop Users',
};

// Domain-relative well-known RIDs (S-1-5-21-<domain>-<RID>) — these DO correspond
// to a real group/user object in the domain, so they're resolved as links.
const DOMAIN_RID_NAMES = {
  500: 'Administrator', 501: 'Guest', 502: 'krbtgt',
  512: 'Domain Admins', 513: 'Domain Users', 514: 'Domain Guests',
  515: 'Domain Computers', 516: 'Domain Controllers', 517: 'Cert Publishers',
  518: 'Schema Admins', 519: 'Enterprise Admins', 520: 'Group Policy Creator Owners',
  526: 'Key Admins', 527: 'Enterprise Key Admins', 553: 'RAS and IAS Servers',
};

// Verified against Microsoft's AD schema "Extended Rights" reference — GUIDs used
// with the DS_CONTROL_ACCESS bit to name the specific extended/validated-write right.
const RIGHTS_GUIDS = {
  '00299570-246d-11d0-a768-00aa006e0529': 'User-Force-Change-Password',
  'ab721a53-1e2f-11d0-9819-00aa0040529b': 'User-Change-Password',
  '1131f6aa-9c07-11d1-f79f-00c04fc2dcd2': 'DS-Replication-Get-Changes',
  '1131f6ad-9c07-11d1-f79f-00c04fc2dcd2': 'DS-Replication-Get-Changes-All',
  '89e95b76-444d-4c62-991a-0facbeda640c': 'DS-Replication-Get-Changes-In-Filtered-Set',
  '1131f6ab-9c07-11d1-f79f-00c04fc2dcd2': 'DS-Replication-Synchronize',
  'bf9679c0-0de6-11d0-a285-00aa003049e2': 'Self-Membership (Add/Remove self as member)',
};

const ACE_TYPE_NAMES = {
  0x00: 'Allow', 0x01: 'Deny', 0x02: 'Audit', 0x03: 'Alarm',
  0x04: 'Allow (Compound)', 0x05: 'Allow (Object)', 0x06: 'Deny (Object)',
  0x07: 'Audit (Object)', 0x08: 'Alarm (Object)', 0x09: 'Allow (Callback)',
  0x0A: 'Deny (Callback)', 0x0B: 'Allow (Callback Object)', 0x0C: 'Deny (Callback Object)',
  0x0D: 'Audit (Callback)', 0x0E: 'Audit (Callback Object)', 0x11: 'Mandatory Label',
};
const OBJECT_ACE_TYPES = new Set([0x05, 0x06, 0x07, 0x08, 0x0B, 0x0C, 0x0E]);
const DENY_ACE_TYPES  = new Set([0x01, 0x06, 0x0A, 0x0C]);
const AUDIT_ACE_TYPES = new Set([0x02, 0x07, 0x08, 0x0D, 0x0E]);

const GENERIC_RIGHTS = [
  [0x80000000, 'GenericRead'], [0x40000000, 'GenericWrite'], [0x20000000, 'GenericExecute'],
];
const STANDARD_RIGHTS = [
  [0x00010000, 'Delete'], [0x00020000, 'ReadControl'], [0x00040000, 'WriteDacl'], [0x00080000, 'WriteOwner'],
];
const DS_RIGHTS = [
  [0x00000100, 'ControlAccess (Extended Right)'], [0x00000080, 'ListObject'],
  [0x00000040, 'DeleteTree'], [0x00000020, 'WriteProperty'], [0x00000010, 'ReadProperty'],
  [0x00000008, 'Self (Validated Write)'], [0x00000004, 'ListChildren'],
  [0x00000002, 'DeleteChild'], [0x00000001, 'CreateChild'],
];

function decodeAccessMask(mask) {
  if (mask & 0x10000000) return ['GenericAll'];
  const rights = [];
  for (const [bit, name] of GENERIC_RIGHTS) if (mask & bit) rights.push(name);
  for (const [bit, name] of STANDARD_RIGHTS) if (mask & bit) rights.push(name);
  for (const [bit, name] of DS_RIGHTS) if (mask & bit) rights.push(name);
  return rights.length ? rights : [`0x${(mask >>> 0).toString(16)}`];
}

function base64ToBytes(b64) {
  try {
    const bin = atob(b64.replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function hex(n, width) {
  return n.toString(16).padStart(width, '0');
}

function guidToString(bytes, offset) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset + offset, 16);
  const d1 = hex(dv.getUint32(0, true), 8);
  const d2 = hex(dv.getUint16(4, true), 4);
  const d3 = hex(dv.getUint16(6, true), 4);
  let d4 = '';
  for (let i = 8; i < 16; i++) d4 += hex(bytes[offset + i], 2);
  return `${d1}-${d2}-${d3}-${d4.slice(0, 4)}-${d4.slice(4)}`;
}

function sidToString(bytes, offset) {
  const revision = bytes[offset];
  const subCount  = bytes[offset + 1];
  let authority = 0;
  for (let i = 0; i < 6; i++) authority = authority * 256 + bytes[offset + 2 + i];
  const dv = new DataView(bytes.buffer, bytes.byteOffset + offset + 8, subCount * 4);
  let sid = `S-${revision}-${authority}`;
  for (let i = 0; i < subCount; i++) sid += '-' + dv.getUint32(i * 4, true);
  return { sid, length: 8 + subCount * 4 };
}

function parseAce(bytes, offset) {
  const header = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
  const type  = bytes[offset];
  const flags = bytes[offset + 1];
  const size  = header.getUint16(2, true);
  let p = offset + 4;

  const maskDv = new DataView(bytes.buffer, bytes.byteOffset + p, 4);
  const mask = maskDv.getUint32(0, true);
  p += 4;

  let objectType = null, inheritedObjectType = null;
  if (OBJECT_ACE_TYPES.has(type)) {
    const objFlags = new DataView(bytes.buffer, bytes.byteOffset + p, 4).getUint32(0, true);
    p += 4;
    if (objFlags & 0x1) { objectType = guidToString(bytes, p); p += 16; }
    if (objFlags & 0x2) { inheritedObjectType = guidToString(bytes, p); p += 16; }
  }

  const { sid: trusteeSid } = sidToString(bytes, p);

  return {
    typeName: ACE_TYPE_NAMES[type] || `Unknown (0x${hex(type, 2)})`,
    isDeny: DENY_ACE_TYPES.has(type),
    isAudit: AUDIT_ACE_TYPES.has(type),
    inherited: !!(flags & 0x10),
    rights: decodeAccessMask(mask),
    objectType,
    objectTypeName: objectType ? RIGHTS_GUIDS[objectType.toLowerCase()] || null : null,
    inheritedObjectType,
    trusteeSid,
    size,
  };
}

function parseAcl(bytes, offset) {
  const aceCount = new DataView(bytes.buffer, bytes.byteOffset + offset, 8).getUint16(4, true);
  const aces = [];
  let p = offset + 8;
  for (let i = 0; i < aceCount && p < bytes.length; i++) {
    const ace = parseAce(bytes, p);
    aces.push(ace);
    p += ace.size;
  }
  return aces;
}

function parseSecurityDescriptor(b64) {
  const bytes = base64ToBytes(b64);
  if (!bytes || bytes.length < 20) return null;
  try {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, 20);
    const control  = dv.getUint16(2, true);
    const offOwner = dv.getUint32(4, true);
    const offGroup = dv.getUint32(8, true);
    const offSacl  = dv.getUint32(12, true);
    const offDacl  = dv.getUint32(16, true);

    return {
      owner: offOwner ? sidToString(bytes, offOwner).sid : null,
      group: offGroup ? sidToString(bytes, offGroup).sid : null,
      dacl: (control & 0x0004) && offDacl ? parseAcl(bytes, offDacl) : null,
      sacl: (control & 0x0010) && offSacl ? parseAcl(bytes, offSacl) : null,
      daclProtected: !!(control & 0x1000),
      saclProtected: !!(control & 0x2000),
    };
  } catch {
    return null;
  }
}

let _sidRegistry = [];

function wellKnownSidInfo(sid) {
  if (WELL_KNOWN_SIDS[sid]) return { name: WELL_KNOWN_SIDS[sid], linkable: false };
  const m = /^S-1-5-21-\d+-\d+-\d+-(\d+)$/.exec(sid);
  if (m && DOMAIN_RID_NAMES[m[1]]) return { name: DOMAIN_RID_NAMES[m[1]], linkable: true };
  return null;
}

function renderSidCell(sid) {
  const known = wellKnownSidInfo(sid);
  if (known && !known.linkable) {
    return `<span style="color:#94a3b8" title="${esc(sid)}">${esc(known.name)}</span>`;
  }
  const idx = _sidRegistry.length;
  _sidRegistry.push(sid);
  const label = known ? known.name : sid;
  return `<a class="dn-link sid-link" href="#" data-sid-idx="${idx}" title="${esc(sid)}">${esc(label)}</a>`;
}

function attachSidLinks(container) {
  qsa('.sid-link', container).forEach(a => {
    a.addEventListener('click', e => {
      e.preventDefault();
      navigateToSid(_sidRegistry[parseInt(a.dataset.sidIdx)]);
    });
  });
}

async function navigateToSid(sid) {
  const uid = state.selectedUploadId;
  const url = '/api/objects/by-sid?sid=' + encodeURIComponent(sid) +
              (uid ? '&upload_id=' + uid : '');
  try {
    const result = await api(url);
    await showDetail(result.id, true);
  } catch {
    showToast('Trustee not found in this upload', 'err');
  }
}

function toggleRawSD(id) {
  const el = qs(`#${id}-long`);
  if (!el) return;
  el.style.display = el.style.display === 'none' ? '' : 'none';
}
window.toggleRawSD = toggleRawSD;

// Principals for which broad control is expected/by-design, so flagging them
// as "risky" would just be noise — these are excluded from the risk heuristic.
const SAFE_PRINCIPAL_NAMES = new Set([
  'Domain Admins', 'Enterprise Admins', 'Administrator', 'Schema Admins',
  'BUILTIN\\Administrators', 'Local System', 'Enterprise Domain Controllers',
  'Principal Self',
]);

// Best-effort heuristic for "commonly abused for AD privilege escalation /
// lateral movement" — the same class of rights BloodHound-style tooling flags
// as high-value edges. This is NOT a definitive vulnerability finding: an
// Allow ACE granting one of these to a principal that legitimately needs it
// is normal. Always verify the grantee is expected to hold this access.
function assessAceRisk(ace) {
  if (ace.isDeny || ace.isAudit) return null;
  const known = wellKnownSidInfo(ace.trusteeSid);
  if (known && SAFE_PRINCIPAL_NAMES.has(known.name)) return null;

  const reasons = [];
  if (ace.rights.includes('GenericAll')) reasons.push('Full control of the object');
  if (ace.rights.includes('GenericWrite')) reasons.push('Can modify most attributes');
  if (ace.rights.includes('WriteDacl')) reasons.push('Can grant itself (or anyone) any other permission');
  if (ace.rights.includes('WriteOwner')) reasons.push('Can take ownership of the object');
  if (ace.rights.includes('WriteProperty') && !ace.objectType) reasons.push('Can write any attribute');
  if (ace.rights.includes('Self (Validated Write)') && !ace.objectType) reasons.push('Can perform any validated write');
  if (ace.rights.includes('ControlAccess (Extended Right)')) {
    if (!ace.objectType) {
      reasons.push('Holds every extended right (password reset, replication, …)');
    } else if (ace.objectTypeName === 'User-Force-Change-Password') {
      reasons.push("Can reset this account's password without knowing it");
    } else if (ace.objectTypeName === 'DS-Replication-Get-Changes' || ace.objectTypeName === 'DS-Replication-Get-Changes-All') {
      reasons.push('Part of the rights needed for a DCSync attack');
    } else if (ace.objectTypeName === 'Self-Membership (Add/Remove self as member)') {
      reasons.push('Can add itself to this group');
    }
  }
  return reasons.length ? reasons : null;
}

function renderAceRow(ace) {
  const rightsHtml = ace.rights.map(r => `<span class="ace-right" style="display:inline-block;background:#1e293b;border:1px solid #334155;border-radius:4px;padding:1px 6px;margin:1px;font-size:0.7rem;color:#e2e8f0">${esc(r)}</span>`).join('');
  const objectTypeHtml = ace.objectType
    ? `<span title="${esc(ace.objectType)}">${esc(ace.objectTypeName || ace.objectType)}</span>`
    : '<span style="color:#334155">—</span>';
  const kindColor = ace.isDeny ? '#f87171' : ace.isAudit ? '#fbbf24' : '#6ee7b7';

  const risk = assessAceRisk(ace);
  const rowStyle = risk
    ? 'border-bottom:1px solid #1e293b;background:rgba(248,113,113,0.08)'
    : 'border-bottom:1px solid #1e293b';
  const riskHtml = risk
    ? `<span title="${esc(risk.join('; '))}" style="display:inline-flex;align-items:center;gap:3px;color:#f87171;font-weight:600;font-size:0.7rem;white-space:nowrap">⚠ Risky</span>`
    : '<span style="color:#334155">—</span>';

  return `<tr style="${rowStyle}">
    <td style="padding:4px 8px;color:${kindColor};font-weight:600;white-space:nowrap;vertical-align:top">${ace.isDeny ? 'Deny' : ace.isAudit ? 'Audit' : 'Allow'}</td>
    <td style="padding:4px 8px;vertical-align:top;white-space:nowrap">${renderSidCell(ace.trusteeSid)}</td>
    <td style="padding:4px 8px;vertical-align:top">${rightsHtml}</td>
    <td style="padding:4px 8px;vertical-align:top;font-size:0.75rem;color:#94a3b8">${objectTypeHtml}</td>
    <td style="padding:4px 8px;vertical-align:top;font-size:0.72rem;color:#475569;white-space:nowrap">${ace.inherited ? 'Inherited' : 'Explicit'}</td>
    <td style="padding:4px 8px;vertical-align:top">${riskHtml}</td>
  </tr>`;
}

let _sdCache = {};

function renderSecurityDescriptorField(b64, shortId, objName) {
  const sd = parseSecurityDescriptor(b64);
  _sdCache[shortId] = { sd, b64, objName };

  if (!sd) {
    return `<span style="color:#334155;font-size:0.7rem">Could not parse security descriptor. ${esc(b64.slice(0, 80))}…</span>`;
  }

  const daclCount = sd.dacl ? sd.dacl.length : 0;
  const saclCount = sd.sacl ? sd.sacl.length : 0;
  const denyCount = sd.dacl ? sd.dacl.filter(a => a.isDeny).length : 0;
  const riskyCount = sd.dacl ? sd.dacl.filter(a => assessAceRisk(a)).length : 0;

  const summary = daclCount
    ? `${daclCount} DACL entr${daclCount === 1 ? 'y' : 'ies'}${denyCount ? ` (${denyCount} deny)` : ''}${saclCount ? ` · ${saclCount} audit` : ''}`
    : 'No DACL — full access to everyone';
  const riskyBadge = riskyCount
    ? `<span style="color:#f87171;font-size:0.72rem;font-weight:600">⚠ ${riskyCount} risky</span>`
    : '';

  return `<div style="display:flex;align-items:center;gap:10px">
    <span style="color:#94a3b8;font-size:0.78rem">${esc(summary)}</span>
    ${riskyBadge}
    <button class="btn btn-ghost" style="padding:2px 10px;font-size:0.72rem" onclick="openAclModal('${shortId}');return false">View permissions table</button>
  </div>`;
}

function renderAclModalHtml(shortId) {
  const entry = _sdCache[shortId];
  if (!entry || !entry.sd) return '<div style="color:#475569">Could not parse security descriptor.</div>';
  const { sd, b64 } = entry;

  const header = `<tr style="text-align:left;color:#64748b;font-size:0.68rem;text-transform:uppercase">
      <th style="padding:4px 8px">Type</th><th style="padding:4px 8px">Trustee</th>
      <th style="padding:4px 8px">Rights</th><th style="padding:4px 8px">Applies To</th><th style="padding:4px 8px">Inheritance</th>
      <th style="padding:4px 8px">Risk</th>
    </tr>`;

  let html = `<div style="font-size:0.78rem;margin-bottom:8px;color:#94a3b8">
      Owner: ${sd.owner ? renderSidCell(sd.owner) : '<span style="color:#334155">—</span>'}
      &nbsp;·&nbsp; Group: ${sd.group ? renderSidCell(sd.group) : '<span style="color:#334155">—</span>'}
    </div>`;

  html += `<div style="font-size:0.7rem;color:#475569;margin-bottom:10px">
      <span style="color:#f87171">⚠ Risky</span> flags rights commonly abused for AD privilege escalation (full control, WriteDacl/Owner, password reset, DCSync, …) granted to a principal other than the usual admin groups. This is a heuristic, not a confirmed vulnerability — always check whether the grantee is actually expected to have this access.
    </div>`;

  html += `<div style="color:#3b82f6;font-size:0.7rem;font-weight:700;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em">
      Discretionary ACL${sd.daclProtected ? ' <span style="color:#f87171;font-weight:400;text-transform:none;letter-spacing:normal">· protected from inheritance</span>' : ''}
    </div>`;
  html += sd.dacl && sd.dacl.length
    ? `<table style="width:100%;border-collapse:collapse;margin-bottom:12px">${header}${sd.dacl.map(renderAceRow).join('')}</table>`
    : `<div style="color:#475569;font-size:0.75rem;margin-bottom:12px">No DACL present — this grants full access to everyone.</div>`;

  if (sd.sacl && sd.sacl.length) {
    html += `<div style="color:#3b82f6;font-size:0.7rem;font-weight:700;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.06em">
        System ACL (audit)${sd.saclProtected ? ' <span style="color:#f87171;font-weight:400;text-transform:none;letter-spacing:normal">· protected</span>' : ''}
      </div>`;
    html += `<table style="width:100%;border-collapse:collapse;margin-bottom:12px">${header}${sd.sacl.map(renderAceRow).join('')}</table>`;
  }

  html += `<div><a href="#" style="color:#334155;font-size:0.68rem" onclick="toggleRawSD('${shortId}');return false">show raw base64</a>
    <span class="field-long" id="${shortId}-long" style="display:none;font-size:0.68rem;color:#334155;word-break:break-all"><br>${esc(b64)}</span></div>`;

  return html;
}

function openAclModal(shortId) {
  const entry = _sdCache[shortId];
  const content = qs('#acl-modal-content');
  content.innerHTML = renderAclModalHtml(shortId);
  qs('#acl-modal-title').textContent = entry && entry.objName
    ? `Security Descriptor — ${entry.objName}`
    : 'Security Descriptor';
  qs('#acl-modal').style.display = 'flex';
  attachSidLinks(content);
  qsa('.sid-link', content).forEach(a => {
    a.addEventListener('click', () => { qs('#acl-modal').style.display = 'none'; });
  });
}
window.openAclModal = openAclModal;

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
  _sidRegistry = [];
  _sdCache = {};
  const fields = obj.fields || {};
  const title  = fields.cn || fields.name || obj.cn || 'Object';
  qs('#detail-title').textContent = title;

  const detailStar = qs('#detail-fav-btn');
  detailStar.textContent = obj.is_favorite ? '★' : '☆';
  detailStar.classList.toggle('active', !!obj.is_favorite);
  detailStar.onclick = () => toggleFavorite(obj.id);

  const seen = new Set();
  let html = '';

  if (fields.userAccountControl !== undefined) {
    const uac = parseInt(fields.userAccountControl) || 0;
    html += `<div id="detail-uac-block" style="background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px 14px;margin-bottom:14px">
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
    } else if (key === 'nTSecurityDescriptor') {
      displayVal = renderSecurityDescriptorField(valStr, `field-${key}-${obj.id}`, title);
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
  attachSidLinks(detailContent);

  // ── Notes / comment box ───────────────────────────────────────────────────
  const notesWrap = document.createElement('div');
  notesWrap.className = 'comment-box';
  notesWrap.innerHTML = `
    <div class="comment-label">Notes</div>
    <textarea id="comment-textarea" rows="4" placeholder="Add notes about this object…">${esc(obj.comment || '')}</textarea>
    <div style="display:flex;align-items:center;gap:8px;margin-top:8px">
      <button class="btn btn-ghost" id="comment-save-btn" style="padding:3px 12px">Save</button>
      <span id="comment-status" class="comment-status"></span>
    </div>`;
  detailContent.appendChild(notesWrap);

  const textarea = qs('#comment-textarea');
  const saveBtn  = qs('#comment-save-btn');
  const status   = qs('#comment-status');

  async function saveComment() {
    saveBtn.disabled = true;
    status.textContent = 'Saving…';
    try {
      const result = await api(`/api/objects/${obj.id}/comment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: textarea.value }),
      });
      obj.comment = result.comment;
      const row = qs(`tr[data-id="${obj.id}"]`);
      if (row) row.querySelector('td:last-child').innerHTML = noteCellHtml(result.comment || '');
      status.textContent = 'Saved';
      setTimeout(() => { status.textContent = ''; }, 2000);
    } catch {
      status.style.color = '#f87171';
      status.textContent = 'Save failed';
      setTimeout(() => { status.textContent = ''; status.style.color = ''; }, 3000);
    } finally {
      saveBtn.disabled = false;
    }
  }

  saveBtn.addEventListener('click', saveComment);
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveComment();
  });

  // ── Tags ──────────────────────────────────────────────────────────────────
  const tagsWrap = document.createElement('div');
  tagsWrap.className = 'tag-box';
  tagsWrap.innerHTML = `
    <div class="tag-label">Tags</div>
    <div class="tag-chips" id="detail-tag-chips"></div>
    <div class="tag-input-row">
      <span class="tag-hash">#</span>
      <input type="text" id="detail-tag-input" placeholder="add tag, press Enter">
    </div>`;
  const uacBlock = qs('#detail-uac-block');
  if (uacBlock) {
    uacBlock.insertAdjacentElement('afterend', tagsWrap);
  } else {
    detailContent.insertBefore(tagsWrap, detailContent.firstChild);
  }

  let objTags = Array.isArray(obj.tags) ? [...obj.tags] : [];

  function renderTagChips() {
    const chips = qs('#detail-tag-chips');
    chips.innerHTML = objTags.map(t =>
      `<span class="tag-chip" data-tag="${esc(t)}">` +
      `<span class="tag-chip-text">#${esc(t)}</span>` +
      `<button class="tag-remove-btn" title="Remove">×</button></span>`
    ).join('');
    chips.querySelectorAll('.tag-remove-btn').forEach(btn => {
      btn.onclick = async () => {
        const tag = btn.closest('.tag-chip').dataset.tag;
        objTags = objTags.filter(t => t !== tag);
        await persistTags();
        renderTagChips();
      };
    });
  }

  async function persistTags() {
    const result = await api(`/api/objects/${obj.id}/tags`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: objTags }),
    });
    obj.tags = result.tags;
  }

  const tagInput = qs('#detail-tag-input');
  tagInput.addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const raw = tagInput.value.trim().replace(/^#+/, '');
    if (!raw || objTags.includes(raw)) { tagInput.value = ''; return; }
    objTags.push(raw);
    tagInput.value = '';
    await persistTags();
    renderTagChips();
  });

  renderTagChips();
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

qs('#favorites-only').addEventListener('change', e => {
  state.favoritesOnly = e.target.checked;
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
setupPresets('#created-presets', '#created-date', 'createdDate', 'createdPreset');
setupPresets('#changed-presets', '#changed-date', 'changedDate', 'changedPreset');

qs('#clear-filters-btn').addEventListener('click', () => {
  state.search = '';       qs('#search-input').value = '';
  state.logonDate = '';    qs('#logon-date').value   = '';
  state.pwdDate = '';      qs('#pwd-date').value     = '';
  state.createdDate = '';  qs('#created-date').value = '';
  state.changedDate = '';  qs('#changed-date').value = '';
  state.adminOnly = false;    qs('#admin-only').checked    = false;
  state.favoritesOnly = false; qs('#favorites-only').checked = false;
  state.selectedClassFilter = null;
  state.logonPreset = null; state.pwdPreset = null; state.createdPreset = null; state.changedPreset = null;
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
  qs('#upload-snapshot-time').value = '';

  // Populate "Compare against" dropdown with current uploads
  const basedOnSel = qs('#upload-based-on');
  basedOnSel.innerHTML = '<option value="">— new upload, no comparison —</option>';
  state.uploads.forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = u.original_name + (u.snapshot_time ? `  (${fmtDate(u.snapshot_time)} UTC)` : '');
    basedOnSel.appendChild(opt);
  });

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
  const snapshotTimeInput = qs('#upload-snapshot-time').value;
  if (snapshotTimeInput) fd.append('snapshot_time', snapshotTimeInput + 'Z');
  const basedOnVal = qs('#upload-based-on').value;
  if (basedOnVal) fd.append('based_on_upload_id', basedOnVal);

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
      const snapLabel = data.snapshot_time ? `${fmtDate(data.snapshot_time)} UTC` : 'unknown';
      status.textContent = `Done — ${data.object_count} objects imported. Snapshot time: ${snapLabel}.`;
      state.selectedUploadId = data.id;
      await loadUploads();
      setTimeout(() => { qs('#upload-modal').style.display = 'none'; }, 1600);
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
// Snapshot time modal
// ─────────────────────────────────────────────────────────────────────────────

qs('#snapshot-time-btn').addEventListener('click', () => {
  if (!state.selectedUploadId) return;
  qs('#snapshot-time-input').value = isoToDatetimeLocal(state.snapshotTime);
  qs('#snapshot-modal').style.display = 'flex';
});

qs('#cancel-snapshot-btn').addEventListener('click', () => {
  qs('#snapshot-modal').style.display = 'none';
});

qs('#snapshot-modal').addEventListener('click', e => {
  if (e.target === qs('#snapshot-modal')) qs('#snapshot-modal').style.display = 'none';
});

qs('#save-snapshot-btn').addEventListener('click', async () => {
  const val = qs('#snapshot-time-input').value;
  if (!val) { showToast('Enter a snapshot time', 'err'); return; }
  try {
    const result = await api(`/api/uploads/${state.selectedUploadId}/snapshot_time`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ snapshot_time: val + 'Z' }),
    });
    const upload = state.uploads.find(u => u.id === state.selectedUploadId);
    if (upload) upload.snapshot_time = result.snapshot_time;
    syncSnapshotTime();
    qs('#snapshot-modal').style.display = 'none';
    showToast('Snapshot time updated');
    await loadObjects();
    if (state.selectedObjectId) await showDetail(state.selectedObjectId, false);
  } catch {
    showToast('Failed to update snapshot time', 'err');
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Export modal
// ─────────────────────────────────────────────────────────────────────────────

const EXPORT_FIELDS = [
  ['cn',                  'Name',                true],
  ['sam_account_name',    'SAM Account Name',    true],
  ['primary_class',       'Type',                true],
  ['distinguished_name',  'Distinguished Name',  false],
  ['user_principal_name', 'UPN',                 false],
  ['description',         'Description',         false],
  ['status',              'Status',              false],
  ['last_logon',          'Last Logon',          false],
  ['pwd_last_set',        'Pwd Changed',         false],
  ['when_changed',        'Changed',             false],
  ['when_created',        'Created',             false],
  ['comment',             'Notes',               false],
];

qs('#export-btn').addEventListener('click', () => {
  qs('#export-fields').innerHTML = EXPORT_FIELDS.map(([key, label, def]) => `
    <label style="display:flex;align-items:center;gap:7px;cursor:pointer;font-size:0.82rem;color:#94a3b8">
      <input type="checkbox" class="export-field-cb" value="${key}" ${def ? 'checked' : ''} style="width:auto;accent-color:#3b82f6"> ${esc(label)}
    </label>`).join('');
  qs('#export-modal').style.display = 'flex';
});

qs('#cancel-export-btn').addEventListener('click', () => {
  qs('#export-modal').style.display = 'none';
});

qs('#export-modal').addEventListener('click', e => {
  if (e.target === qs('#export-modal')) qs('#export-modal').style.display = 'none';
});

qs('#do-backup-btn').addEventListener('click', () => {
  window.location.href = '/api/backup';
});

qs('#do-export-btn').addEventListener('click', () => {
  const fields = Array.from(qsa('.export-field-cb:checked', qs('#export-fields'))).map(cb => cb.value);
  if (!fields.length) {
    showToast('Select at least one field', 'err');
    return;
  }
  const params = buildQueryParams();
  params.delete('page');
  params.delete('per_page');
  params.set('fields', fields.join(','));
  window.location.href = '/api/objects/export?' + params.toString();
  qs('#export-modal').style.display = 'none';
});

qs('#close-acl-btn').addEventListener('click', () => {
  qs('#acl-modal').style.display = 'none';
});

qs('#acl-modal').addEventListener('click', e => {
  if (e.target === qs('#acl-modal')) qs('#acl-modal').style.display = 'none';
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
