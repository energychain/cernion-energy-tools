let TASKS = [];
const bootstrapUrl = new URL(location.href);
if (bootstrapUrl.searchParams.has('token')) {
  bootstrapUrl.searchParams.delete('token');
  history.replaceState(
    null,
    '',
    `${bootstrapUrl.pathname}${bootstrapUrl.search}${bootstrapUrl.hash}`
  );
}
const $ = (id) => document.getElementById(id);
function esc(s) {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}
function fmt(ts) {
  if (!ts) return '-';
  const d = new Date(Number(ts) * 1000);
  return isNaN(d) ? String(ts) : d.toLocaleString('de-DE');
}
async function api(path, opt = {}) {
  const r = await fetch(path, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...opt,
    headers: { 'content-type': 'application/json', ...(opt.headers || {}) },
  });
  const txt = await r.text();
  let data;
  try {
    data = JSON.parse(txt);
  } catch {
    data = { ok: false, error: txt };
  }
  if (!r.ok) throw new Error(data.error || txt || 'HTTP ' + r.status);
  return data;
}
async function load() {
  $('status').textContent = 'lade…';
  const data = await api('/api/tasks');
  TASKS = data.items || [];
  $('status').textContent =
    `${data.count || 0} Entscheidungen · ausgeschlossen: ${(data.excludedBoards || []).join(', ') || '-'} · ${new Date((data.generatedAt || 0) * 1000).toLocaleTimeString('de-DE')}`;
  if (data.errors && data.errors.length)
    $('status').textContent += ` · ${data.errors.length} Board-Fehler`;
  render();
}
function render() {
  const q = $('q').value.toLowerCase();
  const items = TASKS.filter((t) => JSON.stringify(t).toLowerCase().includes(q));
  $('cards').innerHTML =
    items.map(card).join('') ||
    '<div class="empty">Keine aktuellen HITL-Entscheidungen gefunden.</div>';
}
function card(t) {
  const body = (t.body || '').slice(0, 420);
  return `<article class="card">
    <div class="top"><div><b>${esc(t.id)}</b> <span>${esc(t.board)}</span></div><span class="badge">${esc(t.status)}${t.block_kind ? ' · ' + esc(t.block_kind) : ''}</span></div>
    <h2>${esc(t.title)}</h2>
    <div class="meta">Owner: ${esc(t.assignee || '-')} · Priority: ${esc(t.priority || 0)} · Created: ${esc(fmt(t.created_at))}</div>
    <p>${esc(body)}${(t.body || '').length > 420 ? '…' : ''}</p>
    <details><summary>Details / Kommentare / Result</summary>
      <h3>Body</h3><pre>${esc(t.body || '')}</pre>
      ${t.result ? `<h3>Result</h3><pre>${esc(t.result)}</pre>` : ''}
      <h3>Kommentare</h3>${(t.comments || []).map((c) => `<div class="comment"><b>${esc(c.author)}</b> · ${esc(fmt(c.created_at))}<br>${esc(c.body)}</div>`).join('') || '<div class="muted">Keine Kommentare.</div>'}
      <h3>Attachments</h3>${(t.attachments || []).map((a) => `<div class="muted">${esc(a.filename)} (${esc(a.size)} bytes)</div>`).join('') || '<div class="muted">Keine Attachments.</div>'}
    </details>
    <div class="actions">
      <button onclick="act('${esc(t.board)}','${esc(t.id)}','approve')">Freigeben</button>
      <button onclick="act('${esc(t.board)}','${esc(t.id)}','reject')" class="warn">Ablehnen</button>
      <button onclick="act('${esc(t.board)}','${esc(t.id)}','question', true)" class="secondary">Rückfrage</button>
      <button onclick="act('${esc(t.board)}','${esc(t.id)}','close')" class="secondary">Schließen</button>
    </div>
  </article>`;
}
async function act(board, id, action, needComment = false) {
  const comment = needComment
    ? prompt('Kommentar/Rückfrage:')
    : action === 'reject'
      ? prompt('Optionaler Ablehnungs-Kommentar:')
      : '';
  if (needComment && !comment) return;
  const old = $('status').textContent;
  $('status').textContent = `${action} ${board}/${id}…`;
  try {
    await api(`/api/tasks/${encodeURIComponent(board)}/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      body: JSON.stringify({ comment: comment || '' }),
    });
    $('status').textContent = `OK: ${action} ${board}/${id}`;
    await load();
  } catch (e) {
    $('status').textContent = old;
    alert('Aktion fehlgeschlagen: ' + e.message);
  }
}
window.act = act;
$('q').addEventListener('input', render);
$('refresh').addEventListener('click', load);
async function exposeManagementView() {
  try {
    const config = await api('/api/management/config');
    if (config.enabled) {
      $('management-link').href = '/management';
      $('management-link').hidden = false;
    }
  } catch (_) {
    /* Legacy fallback stays self-contained. */
  }
}
exposeManagementView();
load().catch((e) => {
  $('status').textContent = 'Fehler: ' + e.message;
});
