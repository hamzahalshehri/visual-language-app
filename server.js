require('dotenv').config();
const express = require('express');
const path = require('path');
const pool = require('./database/db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

async function initDB() {
  try {
    // 1. جدول المستخدمين
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) CHECK (role IN ('admin', 'specialist', 'student')) NOT NULL
      );
    `);

    // 2. جدول الطلاب
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

    // 3. جدول طلبات إضافة الطلاب
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

    // الحسابات التأسيسية
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

    console.log('✅ تم تهيئة قاعدة البيانات بنجاح!');
  } catch (err) {
    console.error('❌ خطأ في التهيئة:', err.message);
  }
}

initDB();

// تسجيل الدخول (يدعم الأدمن، الأخصائية، والطالب/ولي الأمر)
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

// جلب الأخصائيين
app.get('/api/specialists', async (req, res) => {
  try {
    const result = await pool.query("SELECT id, name, email FROM users WHERE role = 'specialist'");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'خطأ في جلب الأخصائيين' });
  }
});

// إضافة أخصائي (الأدمن)
app.post('/api/specialists', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    await pool.query(
      "INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, 'specialist')",
      [name, email, password]
    );
    res.json({ success: true, message: 'تمت إضافة الأخصائي بنجاح' });
  } catch (err) {
    res.status(400).json({ success: false, message: 'البريد الإلكتروني مستخدم بالفعل' });
  }
});

// طرد أخصائي (الأدمن)
app.delete('/api/specialists/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM users WHERE id = $1 AND role = $2', [id, 'specialist']);
    res.json({ success: true, message: 'تم طرد الأخصائي بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء الحذف' });
  }
});

// إضافة طالب مباشرة وبحسابه الخاص (الأدمن)
app.post('/api/students/direct', async (req, res) => {
  const { name, age, phone, email, password, specialist_id } = req.body;
  try {
    const specId = (specialist_id && specialist_id !== '') ? parseInt(specialist_id) : null;
    
    // 1. إنشاء حساب الطالب
    const userResult = await pool.query(
      "INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, 'student') RETURNING id",
      [name, email, password]
    );
    
    // 2. ربط بيانات الطالب
    await pool.query(
      'INSERT INTO students (name, age, phone, specialist_id, user_id) VALUES ($1, $2, $3, $4, $5)',
      [name, parseInt(age), phone, specId, userResult.rows[0].id]
    );
    
    res.json({ success: true, message: 'تم إضافة الطالب وإنشاء حسابه بنجاح' });
  } catch (err) {
    res.status(400).json({ success: false, message: 'البريد الإلكتروني مستخدم بالفعل أو حدث خطأ في البيانات' });
  }
});

// إرسال طلب إضافة طالب بحسابه المخصص (الأخصائية)
app.post('/api/student-requests', async (req, res) => {
  const { student_name, age, phone, email, password, specialist_id } = req.body;
  try {
    await pool.query(
      'INSERT INTO student_requests (student_name, age, phone, email, password, specialist_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [student_name, parseInt(age), phone, email, password, parseInt(specialist_id)]
    );
    res.json({ success: true, message: 'تم إرسال طلب إضافة الطالب وحسابه للأدمن' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ في إرسال الطلب' });
  }
});

// جلب الطلبات المعلقة (الأدمن)
app.get('/api/student-requests', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.student_name, r.age, r.phone, r.email, u.name as specialist_name, r.specialist_id 
      FROM student_requests r
      JOIN users u ON r.specialist_id = u.id
      WHERE r.status = 'pending'
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'خطأ في جلب الطلبات' });
  }
});

// موافقة الأدمن على الطالب
app.post('/api/student-requests/:id/approve', async (req, res) => {
  const { id } = req.params;
  try {
    const reqData = await pool.query('SELECT * FROM student_requests WHERE id = $1', [id]);
    if (reqData.rows.length === 0) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });

    const { student_name, age, phone, email, password, specialist_id } = reqData.rows[0];

    const userResult = await pool.query(
      "INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, 'student') RETURNING id",
      [student_name, email, password]
    );

    await pool.query(
      'INSERT INTO students (name, age, phone, specialist_id, user_id) VALUES ($1, $2, $3, $4, $5)',
      [student_name, age, phone, specialist_id, userResult.rows[0].id]
    );

    await pool.query("UPDATE student_requests SET status = 'approved' WHERE id = $1", [id]);

    res.json({ success: true, message: 'تمت الموافقة وإنشاء حساب الطالب بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء الموافقة' });
  }
});

// جلب قائمة الطلاب
app.get('/api/students', async (req, res) => {
  const { specialist_id } = req.query;
  try {
    let query = `
      SELECT s.id, s.name, s.age, s.phone, u.name as specialist_name, s.specialist_id, s.user_id 
      FROM students s 
      LEFT JOIN users u ON s.specialist_id = u.id
    `;
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

// حذف طالب (للأدمن والأخصائية)
app.delete('/api/students/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const studRes = await pool.query('SELECT user_id FROM students WHERE id = $1', [id]);
    if (studRes.rows.length > 0) {
      const userId = studRes.rows[0].user_id;
      // حذف حساب الطالب من جدول المستخدمين (سيحذف الطالب تلقائياً عبر CASCADE)
      await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    } else {
      await pool.query('DELETE FROM students WHERE id = $1', [id]);
    }
    res.json({ success: true, message: 'تم حذف الطالب وحسابه بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء حذف الطالب' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 السيرفر يعمل على http://localhost:${PORT}`));