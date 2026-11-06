require('dotenv').config();
const express = require('express');
const path = require('path');
const pool = require('./database/db');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

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
        specialist_id INT REFERENCES users(id) ON DELETE SET NULL,
        user_id INT REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS student_requests (
        id SERIAL PRIMARY KEY,
        student_name VARCHAR(100) NOT NULL,
        age INT NOT NULL,
        specialist_id INT REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(20) DEFAULT 'pending'
      );
    `);

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
    const result = await pool.query(
      "INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, 'specialist') RETURNING id, name, email",
      [name, email, password]
    );
    res.json({ success: true, message: 'تمت إضافة الأخصائي بنجاح' });
  } catch (err) {
    res.status(400).json({ success: false, message: 'البريد الإلكتروني مستخدم بالفعل' });
  }
});

app.delete('/api/specialists/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM users WHERE id = $1 AND role = $2', [id, 'specialist']);
    res.json({ success: true, message: 'تم طرد الأخصائي بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'خطأ أثناء الحذف' });
  }
});

// إضافة طالب مباشرة للحقيبة الإدارية
app.post('/api/students/direct', async (req, res) => {
  const { name, age, specialist_id } = req.body;
  try {
    const specId = (specialist_id && specialist_id !== '') ? parseInt(specialist_id) : null;
    const generatedEmail = `student_${Date.now()}@domain.com`;
    
    const userResult = await pool.query(
      "INSERT INTO users (name, email, password, role) VALUES ($1, $2, '123456', 'student') RETURNING id",
      [name, generatedEmail]
    );
    
    await pool.query(
      'INSERT INTO students (name, age, specialist_id, user_id) VALUES ($1, $2, $3, $4)',
      [name, parseInt(age), specId, userResult.rows[0].id]
    );
    
    res.json({ success: true, message: 'تم إضافة الطالب وحسابه بنجاح' });
  } catch (err) {
    console.error('Direct Student Add Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ في إضافة الطالب: ' + err.message });
  }
});

// إرسال طلب إضافة من الأخصائي
app.post('/api/student-requests', async (req, res) => {
  const { student_name, age, specialist_id } = req.body;
  try {
    await pool.query(
      'INSERT INTO student_requests (student_name, age, specialist_id) VALUES ($1, $2, $3)',
      [student_name, parseInt(age), parseInt(specialist_id)]
    );
    res.json({ success: true, message: 'تم إرسال الطلب إلى الأدمن للموافقة' });
  } catch (err) {
    console.error('Student Request Error:', err);
    res.status(500).json({ success: false, message: 'حدث خطأ في إرسال الطلب' });
  }
});

app.get('/api/student-requests', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.id, r.student_name, r.age, u.name as specialist_name, r.specialist_id 
      FROM student_requests r
      JOIN users u ON r.specialist_id = u.id
      WHERE r.status = 'pending'
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ message: 'خطأ في جلب الطلبات' });
  }
});

app.post('/api/student-requests/:id/approve', async (req, res) => {
  const { id } = req.params;
  try {
    const reqData = await pool.query('SELECT * FROM student_requests WHERE id = $1', [id]);
    if (reqData.rows.length === 0) return res.status(404).json({ success: false, message: 'الطلب غير موجود' });

    const { student_name, age, specialist_id } = reqData.rows[0];
    const generatedEmail = `student_${Date.now()}@domain.com`;

    const userResult = await pool.query(
      "INSERT INTO users (name, email, password, role) VALUES ($1, $2, '123456', 'student') RETURNING id",
      [student_name, generatedEmail]
    );

    await pool.query(
      'INSERT INTO students (name, age, specialist_id, user_id) VALUES ($1, $2, $3, $4)',
      [student_name, age, specialist_id, userResult.rows[0].id]
    );

    await pool.query("UPDATE student_requests SET status = 'approved' WHERE id = $1", [id]);

    res.json({ success: true, message: 'تمت الموافقة وإنشاء حساب الطالب بنجاح' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ أثناء الموافقة' });
  }
});

app.get('/api/students', async (req, res) => {
  const { specialist_id } = req.query;
  try {
    let query = `
      SELECT s.id, s.name, s.age, u.name as specialist_name, s.specialist_id 
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 السيرفر يعمل على http://localhost:${PORT}`));