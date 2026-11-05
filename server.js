const express = require('express');
const path = require('path');
const pool = require('./database/db.js');

const app = express();
app.use(express.json());

// توجيه سيرفر Express لقراءة الواجهات من مجلد frontend
app.use(express.static(path.join(__dirname, 'frontend')));

// تهيئة جداول PostgreSQL
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) CHECK (role IN ('admin', 'specialist', 'parent')) NOT NULL
      );

      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        full_name VARCHAR(100) NOT NULL,
        age INT,
        specialist_id INT REFERENCES users(id) ON DELETE SET NULL,
        parent_id INT REFERENCES users(id) ON DELETE SET NULL
      );
    `);
    console.log("تم إنشاء الجداول بنجاح في PostgreSQL");
  } catch (err) {
    console.error("خطأ في الاتصال بقاعدة البيانات:", err.message);
  }
}
initDB();

// API تسجيل الدخول
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1 AND password = $2', [email, password]);
    if (result.rows.length > 0) {
      const user = result.rows[0];
      res.json({ success: true, role: user.role, name: user.name, id: user.id });
    } else {
      res.status(401).json({ success: false, message: 'بيانات الدخول غير صحيحة' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`منصة اللغة المرئية تعمل على المنفذ ${PORT}`));