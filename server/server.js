require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const createUser = require('./models/User');
const createTodo = require('./models/Todo');

const app = express();
app.use(cors());
app.use(express.json());

const DB_PATH = path.join(__dirname, 'database', 'db.json');

async function readDB() {
  try {
    const raw = await fs.readFile(DB_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return { users: [], todos: [] };
  }
}
async function writeDB(data) {
  await fs.writeFile(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
}

/* ========== Auth ========== */
app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });

  const db = await readDB();
  if (db.users.find(u => u.email === email)) return res.status(400).json({ error: 'Email already registered' });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = createUser({ id: uuidv4(), name, email, passwordHash });
  db.users.push(user);
  await writeDB(db);
  res.json({ message: 'User registered' });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const db = await readDB();
  const user = db.users.find(u => u.email === email);
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(400).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET || 'dev_secret', { expiresIn: '7d' });
  res.json({ token });
});

function authenticateToken(req, res, next) {
  const auth = req.headers['authorization'];
  const token = auth && auth.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  jwt.verify(token, process.env.JWT_SECRET || 'dev_secret', (err, payload) => {
    if (err) return res.status(401).json({ error: 'Invalid token' });
    req.userId = payload.userId;
    next();
  });
}

app.get('/api/user/me', authenticateToken, async (req, res) => {
  const db = await readDB();
  const user = db.users.find(u => u.id === req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { passwordHash, ...safe } = user;
  res.json(safe);
});

/* ========== Todos ========== */
app.get('/api/todos', authenticateToken, async (req, res) => {
  const db = await readDB();
  let todos = db.todos.filter(t => t.userId === req.userId);

  // optional filter by available time (minutes)
  const available = Number(req.query.availableMinutes || 0);
  if (available > 0) {
    todos = todos.filter(t => Number(t.requiredMinutes || 0) <= available);
  }

  // optional sort
  if (req.query.sort === 'deadline') {
    todos.sort((a, b) => {
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return new Date(a.deadline) - new Date(b.deadline);
    });
  } else if (req.query.sort === 'availableMinutes') {
    todos.sort((a, b) => Number(a.requiredMinutes || 0) - Number(b.requiredMinutes || 0));
  } else {
    todos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  res.json(todos);
});

app.post('/api/todos', authenticateToken, async (req, res) => {
  const { title, deadline, requiredMinutes } = req.body;
  if (!title) return res.status(400).json({ error: 'Title required' });

  const db = await readDB();
  const todo = createTodo({
    id: uuidv4(),
    userId: req.userId,
    title,
    deadline: deadline ? new Date(deadline).toISOString() : null,
    requiredMinutes: Number(requiredMinutes || 0)
  });

  db.todos.push(todo);
  await writeDB(db);
  res.json(todo);
});

app.put('/api/todos/:id/complete', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const db = await readDB();
  const todo = db.todos.find(t => t.id === id && t.userId === req.userId);
  if (!todo) return res.status(404).json({ error: 'Todo not found' });
  if (todo.completed) return res.json({ message: 'Already completed', todo });

  todo.completed = true;
  todo.completedAt = new Date().toISOString();

  // update user's streak
  const user = db.users.find(u => u.id === req.userId);
  const now = new Date();
  if (!user.lastCompletionDate) {
    user.streak = 1;
  } else {
    const last = new Date(user.lastCompletionDate);
    const lastDay = new Date(last.getFullYear(), last.getMonth(), last.getDate());
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((today - lastDay) / (24 * 60 * 60 * 1000));
    if (diffDays === 0) {
      // same day — do nothing
    } else if (diffDays === 1) {
      user.streak = (user.streak || 0) + 1;
    } else {
      user.streak = 1;
    }
  }
  user.lastCompletionDate = now.toISOString();

  await writeDB(db);
  res.json({ message: 'Marked complete', todo, user: { streak: user.streak, lastCompletionDate: user.lastCompletionDate } });
});

app.delete('/api/todos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const db = await readDB();
  const idx = db.todos.findIndex(t => t.id === id && t.userId === req.userId);
  if (idx === -1) return res.status(404).json({ error: 'Todo not found' });
  db.todos.splice(idx, 1);
  await writeDB(db);
  res.json({ message: 'Deleted' });
});

/* ========== Email reminders (daily cron) ========== */
let mailerConfigured = false;
let transporter = null;

if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: process.env.EMAIL_PORT ? Number(process.env.EMAIL_PORT) : 587,
    secure: process.env.EMAIL_SECURE === 'true',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  transporter.verify().then(() => {
    console.log('Email transporter ready');
    mailerConfigured = true;
  }).catch(err => {
    console.warn('Email transporter verification failed:', err.message);
  });
} else {
  console.log('Email not configured. Set EMAIL_USER and EMAIL_PASS in .env to enable reminders.');
}

// run daily at 08:00
cron.schedule('0 8 * * *', async () => {
  try {
    const db = await readDB();
    const now = new Date();
    const in24 = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    for (const user of db.users) {
      const upcoming = db.todos.filter(t =>
        t.userId === user.id &&
        !t.completed &&
        t.deadline &&
        new Date(t.deadline) > now &&
        new Date(t.deadline) <= in24
      );
      if (upcoming.length && mailerConfigured) {
        const rows = upcoming.map(t => `<li>${t.title} — due: ${new Date(t.deadline).toLocaleString()}</li>`).join('');
        const html = `<p>Hi ${user.name},</p>
          <p>You have upcoming tasks due within 24 hours:</p>
          <ul>${rows}</ul>
          <p>— Stride</p>`;
        await transporter.sendMail({
          from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
          to: user.email,
          subject: 'Stride — Tasks due in 24 hours',
          html
        });
        console.log(`Sent reminder to ${user.email}`);
      }
    }
  } catch (e) {
    console.error('Cron job error', e);
  }
});

/* ========== static files ========== */
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening at http://localhost:${PORT}`);
});
