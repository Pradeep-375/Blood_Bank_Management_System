const $ = s => document.querySelector(s);
let U = JSON.parse(localStorage.getItem('u') || 'null');
const GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const MENU = { admin: ['dashboard', 'donors', 'stock', 'requests', 'reports', 'users'], staff: ['dashboard', 'donors', 'stock', 'requests', 'reports'], donor: ['dashboard', 'profile'], hospital: ['dashboard', 'requests'] };
const esc = v => String(v ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tag = v => `<span class="tag t-${String(v).toLowerCase()}">${esc(v)}</span>`;
const opts = a => a.map(x => `<option>${x}</option>`).join('');
const fd = e => { e.preventDefault(); return Object.fromEntries(new FormData(e.target)); };
function toast(m, ok = true) { const t = $('#toast'); t.textContent = m; t.className = (ok ? 'ok' : 'bad') + ' show'; setTimeout(() => t.className = '', 3000); }
async function api(p, method = 'GET', body) {
  const r = await fetch('/api' + p, { method, headers: { 'Content-Type': 'application/json', ...(U ? { Authorization: 'Bearer ' + U.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && U) logout();
  if (!r.ok) throw new Error(d.error || 'Request failed'); return d; }
function logout() { localStorage.removeItem('u'); U = null; location.hash = '#login'; route(); }
const tbl = (cols, rows) => `<div class="scroll"><table><thead><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${c[1](r)}</td>`).join('')}</tr>`).join('') || '<tr><td>No records</td></tr>'}</tbody></table></div>`;
const auto = rows => rows.length ? tbl(Object.keys(rows[0]).map(k => [k.replace(/_/g, ' '), r => esc(r[k])]), rows) : '<p>No data</p>';
const staff = () => ['admin', 'staff'].includes(U.role);

const V = {
  async login() { return `<form class="narrow" onsubmit="return F.login(event)"><h2>Login</h2><label>Email</label><input name="email" type="email" required><label>Password</label><input name="password" type="password" required><button>Login</button><p><a href="#register">New donor / hospital? Register</a></p></form>`; },
  async register() { return `<form class="narrow" onsubmit="return F.register(event)"><h2>Register</h2>
    <label>Register as</label><select name="role" onchange="document.querySelectorAll('.d').forEach(x=>x.hidden=this.value!='donor');document.querySelectorAll('.h').forEach(x=>x.hidden=this.value!='hospital')"><option value="donor">Donor</option><option value="hospital">Hospital Representative</option></select>
    <label>Full name</label><input name="name" required><label>Email</label><input name="email" type="email" required><label>Password (min 6)</label><input name="password" type="password" minlength="6" required>
    <div class="h" hidden><label>Hospital name</label><input name="hospital_name"></div>
    <div class="d"><label>Blood group</label><select name="blood_group">${opts(GROUPS)}</select><label>Phone</label><input name="phone" pattern="[0-9+ -]{7,15}"><label>Date of birth</label><input name="dob" type="date"><label>City</label><input name="city"></div>
    <button>Create account</button><p><a href="#login">Back to login</a></p></form>`; },
  async dashboard() {
    const d = await api('/dashboard'), max = Math.max(1, ...d.stock.map(s => s.available));
    return `<h2>Dashboard</h2><div class="cards">${Object.entries(d.cards).map(([k, v]) => `<div class="card"><b>${esc(v)}</b><span>${k.replace(/_/g, ' ')}</span></div>`).join('')}</div>
    <h3>Blood availability (units)</h3><div class="bars">${d.stock.map(s => `<div class="bar"><b>${s.available}</b><i style="height:${s.available / max * 110}px"></i><span>${s.blood_group}</span></div>`).join('')}</div>
    ${d.recent ? '<h3>Recent requests</h3>' + tbl([['#', r => r.id], ['Hospital', r => esc(r.hospital)], ['Group', r => r.blood_group], ['Units', r => r.units], ['Status', r => tag(r.status)]], d.recent) : ''}`; },
  async donors() {
    const rows = await api('/donors'); window._donors = rows;
    return `<h2>Donors</h2><input id="q" placeholder="Search name / group / city" oninput="F.filter()"><div id="dt">${V._donorTable(rows)}</div>`; },
  _donorTable: rows => tbl([['ID', r => r.id], ['Name', r => esc(r.name)], ['Group', r => r.blood_group], ['Phone', r => esc(r.phone)], ['City', r => esc(r.city)], ['Donations', r => r.donations], ['Last donation', r => r.last_donation || '-'], ['Eligible', r => tag(r.eligible ? 'Yes' : 'No')]], rows),
  async stock() {
    const [donors, units] = await Promise.all([api('/donors'), api('/units')]);
    return `<h2>Donations & Blood Stock</h2><form onsubmit="return F.donate(event)"><h3>Record donation</h3><div class="row"><div><label>Donor</label><select name="donor_id">${donors.map(d => `<option value="${d.id}">${esc(d.name)} (${d.blood_group})${d.eligible ? '' : ' - not eligible'}</option>`).join('')}</select></div><div><label>Volume (ml)</label><input name="volume_ml" type="number" value="450" min="200" max="500"></div></div><button>Add unit</button></form>
    ${tbl([['Unit', r => r.id], ['Group', r => r.blood_group], ['Donor', r => esc(r.donor)], ['ml', r => r.volume_ml], ['Collected', r => r.collected_on], ['Expiry', r => r.expiry_on], ['Status', r => tag(r.status)]], units)}`; },
  async requests() {
    const rows = await api('/requests');
    const form = U.role === 'hospital' ? `<form onsubmit="return F.request(event)"><h3>New blood request</h3><div class="row"><div><label>Blood group</label><select name="blood_group">${opts(GROUPS)}</select></div><div><label>Units</label><input name="units" type="number" min="1" value="1"></div><div><label>Urgency</label><select name="urgency"><option>normal</option><option>urgent</option><option>critical</option></select></div></div><label>Note</label><input name="note"><button>Submit request</button></form>` : '';
    const act = r => !staff() ? '' : r.status === 'pending' ? `<button class="ok" onclick="F.decide(${r.id},'approved')">Approve</button><button class="alt" onclick="F.decide(${r.id},'rejected')">Reject</button>` : r.status === 'approved' ? `<button onclick="F.issue(${r.id})">Issue units</button>` : '';
    return `<h2>Blood Requests</h2>${form}${tbl([['#', r => r.id], ['Hospital', r => esc(r.hospital)], ['Group', r => r.blood_group], ['Units', r => r.units], ['Urgency', r => r.urgency], ['Date', r => r.requested_on], ['Status', r => tag(r.status)], ['Note', r => esc(r.note)], ['', act]], rows)}`; },
  async reports() { return `<h2>Reports</h2><div class="panel">${[['availability', 'Blood Group Availability'], ['donors', 'Donor Registration'], ['requests', 'Blood Requests'], ['stock', 'Blood Stock']].map(r => `<button onclick="F.report('${r[0]}')">${r[1]}</button>`).join('')}</div><div id="rep"></div>`; },
  async users() {
    const rows = await api('/users');
    return `<h2>Users</h2><form onsubmit="return F.addUser(event)"><h3>Create staff / admin</h3><div class="row"><div><label>Name</label><input name="name" required></div><div><label>Email</label><input name="email" type="email" required></div><div><label>Password</label><input name="password" type="password" minlength="6" required></div><div><label>Role</label><select name="role"><option>staff</option><option>admin</option></select></div></div><button>Create</button></form>
    ${tbl([['ID', r => r.id], ['Name', r => esc(r.name)], ['Email', r => esc(r.email)], ['Role', r => tag(r.role)], ['Hospital', r => esc(r.hospital_name)], ['Created', r => r.created]], rows)}`; },
  async profile() {
    const d = await api('/me');
    return `<h2>My Profile</h2><div class="panel"><p><b>${esc(d.name)}</b> - ${esc(d.email)}<br>Blood group: <b>${d.blood_group}</b> | Phone: ${esc(d.phone || '-')} | City: ${esc(d.city || '-')}<br>Eligible to donate now: ${tag(d.eligible ? 'Yes' : 'No')} (last donation: ${d.last_donation || 'never'})</p></div><h3>Donation history</h3>${tbl([['Unit', r => r.id], ['Collected', r => r.collected_on], ['Expiry', r => r.expiry_on], ['ml', r => r.volume_ml], ['Status', r => tag(r.status)]], d.history)}`; }
};

const F = {
  async login(e) { try { U = await api('/auth/login', 'POST', fd(e)); localStorage.setItem('u', JSON.stringify(U)); location.hash = '#dashboard'; route(); } catch (x) { toast(x.message, false); } return false; },
  async register(e) { try { await api('/auth/register', 'POST', fd(e)); toast('Registered - please login'); location.hash = '#login'; } catch (x) { toast(x.message, false); } return false; },
  filter() { const s = $('#q').value.toLowerCase(); $('#dt').innerHTML = V._donorTable(_donors.filter(d => [d.name, d.blood_group, d.city].join(' ').toLowerCase().includes(s))); },
  async act(fn, msg) { try { await fn(); toast(msg); route(); } catch (x) { toast(x.message, false); } return false; },
  donate(e) { const b = fd(e); return F.act(() => api('/units', 'POST', b), 'Donation recorded'); },
  request(e) { const b = fd(e); return F.act(() => api('/requests', 'POST', b), 'Request submitted'); },
  decide(id, status) { return F.act(() => api(`/requests/${id}/status`, 'PUT', { status }), 'Request ' + status); },
  issue(id) { return F.act(() => api(`/requests/${id}/issue`, 'POST'), 'Units issued'); },
  addUser(e) { const b = fd(e); return F.act(() => api('/users', 'POST', b), 'User created'); },
  async report(n) {
    try { const rows = await api('/reports/' + n); $('#rep').innerHTML = `<button class="alt" onclick="F.csv('${n}')">Export CSV</button><button class="alt" onclick="print()">Print</button>` + auto(rows); } catch (x) { toast(x.message, false); } },
  async csv(n) { const r = await fetch(`/api/reports/${n}?format=csv`, { headers: { Authorization: 'Bearer ' + U.token } }); const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = n + '-report.csv'; a.click(); }
};

async function route() {
  const page = (location.hash || '#login').slice(1), pub = ['login', 'register'];
  if (!U && !pub.includes(page)) { location.hash = '#login'; return; }
  if (U && (pub.includes(page) || !MENU[U.role].includes(page))) { location.hash = '#dashboard'; return; }
  $('#nav').innerHTML = U ? MENU[U.role].map(p => `<a href="#${p}" class="${p === page ? 'on' : ''}">${p}</a>`).join('') + `<a href="#login" onclick="logout()">Logout (${esc(U.name)})</a>` : '';
  try { $('#app').innerHTML = await V[page](); } catch (e) { $('#app').innerHTML = `<p>${esc(e.message)}</p>`; } }
addEventListener('hashchange', route); route();
