require('dotenv').config();

const express = require('express');
const mysql = require('mysql2/promise'); 
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());


const PORT = process.env.PORT || 3000;
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



function isAdmin(req, res, next) {
  if (req.user && req.user.is_admin) {
    return next();
  }
  return res.status(403).json({ message: 'Access denied: admin only' });
}

// AUTH

// SIGNUP
// app.post('/auth/signup', async (req, res) => {
//   const { username, email, password, retype_password } = req.body;

//   if (!username || !email || !password) {
//     return res.status(400).json({ message: 'All fields are required' });
//   }


//   try {
//     const hash = await bcrypt.hash(password, 10);

//     await db.query(
//       'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
//       [username, email, hash]
//     );

//     res.status(201).json({ message: 'User created successfully' });

//   } catch (err) {
//     console.error('Signup error:', err);

//     if (err.code === 'ER_DUP_ENTRY') {
//       res.status(400).json({ message: 'Email already registered' });
//     } else {
//       res.status(500).json({ message: 'Server error' });
//     }
//   }
// });


app.post('/auth/signup', async (req, res) => {
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
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
    const user = rows[0];

    if (!user) {
      return res.status(400).json({ message: 'User not found' });
    }

    if (user.is_blocked) {
      return res.status(403).json({ message: 'User is blocked' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(400).json({ message: 'Wrong password' });
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

    res.json({ token });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

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


// Add task
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


//  ADMIN ROUTES 

// Get all users
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

// Block/unblock user
app.put('/admin/block/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { block } = req.body;

    if (typeof block !== 'boolean') {
      return res.status(400).json({ error: '`block` must be a boolean (true or false)' });
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

    res.json({ message: block ? 'User blocked' : 'User unblocked' });

  } catch (err) {
    console.error('Database error:', err);
    res.status(500).json({ error: 'Failed to update user block status' });
  }
});



app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
































