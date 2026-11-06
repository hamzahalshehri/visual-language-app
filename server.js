require('dotenv').config();
const express = require('express');
const path = require('path');
const pool = require('./database/db');

const app = express();
app.use(express.json());

// تقديم الملفات الثابتة من مجلد frontend
app.use(express.static(path.join(__dirname, 'frontend')));

// تهيئة الجداول والحسابات الأساسية تلقائياً
async function initDB() {
  try {
    // 1. إنشاء جدول المستخدمين
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(20) CHECK (role IN ('admin', 'specialist', 'parent')) NOT NULL
      );
    `);

    // 2. إضافة حساب الأدمن الرئيسي
    await pool.query(`
      INSERT INTO users (name, email, password, role)
      VALUES ('حمزة الشهري', 'admin@example.com', '123456', 'admin')
      ON CONFLICT (email) DO NOTHING;
    `);

    // 3. إضافة حساب الأخصائية وفاء الشهري
    await pool.query(`
      INSERT INTO users (name, email, password, role)
      VALUES ('وفاء الشهري', 'wafaa@example.com', '123456', 'specialist')
      ON CONFLICT (email) DO NOTHING;
    `);

    console.log('✅ تم تهيئة الجداول والحسابات (حمزة الشهري ووفاء الشهري) بنجاح!');
  } catch (err) {
    console.error('❌ خطأ في تهيئة قاعدة البيانات:', err.message);
  }
}

initDB();

// مسار تسجيل الدخول
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query(
      'SELECT id, name, email, role FROM users WHERE email = $1 AND password = $2',
      [email, password]
    );

    if (result.rows.length > 0) {
      res.json({ success: true, user: result.rows[0] });
    } else {
      res.status(401).json({ success: false, message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 السيرفر يعمل حالياً على http://localhost:${PORT}`);
});