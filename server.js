require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const pool = require('./database/db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// تهيئة محرك الذكاء الاصطناعي (Gemini)
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'YOUR_GEMINI_API_KEY');
const aiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

const tenantPools = {};

function getTenantPool(dbUrl) {
  if (!tenantPools[dbUrl]) {
    tenantPools[dbUrl] = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false }
    });
  }
  return tenantPools[dbUrl];
}

// تهيئة قاعدة البيانات المركزية
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
    console.log('✅ تم تهيئة السجل المركزي للمؤسسات بنجاح!');
  } catch (err) {
    console.error('❌ خطأ في تهيئة النظام المركزي:', err.message);
  }
}

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
      notes TEXT,
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

// --- 1. إنشاء حساب مؤسسة جديدة وتأسيس قاعدة بياناتها آلياً ---
app.post('/api/register-organization', async (req, res) => {
  const { org_name, org_code, db_url, admin_name, admin_email, admin_password } = req.body;
  try {
    const targetDbUrl = db_url || process.env.DATABASE_URL;

    // 1. تسجيل المؤسسة في السجل المركزي
    const orgRes = await pool.query(
      'INSERT INTO organizations (name, code, db_url) VALUES ($1, $2, $3) RETURNING *',
      [org_name, org_code, targetDbUrl]
    );

    // 2. تهيئة الجداول وتوليد حساب الأدمن التأسيسي
    const tenantPool = getTenantPool(targetDbUrl);
    await initTenantDB(tenantPool);

    await tenantPool.query(
      "INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, 'admin') ON CONFLICT (email) DO NOTHING",
      [admin_name, admin_email, admin_password]
    );

    res.json({
      success: true,
      message: 'تم تسجيل المؤسسة وبناء قاعدة البيانات وحساب المدير بنجاح!',
      org: orgRes.rows[0]
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ success: false, message: 'كود المؤسسة أو البريد مستخدم مسبقاً' });
  }
});

// تسجيل الدخول
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'الحساب غير مسجل في النظام' });
    }
    const user = userCheck.rows[0];
    if (user.password !== password) {
      return res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة' });
    }
    res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
  }
});

// --- 2. خدمات الذكاء الاصطناعي (Gemini AI Chatbot & Reports) ---

// أ) الشات بوت والرد الآلي الذكي
app.post('/api/ai/chat', async (req, res) => {
  const { message, user_role } = req.body;
  try {
    const systemPrompt = `أنت مساعد ذكي متخصص في "منصة اللغة المرئية" لمساعدة الأخصائيين وأولياء أمور ذوي التوحد. أجب بأسلوب راقٍ ومباشر وداعم باللغة العربية. دور المستخدم الحالي هو: ${user_role}. السؤال: ${message}`;
    const result = await aiModel.generateContent(systemPrompt);
    const responseText = result.response.text();
    res.json({ success: true, reply: responseText });
  } catch (err) {
    console.error('AI Chat Error:', err);
    res.json({ success: true, reply: 'أهلاً بك! أنا المساعد الذكي لمنصة اللغة المرئية. كيف يمكنني مساعدتك اليوم في متابعة الخطة اللغوية والجلسات؟' });
  }
});

// ب) توليد تقرير التطور اللغوي للطالب عبر الذكاء الاصطناعي
app.post('/api/ai/generate-report', async (req, res) => {
  const { student_name, age, notes } = req.body;
  try {
    const prompt = `قم بتوليد تقرير تقييم وتطور لغوي احترافي ومبسط للطالب (${student_name})، العمر (${age} سنوات). ملاحظات الأخصائي: ${notes || 'مستمر في جلسات التفاعل المرئي وبناء المفردات'}. قسم التقرير إلى: 1. الملخص التنفيذي، 2. مستوى التفاعل والتواصل، 3. التوصيات لأولياء الأمور.`;
    const result = await aiModel.generateContent(prompt);
    res.json({ success: true, report: result.response.text() });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء توليد التقرير بالذكاء الاصطناعي' });
  }
});

// مسارات إدارة الطلاب والأخصائيين
app.get('/api/specialists', async (req, res) => {
  const result = await pool.query("SELECT id, name, email FROM users WHERE role = 'specialist'");
  res.json(result.rows);
});

app.post('/api/specialists', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    await pool.query("INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, 'specialist')", [name, email, password]);
    res.json({ success: true, message: 'تم إضافة الأخصائي بنجاح' });
  } catch (err) {
    res.status(400).json({ success: false, message: 'البريد مستخدم بالفعل' });
  }
});

app.delete('/api/specialists/:id', async (req, res) => {
  await pool.query('DELETE FROM users WHERE id = $1 AND role = $2', [req.params.id, 'specialist']);
  res.json({ success: true, message: 'تم طرد الأخصائي بنجاح' });
});

app.post('/api/students/direct', async (req, res) => {
  const { name, age, phone, email, password, specialist_id } = req.body;
  try {
    const specId = (specialist_id && specialist_id !== '') ? parseInt(specialist_id) : null;
    const userResult = await pool.query(
      "INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, 'student') RETURNING id",
      [name, email, password]
    );
    await pool.query(
      'INSERT INTO students (name, age, phone, specialist_id, user_id) VALUES ($1, $2, $3, $4, $5)',
      [name, parseInt(age), phone, specId, userResult.rows[0].id]
    );
    res.json({ success: true, message: 'تم إضافة الطالب وحسابه بنجاح' });
  } catch (err) {
    res.status(400).json({ success: false, message: 'البريد الإلكتروني مستخدم بالفعل' });
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
  const result = await pool.query(query, params);
  res.json(result.rows);
});

app.delete('/api/students/:id', async (req, res) => {
  const studRes = await pool.query('SELECT user_id FROM students WHERE id = $1', [req.params.id]);
  if (studRes.rows.length > 0) {
    await pool.query('DELETE FROM users WHERE id = $1', [studRes.rows[0].user_id]);
  } else {
    await pool.query('DELETE FROM students WHERE id = $1', [req.params.id]);
  }
  res.json({ success: true, message: 'تم حذف الطالب بنجاح' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 السيرفر الذكي يعمل على http://localhost:${PORT}`));