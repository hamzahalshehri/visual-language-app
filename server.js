require('dotenv').config();
const express = require('express');
const path = require('path');
const pool = require('./database/db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// تهيئة قاعدة البيانات والجداول الأساسية
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) CHECK (role IN ('admin', 'specialist', 'student')) NOT NULL
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        age INT NOT NULL,
        phone VARCHAR(20),
        specialist_id INT REFERENCES users(id) ON DELETE SET NULL,
        user_id INT REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    await pool.query(`
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

    // إضافة حساب الأدمن الرئيسي
    await pool.query(`
      INSERT INTO users (name, email, password, role)
      VALUES ('حمزة الشهري', 'admin@example.com', '123456', 'admin')
      ON CONFLICT (email) DO NOTHING;
    `);

    console.log('✅ تم تهيئة قاعدة البيانات بنجاح!');
  } catch (err) {
    console.error('❌ خطأ في التهيئة:', err.message);
  }
}

initDB();

// مسار تسجيل الدخول المباشر
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
    console.error(err);
    res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
  }
});

// مسارات إدارة الطلاب والأخصائيين
app.get('/api/specialists', async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name, email FROM users WHERE role = 'specialist'");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'خطأ في جلب الأخصائيين' });
  }
});

app.post('/api/specialists', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    await pool.query("INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, 'specialist')", [name, email, password]);
    res.json({ success: true, message: 'تم تمت إضافة الأخصائي بنجاح' });
  } catch (err) {
    res.status(400).json({ success: false, message: 'البريد الإلكتروني مستخدم بالفعل' });
  }
});

app.delete('/api/specialists/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1 AND role = $2', [req.params.id, 'specialist']);
    res.json({ success: true, message: 'تم طرد الأخصائي بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء الحذف' });
  }
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
    res.status(400).json({ success: false, message: 'حدث خطأ في إدخال بيانات الطالب' });
  }
});

app.get('/api/students', async (req, res) => {
  const { specialist_id } = req.query;
  try {
    let query = `SELECT s.id, s.name, s.age, s.phone, u.name as specialist_name FROM students s LEFT JOIN users u ON s.specialist_id = u.id`;
    let params = [];
    if (specialist_id) {
      query += ' WHERE s.specialist_id = $1';
      params.push(specialist_id);
    }
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'خطأ في جلب الطلاب' });
  }
});

app.delete('/api/students/:id', async (req, res) => {
  try {
    const studRes = await pool.query('SELECT user_id FROM students WHERE id = $1', [req.params.id]);
    if (studRes.rows.length > 0) {
      await pool.query('DELETE FROM users WHERE id = $1', [studRes.rows[0].user_id]);
    } else {
      await pool.query('DELETE FROM students WHERE id = $1', [req.params.id]);
    }
    res.json({ success: true, message: 'تم حذف الطالب بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء الحذف' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 السيرفر يعمل على http://localhost:${PORT}`));