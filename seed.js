require('dotenv').config();
const pool = require('./database/db');

async function createSeedUser() {
  try {
    // إضافة مستخدم تجريبي بصلاحية مدير
    await pool.query(`
      INSERT INTO users (name, email, password, role) 
      VALUES ('حمزة الشهري', 'admin@example.com', '123456', 'admin')
      ON CONFLICT (email) DO NOTHING;
    `);
    console.log('✅ تم إنشاء الحساب التجريبي بنجاح!');
    process.exit(0);
  } catch (err) {
    console.error('❌ حدث خطأ أثناء إضافة البيانات:', err);
    process.exit(1);
  }
}

createSeedUser();