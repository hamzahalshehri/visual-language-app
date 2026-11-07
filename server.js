require('dotenv').config();
const express = require('express');
const path = require('path');
const pool = require('./database/db');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// تهيئة Gemini API للميزات الذكية
const apiKey = process.env.GEMINI_API_KEY;
let aiModel = null;

if (apiKey) {
  const genAI = new GoogleGenerativeAI(apiKey);
  aiModel = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
}

// 1. تهيئة قاعدة البيانات والتأكد من الجداول
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

// 2. مسار تسجيل الدخول الموحد (يدعم كود المؤسسة اختياريًا)
app.post('/api/login', async (req, res) => {
  const { email, password, org_code } = req.body;
  try {
    const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'الحساب غير مسجل في النظام' });
    }
    const user = userCheck.rows[0];
    if (user.password !== password) {
      return res.status(401).json({ success: false, message: 'كلمة المرور غير صحيحة' });
    }
    res.json({
      success: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        org_code: org_code || 'org1'
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ في الخادم' });
  }
});

// 3. مسار الشات بوت والرد الآلي الذكي (Gemini AI)
app.post('/api/ai/chat', async (req, res) => {
  const { message, user_role, user_id } = req.body;
  try {
    let studentsCount = 0;
    if (user_role === 'admin') {
      const countRes = await pool.query('SELECT COUNT(*) FROM students');
      studentsCount = parseInt(countRes.rows[0].count);
    } else if (user_id) {
      const countRes = await pool.query('SELECT COUNT(*) FROM students WHERE specialist_id = $1', [user_id]);
      studentsCount = parseInt(countRes.rows[0].count);
    }

    if (!aiModel) {
      return res.json({
        success: true,
        reply: `مرحباً بك! رتبتك في المنصة هي (${user_role}) وعدد الطلاب المسجلين حالياً في النظام هو (${studentsCount}) طالب. يرجى الضغط على Manual Deploy في Render لتنشيط مفتاح الذكاء الاصطناعي الذكي.`
      });
    }

    const systemPrompt = `
      أنت المساعد الذكي التفاعلي لـ "منصة اللغة المرئية".
      سياق حساب المستخدم:
      - الرتبة: ${user_role}
      - عدد الطلاب التابعين له في قاعدة البيانات: ${studentsCount} طالب.

      السؤال المطلوب الإجابة عنه: "${message}"
      أجب باختصار، دقة، وأسلوب مباشر باللغة العربية.
    `;

    const result = await aiModel.generateContent(systemPrompt);
    res.json({ success: true, reply: result.response.text() });

  } catch (err) {
    console.error('AI Error:', err);
    res.json({ success: true, reply: 'أهلاً بك! أنا المساعد الذكي، كيف أستطيع مساعدتك في متابعة الجلسات وتطور الطلاب اليوم؟' });
  }
});

// 4. مسار توليد التقرير بالذكاء الاصطناعي
app.post('/api/ai/generate-report', async (req, res) => {
  try {
    const studentRes = await pool.query('SELECT * FROM students LIMIT 1');
    const student = studentRes.rows.length > 0 ? studentRes.rows[0] : { name: 'فالح', age: 6 };

    if (!aiModel) {
      return res.json({
        success: true,
        report: `📋 تقرير تقييم التطور اللغوي للطالب (${student.name}):\n- العمر: ${student.age} سنوات\n- ملخص الحالة: يظهر الطالب تفاعلاً ممتازاً مع جلسات اللغة المرئية والتواصل البصري.`
      });
    }

    const prompt = `
      اكتب تقرير تقييم تطور لغوي مختصر ومشجع للطالب (${student.name})، عمره (${student.age} سنوات).
      يتضمن التقرير:
      1. مستوى التفاعل والتواصل البصري.
      2. التقدم اللغوي والمفردات في الجلسات.
      3. نصيحة سريعة لولي الأمر.
    `;

    const result = await aiModel.generateContent(prompt);
    res.json({ success: true, report: result.response.text() });
  } catch (err) {
    res.status(500).json({ success: false, message: 'حدث خطأ في توليد التقرير' });
  }
});

// مسارات الطلاب والأخصائيين
app.get('/api/specialists', async (req, res) => {
  const result = await pool.query("SELECT id, name, email FROM users WHERE role = 'specialist'");
  res.json(result.rows);
});

app.post('/api/specialists', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    await pool.query("INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, 'specialist')", [name, email, password]);
    res.json({ success: true, message: 'تمت إضافة الأخصائي بنجاح' });
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
    res.status(400).json({ success: false, message: 'البريد مستخدم بالفعل أو البيانات غير مكتملة' });
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
app.listen(PORT, () => console.log(`🚀 السيرفر يعمل على http://localhost:${PORT}`));