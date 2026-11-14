const express = require('express'), pg = require('pg'), bcrypt = require('bcryptjs'),
      jwt = require('jsonwebtoken'), fs = require('fs'), path = require('path');
pg.types.setTypeParser(1082, v => v); // keep DATE columns as plain 'YYYY-MM-DD'
const app = express(); app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
const isDeployed = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
const SECRET = process.env.JWT_SECRET || (isDeployed ? null : 'dev-secret-change-me');
if (!SECRET) throw new Error('JWT_SECRET is required in production');
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://bloodbank:bloodbank@localhost:5432/bloodbank',
  max: isDeployed ? 3 : 10
});
const q = (s, p) => pool.query(s, p).then(r => r.rows);
let databaseReady;
const initializeDatabase = () => {
  if (!databaseReady) {
    databaseReady = (async () => {
      await pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
      const defaultUsers = [
        ['Admin', process.env.ADMIN_EMAIL || (isDeployed ? '' : 'admin@bloodbank.local'), process.env.ADMIN_PASSWORD || (isDeployed ? '' : 'Admin@123'), 'admin'],
        ['Blood Bank Staff', process.env.STAFF_EMAIL || (isDeployed ? '' : 'staff@bloodbank.local'), process.env.STAFF_PASSWORD || (isDeployed ? '' : 'Staff@123'), 'staff']
      ];
      for (const [name, email, password, role] of defaultUsers) {
        if (!email || !password) throw new Error(`${role.toUpperCase()}_EMAIL and ${role.toUpperCase()}_PASSWORD are required in production`);
        await q('insert into users(name,email,password_hash,role) values($1,$2,$3,$4) on conflict(email) do nothing',
          [name, email, await bcrypt.hash(password, 10), role]);
      }
    })().catch(e => {
      databaseReady = null;
      throw e;
    });
  }
  return databaseReady;
};
app.use('/api', (req, res, next) => {
  initializeDatabase().then(() => next()).catch(e => {
    console.error('Database initialization failed', e);
    res.status(503).json({ error: 'Database unavailable' });
  });
});
const err = (status, message) => Object.assign(new Error(message), { status });
const wrap = f => (req, res, next) => f(req, res, next).catch(e => {
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' }); });
const auth = (...roles) => (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET); }
  catch { return res.status(401).json({ error: 'Login required' }); }
  if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'Not allowed for your role' });
  next(); };
const GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const SHELF_LIFE_DAYS = 42, DONOR_GAP_DAYS = 90;
const DONOR_SQL = `select d.id,u.name,u.email,d.blood_group,d.phone,d.city,d.dob,
  (select max(collected_on) from blood_units b where b.donor_id=d.id) last_donation,
  (select count(*) from blood_units b where b.donor_id=d.id)::int donations,
  coalesce((select max(collected_on) from blood_units b where b.donor_id=d.id)<=current_date-${DONOR_GAP_DAYS},true) eligible
  from donors d join users u on u.id=d.user_id`;
const expire = () => q("update blood_units set status='expired' where status='available' and expiry_on<current_date");

// ---------- Authentication ----------
app.post('/api/auth/register', wrap(async (req, res) => {
  const { name, email, password, role, blood_group, phone, dob, city, hospital_name } = req.body;
  if (!name || !email || !password || password.length < 6) throw err(400, 'Name, email and password (min 6 chars) are required');
  if (!['donor', 'hospital'].includes(role)) throw err(400, 'Role must be donor or hospital');
  if (role === 'donor' && !GROUPS.includes(blood_group)) throw err(400, 'Valid blood group required');
  if ((await q('select 1 from users where email=$1', [email])).length) throw err(409, 'Email already registered');
  const [u] = await q('insert into users(name,email,password_hash,role,hospital_name) values($1,$2,$3,$4,$5) returning id,name,role',
    [name, email, await bcrypt.hash(password, 10), role, role === 'hospital' ? (hospital_name || name) : null]);
  if (role === 'donor') await q('insert into donors(user_id,blood_group,phone,dob,city) values($1,$2,$3,$4,$5)', [u.id, blood_group, phone || null, dob || null, city || null]);
  res.status(201).json(u); }));
app.post('/api/auth/login', wrap(async (req, res) => {
  const [u] = await q('select * from users where email=$1', [req.body.email]);
  if (!u || !(await bcrypt.compare(req.body.password || '', u.password_hash))) throw err(401, 'Invalid email or password');
  const user = { id: u.id, name: u.name, role: u.role };
  res.json({ ...user, token: jwt.sign(user, SECRET, { expiresIn: '8h' }) }); }));

// ---------- Users (admin) ----------
app.get('/api/users', auth('admin'), wrap(async (req, res) => res.json(await q('select id,name,email,role,hospital_name,created_at::date created from users order by id'))));
app.post('/api/users', auth('admin'), wrap(async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!['staff', 'admin'].includes(role) || !name || !email || (password || '').length < 6) throw err(400, 'Name, email, password (6+) and role staff/admin required');
  if ((await q('select 1 from users where email=$1', [email])).length) throw err(409, 'Email already registered');
  res.status(201).json((await q('insert into users(name,email,password_hash,role) values($1,$2,$3,$4) returning id,name,role', [name, email, await bcrypt.hash(password, 10), role]))[0]); }));

// ---------- Donors ----------
app.get('/api/donors', auth('admin', 'staff'), wrap(async (req, res) => res.json(await q(DONOR_SQL + ' order by d.id'))));
app.get('/api/me', auth('donor'), wrap(async (req, res) => {
  const [d] = await q(DONOR_SQL + ' where d.user_id=$1', [req.user.id]);
  const history = await q('select id,blood_group,volume_ml,collected_on,expiry_on,status from blood_units where donor_id=$1 order by collected_on desc', [d.id]);
  res.json({ ...d, history }); }));

// ---------- Blood units (donations / stock) ----------
app.get('/api/units', auth('admin', 'staff'), wrap(async (req, res) => {
  await expire();
  res.json(await q(`select b.id,b.blood_group,u.name donor,b.volume_ml,b.collected_on,b.expiry_on,b.status from blood_units b
    left join donors d on d.id=b.donor_id left join users u on u.id=d.user_id order by b.id desc limit 200`)); }));
app.post('/api/units', auth('admin', 'staff'), wrap(async (req, res) => {
  const [d] = await q(DONOR_SQL + ' where d.id=$1', [req.body.donor_id]);
  if (!d) throw err(404, 'Donor not found');
  if (!d.eligible) throw err(409, `Donor not eligible: last donation ${d.last_donation} (minimum gap ${DONOR_GAP_DAYS} days)`);
  const vol = parseInt(req.body.volume_ml) || 450;
  if (vol < 200 || vol > 500) throw err(400, 'Volume must be 200-500 ml');
  res.status(201).json((await q(`insert into blood_units(donor_id,blood_group,volume_ml,expiry_on,created_by)
    values($1,$2,$3,current_date+${SHELF_LIFE_DAYS},$4) returning *`, [d.id, d.blood_group, vol, req.user.id]))[0]); }));

// ---------- Blood requests ----------
const available = async g => (await q("select count(*)::int n from blood_units where blood_group=$1 and status='available' and expiry_on>=current_date", [g]))[0].n;
app.get('/api/requests', auth('admin', 'staff', 'hospital'), wrap(async (req, res) => {
  const h = req.user.role === 'hospital';
  res.json(await q(`select r.*,u.hospital_name hospital,r.created_at::date requested_on from blood_requests r join users u on u.id=r.hospital_id
    ${h ? 'where r.hospital_id=$1' : ''} order by r.id desc`, h ? [req.user.id] : [])); }));
app.post('/api/requests', auth('hospital'), wrap(async (req, res) => {
  const { blood_group, units, urgency, note } = req.body, n = parseInt(units);
  if (!GROUPS.includes(blood_group) || !(n > 0)) throw err(400, 'Valid blood group and units (>0) required');
  res.status(201).json((await q('insert into blood_requests(hospital_id,blood_group,units,urgency,note) values($1,$2,$3,$4,$5) returning *',
    [req.user.id, blood_group, n, ['normal', 'urgent', 'critical'].includes(urgency) ? urgency : 'normal', note || null]))[0]); }));
app.put('/api/requests/:id/status', auth('admin', 'staff'), wrap(async (req, res) => {
  const { status, note } = req.body;
  if (!['approved', 'rejected'].includes(status)) throw err(400, 'Status must be approved or rejected');
  const [r] = await q("select * from blood_requests where id=$1 and status='pending'", [req.params.id]);
  if (!r) throw err(409, 'Request is not pending');
  await expire();
  if (status === 'approved') { const a = await available(r.blood_group); if (a < r.units) throw err(409, `Insufficient stock: ${a} available, ${r.units} requested`); }
  res.json((await q('update blood_requests set status=$1,note=coalesce($2,note),decided_by=$3 where id=$4 returning *', [status, note || null, req.user.id, r.id]))[0]); }));
app.post('/api/requests/:id/issue', auth('admin', 'staff'), wrap(async (req, res) => {
  const c = await pool.connect();
  try {
    await c.query('begin'); await c.query("update blood_units set status='expired' where status='available' and expiry_on<current_date");
    const { rows: [r] } = await c.query("select * from blood_requests where id=$1 and status='approved' for update", [req.params.id]);
    if (!r) throw err(409, 'Request must be approved before issuing');
    const { rows: u } = await c.query("select id from blood_units where blood_group=$1 and status='available' order by expiry_on limit $2 for update", [r.blood_group, r.units]); // oldest first (FEFO)
    if (u.length < r.units) throw err(409, `Only ${u.length} unit(s) available`);
    await c.query("update blood_units set status='issued',request_id=$1 where id=any($2)", [r.id, u.map(x => x.id)]);
    await c.query("update blood_requests set status='issued' where id=$1", [r.id]);
    await c.query('commit'); res.json({ issued: u.length });
  } catch (e) { await c.query('rollback'); throw e; } finally { c.release(); } }));

// ---------- Dashboard ----------
app.get('/api/dashboard', auth(), wrap(async (req, res) => {
  await expire();
  const stock = await q(`select g blood_group,count(b.id) filter(where b.status='available')::int available from unnest($1::text[]) g
    left join blood_units b on b.blood_group=g group by g order by g`, [GROUPS]);
  const [c] = await q(`select (select count(*) from donors)::int total_donors,
    (select count(*) from blood_units where status='available')::int units_available,
    (select count(*) from blood_requests where status='pending')::int pending_requests,
    (select count(*) from blood_units where status='available' and expiry_on<=current_date+7)::int expiring_in_7_days`);
  let cards = c, recent = null;
  if (req.user.role === 'hospital') {
    const [h] = await q("select count(*)::int my_requests,count(*) filter(where status='pending')::int pending from blood_requests where hospital_id=$1", [req.user.id]);
    cards = { ...h, units_available: c.units_available };
  } else if (req.user.role === 'donor') {
    const [d] = await q(DONOR_SQL + ' where d.user_id=$1', [req.user.id]);
    cards = { my_donations: d.donations, eligible_to_donate: d.eligible ? 'Yes' : 'No', units_available: c.units_available };
  } else recent = await q('select r.id,u.hospital_name hospital,r.blood_group,r.units,r.status from blood_requests r join users u on u.id=r.hospital_id order by r.id desc limit 5');
  res.json({ cards, stock, recent }); }));

// ---------- Reports (JSON or ?format=csv) ----------
const REPORTS = {
  availability: `select g blood_group,count(b.id) filter(where b.status='available')::int available_units,
    count(b.id) filter(where b.status='available' and b.expiry_on<=current_date+7)::int expiring_in_7_days,
    count(b.id) filter(where b.status='issued')::int issued_units
    from unnest('{A+,A-,B+,B-,AB+,AB-,O+,O-}'::text[]) g left join blood_units b on b.blood_group=g group by g order by g`,
  donors: `select d.id,u.name,u.email,d.blood_group,d.phone,d.city,u.created_at::date registered_on from donors d join users u on u.id=d.user_id order by d.id`,
  requests: `select r.id,u.hospital_name hospital,r.blood_group,r.units,r.urgency,r.status,r.created_at::date requested_on from blood_requests r join users u on u.id=r.hospital_id order by r.id`,
  stock: `select b.id unit_id,b.blood_group,u.name donor,b.volume_ml,b.collected_on,b.expiry_on,b.status from blood_units b
    left join donors d on d.id=b.donor_id left join users u on u.id=d.user_id order by b.expiry_on` };
app.get('/api/reports/:name', auth('admin', 'staff'), wrap(async (req, res) => {
  if (!REPORTS[req.params.name]) throw err(404, 'Unknown report');
  await expire(); const rows = await q(REPORTS[req.params.name]);
  if (req.query.format !== 'csv') return res.json(rows);
  const cols = rows[0] ? Object.keys(rows[0]) : [], esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  res.type('text/csv').attachment(req.params.name + '-report.csv').send([cols.join(','), ...rows.map(r => cols.map(c => esc(r[c])).join(','))].join('\n')); }));

app.get('/health', (req, res) => res.send('ok'));
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log('====================================');
    console.log('BLOOD BANK MANAGEMENT SYSTEM');
    console.log('====================================');
    console.log('Server running on port: ' + PORT);
    console.log('Application URL: http://localhost:' + PORT);
    console.log('====================================');
  });
}

module.exports = app;