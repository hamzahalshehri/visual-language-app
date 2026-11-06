require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const pool = require('./database/db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// تخزين الاتصالات بقواعد بيانات المؤسسات لتسريع الاستجابة
const tenantPools = {};

// دالة الاتصال بقاعدة بيانات مؤسسة محددة
function getTenantPool(dbUrl) {
  if (!tenantPools[dbUrl]) {
    tenantPools[dbUrl] = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false }
    });
  }
  return tenantPools[dbUrl];
}

// 1. تهيئة قاعدة البيانات المركزية (جدول المؤسسات)
async function initCentralDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        code VARCHAR(50) UNIQUE NOT NULL,
        db_url TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ تم تهيئة قاعدة البيانات المركزية للمؤسسات بنجاح!');
  } catch (err) {
    console.error('❌ خطأ في تهيئة النظام المركزي:', err.message);
  }
}

// 2. دالة بناء الجداول داخل قاعدة البيانات الخاصة بكل مؤسسة جديدة
async function initTenantDB(tenantPool) {
  await tenantPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      password VARCHAR(255) NOT NULL,
      role VARCHAR(20) CHECK (role IN ('admin', 'specialist', 'student')) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      age INT NOT NULL,
      phone VARCHAR(20),
      specialist_id INT REFERENCES users(id) ON DELETE SET NULL,
      user_id INT REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS student_requests (
      id SERIAL PRIMARY KEY,
      student_name VARCHAR(100) NOT NULL,
      age INT NOT NULL,
      phone VARCHAR(20),
      email VARCHAR(100) NOT NULL,
      password VARCHAR(255) NOT NULL,
      specialist_id INT REFERENCES users(id) ON DELETE CASCADE,
      status VARCHAR(20) DEFAULT 'pending'
    );
  `);
}

initCentralDB();

// --- مسارات إدارة المؤسسات (لSuper Admin) ---

// إضافة مؤسسة جديدة برابط قاعدة بيانات مخصص
app.post('/api/organizations', async (req, res) => {
  const { name, code, db_url, admin_name, admin_email, admin_password } = req.body;
  try {
    // 1. تسجيل المؤسسة في المركزية
    const orgResult = await pool.query(
      'INSERT INTO organizations (name, code, db_url) VALUES ($1, $2, $3) RETURNING *',
      [name, code, db_url]
    );

    // 2. الاتصال بقاعدة بيانات المؤسسة الجديدة وتأسيس الجداول
    const tenantPool = getTenantPool(db_url);
    await initTenantDB(tenantPool);

    // 3. إنشاء حساب الأدمن الأول الخاص بالمؤسسة داخل داتابيس المؤسسة نفسها
    await tenantPool.query(
      "INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, 'admin') ON CONFLICT (email) DO NOTHING",
      [admin_name, admin_email, admin_password]
    );

    res.json({ success: true, message: 'تم إنشاء قاعدة بيانات المؤسسة وحساب مديرها بنجاح!', organization: orgResult.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'خطأ في إنشاء المؤسسة: ' + err.message });
  }
});

// جلب جميع المؤسسات
app.get('/api/organizations', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name, code, created_at FROM organizations');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'خطأ في جلب المؤسسات' });
  }
});

// --- مسار تسجيل الدخول الموحد التكيفي ---
app.post('/api/login', async (req, res) => {
  const { email, password, org_code } = req.body;
  try {
    // التثبت من كود المؤسسة
    const orgRes = await pool.query('SELECT * FROM organizations WHERE code = $1', [org_code]);
    if (orgRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'كود المؤسسة غير صحيح أو غير مسجل' });
    }

    const org = orgRes.rows[0];
    const tenantPool = getTenantPool(org.db_url);

    // التثبت من المستخدم من داتابيس المؤسسة المعزولة
    const userCheck = await tenantPool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'الحساب غير مسجل في هذه المؤسسة' });
    }

    const user = userCheck.rows[0];
    if (user.password !== password) {
      return res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة' });
    }

    res.json({
      success: true,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, org_code: org.code, org_name: org.name }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'حدث خطأ في اتصال المؤسسة' });
  }
});

// --- وسيط (Middleware) لتوجيه الطلبات لداتابيس المؤسسة الصحيحة ---
async function tenantMiddleware(req, res, next) {
  const orgCode = req.headers['x-org-code'];
  if (!orgCode) return res.status(400).json({ message: 'معرف المؤسسة مفقود' });

  try {
    const orgRes = await pool.query('SELECT db_url FROM organizations WHERE code = $1', [orgCode]);
    if (orgRes.rows.length === 0) return res.status(404).json({ message: 'المؤسسة غير موجودة' });

    req.tenantPool = getTenantPool(orgRes.rows[0].db_url);
    next();
  } catch (err) {
    res.status(500).json({ message: 'خطأ في الاتصال بقاعدة بيانات المؤسسة' });
  }
}

// تطبيق الوسيط على جميع عمليات الطلاب والأخصائيين
app.use('/api/specialists', tenantMiddleware);
app.use('/api/students', tenantMiddleware);
app.use('/api/student-requests', tenantMiddleware);

// --- مسارات عمليات المؤسسة العادية (تعمل على داتابيس المؤسسة المعزولة) ---

app.get('/api/specialists', async (req, res) => {
  const result = await req.tenantPool.query("SELECT id, name, email FROM users WHERE role = 'specialist'");
  res.json(result.rows);
});

app.post('/api/specialists', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    await req.tenantPool.query("INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, 'specialist')", [name, email, password]);
    res.json({ success: true, message: 'تم إضافة الأخصائي بنجاح في قاعدة بيانات المؤسسة' });
  } catch (err) {
    res.status(400).json({ success: false, message: 'البريد مستخدم بالفعل في هذه المؤسسة' });
  }
});

app.delete('/api/specialists/:id', async (req, res) => {
  await req.tenantPool.query('DELETE FROM users WHERE id = $1 AND role = $2', [req.params.id, 'specialist']);
  res.json({ success: true, message: 'تم طرد الأخصائي من المؤسسة' });
});

app.post('/api/students/direct', async (req, res) => {
  const { name, age, phone, email, password, specialist_id } = req.body;
  try {
    const specId = (specialist_id && specialist_id !== '') ? parseInt(specialist_id) : null;
    const userResult = await req.tenantPool.query(
      "INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, 'student') RETURNING id",
      [name, email, password]
    );
    await req.tenantPool.query(
      'INSERT INTO students (name, age, phone, specialist_id, user_id) VALUES ($1, $2, $3, $4, $5)',
      [name, parseInt(age), phone, specId, userResult.rows[0].id]
    );
    res.json({ success: true, message: 'تم إضافة الطالب وحسابه بنجاح' });
  } catch (err) {
    res.status(400).json({ success: false, message: 'البريد مسجل مسبقاً في داتابيس المؤسسة' });
  }
});

app.get('/api/students', async (req, res) => {
  const { specialist_id } = req.query;
  let query = `SELECT s.id, s.name, s.age, s.phone, u.name as specialist_name FROM students s LEFT JOIN users u ON s.specialist_id = u.id`;
  let params = [];
  if (specialist_id) {
    query += ' WHERE s.specialist_id = $1';
    params.push(specialist_id);
  }
  const result = await req.tenantPool.query(query, params);
  res.json(result.rows);
});

app.delete('/api/students/:id', async (req, res) => {
  const studRes = await req.tenantPool.query('SELECT user_id FROM students WHERE id = $1', [req.params.id]);
  if (studRes.rows.length > 0) {
    await req.tenantPool.query('DELETE FROM users WHERE id = $1', [studRes.rows[0].user_id]);
  } else {
    await req.tenantPool.query('DELETE FROM students WHERE id = $1', [req.params.id]);
  }
  res.json({ success: true, message: 'تم حذف الطالب نهائياً من قاعدة بيانات المؤسسة' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 السيرفر المتعدد للمؤسسات يعمل على http://localhost:${PORT}`));