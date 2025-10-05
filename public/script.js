const authSection = document.getElementById('authSection');
const appSection = document.getElementById('appSection');
const tabLogin = document.getElementById('tabLogin');
const tabRegister = document.getElementById('tabRegister');
const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');

const greeting = document.getElementById('greeting');
const streakEl = document.getElementById('streak');
const logoutBtn = document.getElementById('logoutBtn');

const todoForm = document.getElementById('todoForm');
const todosList = document.getElementById('todosList');
const availableMinutes = document.getElementById('availableMinutes');
const applyFilter = document.getElementById('applyFilter');
const sortSelect = document.getElementById('sortSelect');

let todos = [];

function showLogin() {
  tabLogin.classList.add('active');
  tabRegister.classList.remove('active');
  loginForm.classList.remove('hidden');
  registerForm.classList.add('hidden');
}
function showRegister() {
  tabRegister.classList.add('active');
  tabLogin.classList.remove('active');
  registerForm.classList.remove('hidden');
  loginForm.classList.add('hidden');
}
tabLogin.addEventListener('click', showLogin);
tabRegister.addEventListener('click', showRegister);

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const res = await fetch('/api/auth/register', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ name, email, password })
  });
  const data = await res.json();
  if (res.ok) {
    alert('Registered successfully — please login.');
    showLogin();
  } else {
    alert(data.error || 'Registration failed');
  }
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ email, password })
  });
  const data = await res.json();
  if (res.ok) {
    localStorage.setItem('token', data.token);
    await loadApp();
  } else {
    alert(data.error || 'Login failed');
  }
});

logoutBtn.addEventListener('click', () => {
  localStorage.removeItem('token');
  todos = [];
  appSection.classList.add('hidden');
  authSection.classList.remove('hidden');
});

async function loadApp() {
  const token = localStorage.getItem('token');
  if (!token) {
    authSection.classList.remove('hidden');
    appSection.classList.add('hidden');
    return;
  }
  // fetch user
  const meRes = await fetch('/api/user/me', { headers: { Authorization: 'Bearer ' + token } });
  if (!meRes.ok) {
    localStorage.removeItem('token');
    return;
  }
  const user = await meRes.json();
  greeting.textContent = `Hello, ${user.name}`;
  streakEl.textContent = user.streak || 0;

  authSection.classList.add('hidden');
  appSection.classList.remove('hidden');
  await fetchTodos(); 
}

async function fetchTodos() {
  const token = localStorage.getItem('token');
  if (!token) return;
  const available = Number(availableMinutes.value || 0);
  let url = '/api/todos';
  const sort = sortSelect.value;
  const q = new URLSearchParams();
  if (available > 0) q.set('availableMinutes', available);
  if (sort) q.set('sort', sort);
  if ([...q].length) url += '?' + q.toString();

  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!res.ok) {
    if (res.status === 401) {
      alert('Session expired, login again');
      localStorage.removeItem('token');
      location.reload();
    }
    return;
  }
  todos = await res.json();
  renderTodos();
}

function renderTodos() {
  todosList.innerHTML = '';
  if (!todos.length) {
    todosList.innerHTML = '<div class="card">No tasks yet — add one above.</div>';
    return;
  }
  for (const t of todos) {
    const el = document.createElement('div');
    el.className = 'todo-card card';
    el.innerHTML = `
      <h4>${escapeHtml(t.title)}</h4>
      <small>${t.deadline ? 'Due: ' + new Date(t.deadline).toLocaleString() : 'No deadline'}</small>
      <small>Minutes: ${t.requiredMinutes || 0}</small>
      <div class="todo-actions">
        ${t.completed ? '<button class="btn-ghost" disabled>Done</button>' : `<button data-id="${t.id}" class="completeBtn">Complete</button>`}
        <button data-id="${t.id}" class="deleteBtn btn-ghost">Delete</button>
      </div>
    `;
    todosList.appendChild(el);
  }

  // attach listeners
  document.querySelectorAll('.completeBtn').forEach(b => {
    b.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      await fetch(`/api/todos/${id}/complete`, { method: 'PUT', headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } });
      await loadApp();
    });
  });
  document.querySelectorAll('.deleteBtn').forEach(b => {
    b.addEventListener('click', async (e) => {
      if (!confirm('Delete this task?')) return;
      const id = e.target.dataset.id;
      await fetch(`/api/todos/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } });
      await fetchTodos();
    });
  });
}

todoForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('todoTitle').value.trim();
  const deadlineVal = document.getElementById('todoDeadline').value;
  const minutes = Number(document.getElementById('todoMinutes').value || 0);
  if (!title) return alert('Title required');
  const body = { title, requiredMinutes: minutes };
  if (deadlineVal) body.deadline = new Date(deadlineVal).toISOString();
  const res = await fetch('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('token') },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json();
    return alert(err.error || 'Failed to create');
  }
  document.getElementById('todoTitle').value = '';
  document.getElementById('todoDeadline').value = '';
  document.getElementById('todoMinutes').value = '';
  await fetchTodos();
});

applyFilter.addEventListener('click', fetchTodos);
sortSelect.addEventListener('change', fetchTodos);

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// auto-load if token exists
window.addEventListener('load', loadApp);
