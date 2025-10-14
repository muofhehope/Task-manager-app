const API_BASE = 'http://localhost:300';

// DASHBOARD
const token = localStorage.getItem('token');
const taskList = document.getElementById('taskList');

if (taskList) {
  if (!token) {
    alert('Not logged in');
    window.location.href = 'login.html';
  } else {
    fetch(`${API_BASE}/tasks`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(res => res.json())
    .then(data => {
      if (Array.isArray(data)) {
        taskList.innerHTML = '';
        data.forEach(task => {
          const li = document.createElement('li');
          li.textContent = `${task.title} - ${task.status}`;
          taskList.appendChild(li);
        });
      } else {
        taskList.innerHTML = `<li>${data.message || 'No tasks found'}</li>`;
      }
    })
    .catch(err => {
      console.error(err);
      taskList.innerHTML = `<li>Error loading tasks</li>`;
    });
  }
}

// ADD TASK
const taskForm = document.getElementById('taskForm');
if (taskForm) {
  taskForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('taskTitle').value;
    const description = document.getElementById('taskDescription').value;
    const due_date = document.getElementById('dueDate').value;

    const res = await fetch(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title, description, due_date })
    });

    const data = await res.json();
    if (res.ok) {
      alert('Task added!');
      window.location.reload();
    } else {
      alert(data.error || 'Failed to add task');
    }
  });
}

// LOGOUT
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    localStorage.removeItem('token');
    window.location.href = 'login.html';
  });
}
