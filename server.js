require('dotenv').config();
const express = require('express');
const path = require('path');
const pool = require('./database/db');

const app = express();
app.use(express.json());

app.use(express.static(path.join(__dirname, 'frontend')));

// تهيئة الجداول الحيوية تلقائياً
async function initDB() {
  try {
    // 1. جدول المستخدمين
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) CHECK (role IN ('admin', 'specialist', 'parent')) NOT NULL
      );
    `);

    // 2. جدول الطلاب
    await pool.query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        age INT NOT NULL,
        specialist_id INT REFERENCES users(id) ON DELETE SET NULL
      );
    `);

    // إضافة الحسابات الأساسية
    await pool.query(`
      INSERT INTO users (name, email, password, role)
      VALUES ('حمزة الشهري', 'admin@example.com', '123456', 'admin')
      ON CONFLICT (email) DO NOTHING;
    `);

    await pool.query(`
      INSERT INTO users (name, email, password, role)
      VALUES ('وفاء الشهري', 'wafaa@example.com', '123456', 'specialist')
      ON CONFLICT (email) DO NOTHING;
    `);

    console.log('✅ تم تهيئة قاعدة البيانات والجداول بنجاح!');
  } catch (err) {
    console.error('❌ خطأ في تهيئة قاعدة البيانات:', err.message);
  }
}

initDB();

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

// جلب قائمة الأخصائيين
app.get('/api/specialists', async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name, email FROM users WHERE role = 'specialist'");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'خطأ في جلب الأخصائيين' });
  }
});

// إضافة أخصائي جديد (للأدمن)
app.post('/api/specialists', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, 'specialist') RETURNING id, name, email",
      [name, email, password]
    );
    res.json({ success: true, specialist: result.rows[0] });
  } catch (err) {
    res.status(400).json({ success: false, message: 'البريد الإلكتروني مستخدم بالفعل' });
  }
});

// طرد / حذف أخصائي (للأدمن)
app.delete('/api/specialists/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM users WHERE id = $1 AND role = $2', [id, 'specialist']);
    res.json({ success: true, message: 'تم طرد الأخصائي بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء الحذف' });
  }
});

// جلب جميع الطلاب
app.get('/api/students', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.id, s.name, s.age, u.name as specialist_name, s.specialist_id 
      FROM students s 
      LEFT JOIN users u ON s.specialist_id = u.id
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'خطأ في جلب الطلاب' });
  }
});

// إضافة طالب جديد (للأخصائي والأدمن)
app.post('/api/students', async (req, res) => {
  const { name, age, specialist_id } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO students (name, age, specialist_id) VALUES ($1, $2, $3) RETURNING *',
      [name, age, specialist_id]
    );
    res.json({ success: true, student: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في إضافة الطالب' });
  }
});

// تعديل أخصائي الطالب (للأدمن)
app.put('/api/students/:id', async (req, res) => {
  const { id } = req.params;
  const { specialist_id } = req.body;
  try {
    await pool.query('UPDATE students SET specialist_id = $1 WHERE id = $2', [specialist_id, id]);
    res.json({ success: true, message: 'تم تعديل أخصائي الطالب بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ في التعديل' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 السيرفر يعمل على http://localhost:${PORT}`));