import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cors from 'cors';

const app = express();
app.use(express.json());
app.use(cors({
  origin: 'http://localhost:3000', 
  credentials: true
}));


const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('FATAL: JWT_SECRET is not set in .env');
  process.exit(1);
}



const db = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

(async () => {
  try {
    await db.query('SELECT 1');
    console.log('DB connection successful');
  } catch (err) {
    console.error('DB connection failed:', err);
    process.exit(1);
  }
})();

// Middleware 
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
    console.log('Authorization Header:', authHeader);
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    console.log('No token provided');
    return res.sendStatus(401);
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.log('Invalid token:', err.message);
      return res.sendStatus(403);
    }

    req.user = user;
    next();
  });
}



// AUTH

// SIGNUP
app.post('/register', async (req, res) => {
  const { username, email, password, retype_password } = req.body;

  if (!username || !email || !password || !retype_password) {
    return res.status(400).json({ message: 'All fields are required' });
  }

  if (password !== retype_password) {
    return res.status(400).json({ message: 'Passwords do not match' });
  }

  try {
    const [existingUser] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

    if (existingUser.length > 0) {
      return res.status(400).json({ message: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await db.query(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      [username, email, hashedPassword]
    );

    res.status(201).json({ message: 'User registered successfully' });

  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Server error during signup' });
  }
});




// LOGIN
app.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

    if (rows.length === 0) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const user = rows[0];

    if (user.is_blocked) {
      return res.status(403).json({ message: 'User is blocked' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        is_admin: user.is_admin
      },
      JWT_SECRET,
      { expiresIn: '1h' }
    );


res.json({
  message: 'Login successful',
  token,
  username: user.username,
  email: user.email,
  is_admin: user.is_admin,
  role: user.is_admin === 1 ? 'admin' : 'user',
  isAdmin: user.is_admin === 1
});


  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});




async function logUserAction(userId, action) {
  try {
    await db.query('INSERT INTO user_actions (user_id, action) VALUES (?, ?)', [userId, action]);
  } catch (err) {
    console.error('Failed to log user action:', err);
  }
}



// TASK ROUTE

// Get all tasks for logged-in user
app.get('/tasks', authenticateToken, async (req, res) => {
  try {
    const [tasks] = await db.query('SELECT * FROM tasks WHERE user_id = ?', [req.user.id]);

    if (tasks.length === 0) {
      return res.status(404).json({ message: 'No tasks found' });
    }

    res.json(tasks);
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});


// create/add task
app.post('/tasks', authenticateToken, async (req, res) => {
  try {
    const { title, description, status, due_date } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    await db.query(
      'INSERT INTO tasks (title, description, status, due_date, user_id) VALUES (?, ?, ?, ?, ?)',
      [title, description || '', status || 'To Do', due_date || null, req.user.id]
    );

    await logUserAction(req.user.id, `Created a new task titled "${title}"`);

    res.status(201).json({ message: 'Task created successfully' });

  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// Update task
app.put('/tasks/:id', authenticateToken, async (req, res) => {
  try {
    const { title, description, status, due_date } = req.body;

    if (!title && !description && !status && !due_date) {
      return res.status(400).json({ error: 'At least one field must be provided to update' });
    }

    const [result] = await db.query(
      'UPDATE tasks SET title = ?, description = ?, status = ?, due_date = ? WHERE id = ? AND user_id = ?',
      [title, description, status, due_date, req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Task not found or unauthorized' });
    }

    res.json({ message: 'Task updated successfully' });

  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// Delete task
app.delete('/tasks/:id', authenticateToken, async (req, res) => {
  try {
    const [result] = await db.query(
      'DELETE FROM tasks WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Task not found or unauthorized' });
    }

    res.json({ message: 'Task deleted successfully' });

  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Failed to delete task' });
  }
});


//  ADMIN 


// Middleware to check admin access
function isAdmin(req, res, next) {
  const user = req.user;
  if (!user || user.is_admin !== 1) {
    return res.status(403).json({ message: 'Forbidden: Admins only' });
  }
  next();
}

// Get all users (admin only)
app.get('/admin/users', authenticateToken, isAdmin, async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id, username, email, is_blocked FROM users'
    );

    res.json(users);

  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});


// Block or unblock user (admin only)
app.put('/admin/block/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { block } = req.body;

    if (typeof block !== 'boolean') {
      return res.status(400).json({ error: '`block` must be boolean (true or false)' });
    }

    if (parseInt(req.params.id) === req.user.id) {
      return res.status(400).json({ error: 'You cannot block yourself' });
    }

    const [result] = await db.query(
      'UPDATE users SET is_blocked = ? WHERE id = ?',
      [block, req.params.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    await logUserAction(req.user.id, `${block ? 'Blocked' : 'Unblocked'} user with ID ${req.params.id}`);

    res.json({ message: block ? 'User blocked' : 'User unblocked' });
  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Failed to update user block status' });
  }
});


app.post('/auth/logout', authenticateToken, (req, res) => {
  // Optionally implement token invalidation
  res.json({ message: 'Logged out successfully (client must delete token)' });
});


// Admin: Get app metrics
// app.get('/admin/metrics', authenticateToken, isAdmin, async (req, res) => {
//   try {
//     const [[{ userCount }]] = await db.query('SELECT COUNT(*) AS userCount FROM users');
//     const [[{ taskCount }]] = await db.query('SELECT COUNT(*) AS taskCount FROM tasks');

//     res.json({ userCount, taskCount });
//   } catch (err) {
//     console.error('Failed to fetch metrics:', err);
//     res.status(500).json({ error: 'Failed to fetch app metrics' });
//   }
// });


app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});


