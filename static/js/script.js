/* Crack My Interview - main frontend script */
(function () {
  'use strict';

  const state = {
    user: null,
    interview: null,
    questions: [],
    currentIndex: 0,
    answers: {},
    timerId: null,
    timeLeft: 60,
    questionSeconds: 60,
    submittingInterview: false,
    categories: [],
    charts: {},
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    bindGlobalUI();
    await refreshSession();
    applyNavState();
    const page = document.body.dataset.page;
    const handlers = {
      home: initHomePage,
      register: initRegisterPage,
      login: initLoginPage,
      dashboard: initDashboardPage,
      profile: initProfilePage,
      'question-bank': initQuestionBankPage,
      'mock-interview': initMockInterviewPage,
      result: initResultPage,
      report: initReportPage,
      admin: initAdminPage,
    };
    if (handlers[page]) {
      try { await handlers[page](); } catch (e) { console.error(e); showToast(e.message || 'Failed to load page.', 'error'); }
    }
  }

  /* ---------------------------
   * Helpers
   * --------------------------- */
  function qs(sel, root = document) { return root.querySelector(sel); }
  function qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }
  function byId(id) { return document.getElementById(id); }
  function setText(el, text) { if (el) el.textContent = text == null ? '' : String(text); }
  function setHTML(el, html) { if (el) el.innerHTML = html; }
  function show(el) { if (el) el.classList.remove('hidden'); }
  function hide(el) { if (el) el.classList.add('hidden'); }
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function formatDate(dt) {
    if (!dt) return '-';
    const d = new Date(String(dt).replace(' ', 'T'));
    if (isNaN(d.getTime())) return String(dt);
    return d.toLocaleString();
  }
  function formatDuration(seconds) {
    if (seconds == null || isNaN(seconds)) return '-';
    const s = Math.max(0, parseInt(seconds, 10));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}m ${r}s`;
  }
  function percentText(val) {
    if (val == null || isNaN(val)) return '0%';
    return `${Number(val).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}%`;
  }
  function badgeClass(type, value) {
    const v = String(value || '').toLowerCase();
    if (type === 'category') {
      if (v === 'hr') return 'badge badge-hr';
      if (v === 'technical') return 'badge badge-technical';
      if (v === 'aptitude') return 'badge badge-aptitude';
      if (v === 'coding') return 'badge badge-coding';
      return 'badge badge-status';
    }
    if (type === 'difficulty') {
      if (v === 'beginner') return 'badge badge-beginner';
      if (v === 'intermediate') return 'badge badge-intermediate';
      if (v === 'advanced') return 'badge badge-advanced';
      return 'badge badge-status';
    }
    return 'badge badge-status';
  }
  function showToast(message, type = 'info') {
    const container = byId('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3500);
  }
  function setLoading(isLoading) {
    const loader = byId('global-loader');
    if (!loader) return;
    loader.classList.toggle('hidden', !isLoading);
  }
  function getQueryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  async function apiRequest(path, options = {}) {
    const opts = { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options };
    if (opts.body && typeof opts.body !== 'string') opts.body = JSON.stringify(opts.body);
    const res = await fetch(path, opts);
    let data = null;
    try { data = await res.json(); } catch (_) { data = null; }
    if (res.status === 401) {
      state.user = null;
      applyNavState();
      if (!path.includes('/api/session') && !path.includes('/api/login') && !path.includes('/api/register') && !path.includes('/api/forgot-password')) {
        showToast((data && data.message) || 'Session expired. Please login.', 'warning');
        setTimeout(() => { window.location.href = '/login'; }, 600);
      }
    }
    if (!res.ok || (data && data.success === false)) {
      const msg = (data && data.message) || `Request failed (${res.status})`;
      const error = new Error(msg);
      error.status = res.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  /* ---------------------------
   * Global UI / navbar / session
   * --------------------------- */
  function bindGlobalUI() {
    const navToggle = byId('navToggle');
    const header = qs('.site-header');
    if (navToggle && header) {
      navToggle.addEventListener('click', () => {
        const open = header.classList.toggle('open');
        navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    }
    document.addEventListener('click', async (e) => {
      const logoutBtn = e.target.closest('#logoutBtn');
      if (logoutBtn) {
        e.preventDefault();
        try {
          await apiRequest('/api/logout', { method: 'POST' });
        } catch (_) { /* ignore */ }
        state.user = null;
        applyNavState();
        window.location.href = '/login';
      }
      const modalClose = e.target.closest('[data-close-modal]');
      if (modalClose) {
        const modalId = modalClose.getAttribute('data-close-modal');
        closeModal(modalId);
      }
      if (e.target.classList && e.target.classList.contains('modal-backdrop')) {
        e.target.classList.remove('show');
      }
    });
  }

  async function refreshSession() {
    try {
      const data = await apiRequest('/api/session', { method: 'GET' });
      state.user = data && data.data && data.data.authenticated ? data.data.user : null;
    } catch (_) {
      state.user = null;
    }
  }

  function applyNavState() {
    const user = state.user;
    const isAuth = !!user;
    const isAdmin = isAuth && user.role === 'admin';
    qsa('.auth-only').forEach(el => { el.style.display = isAuth ? '' : 'none'; });
    qsa('.guest-only').forEach(el => { el.style.display = isAuth ? 'none' : ''; });
    qsa('.admin-only').forEach(el => { el.style.display = isAdmin ? '' : 'none'; });
    const nameEl = qs('#navUserName span');
    if (nameEl) nameEl.textContent = isAuth ? (user.full_name || 'User') : 'User';

    const page = document.body.dataset.page;
    qsa('.nav-links a').forEach(a => {
      const key = a.getAttribute('data-nav');
      const active = (page === 'home' && key === 'home') || key === page;
      a.classList.toggle('active', !!active);
    });
  }

  function openModal(id) { const m = byId(id); if (m) m.classList.add('show'); }
  function closeModal(id) { const m = byId(id); if (m) m.classList.remove('show'); }

  /* ---------------------------
   * Home
   * --------------------------- */
  async function initHomePage() {
    const cta = byId('heroPrimaryCta');
    if (cta) {
      cta.href = state.user ? '/dashboard' : '/register';
      cta.textContent = state.user ? 'Go to Dashboard' : 'Get Started';
    }
    const cta2 = byId('heroSecondaryCta');
    if (cta2) cta2.href = state.user ? '/mock-interview' : '/login';
  }

  /* ---------------------------
   * Register
   * --------------------------- */
  async function initRegisterPage() {
    const form = byId('registerForm');
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = byId('registerMessage');
      if (msg) { msg.textContent = ''; msg.className = 'form-error'; }
      const payload = {
        full_name: byId('full_name').value.trim(),
        email: byId('email').value.trim(),
        password: byId('password').value,
        confirm_password: byId('confirm_password').value,
        phone: byId('phone').value.trim(),
      };
      if (!payload.full_name || !payload.email || !payload.password || !payload.confirm_password) {
        if (msg) msg.textContent = 'Please fill in all required fields.';
        return;
      }
      if (payload.password !== payload.confirm_password) {
        if (msg) msg.textContent = 'Passwords do not match.';
        return;
      }
      const btn = qs('button[type="submit"]', form);
      try {
        if (btn) { btn.disabled = true; btn.textContent = 'Creating account...'; }
        const data = await apiRequest('/api/register', { method: 'POST', body: payload });
        showToast(data.message || 'Registration successful.', 'success');
        if (msg) { msg.className = 'form-hint'; msg.style.color = 'var(--success)'; msg.textContent = 'Account created. Redirecting to login...'; }
        setTimeout(() => { window.location.href = '/login'; }, 1200);
      } catch (err) {
        if (msg) { msg.className = 'form-error'; msg.style.color = 'var(--danger)'; msg.textContent = err.message; }
        showToast(err.message, 'error');
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Create Account'; }
      }
    });
  }

  /* ---------------------------
   * Login & Forgot Password
   * --------------------------- */
  async function initLoginPage() {
    const form = byId('loginForm');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = byId('loginMessage');
        if (msg) msg.textContent = '';
        const payload = {
          email: byId('login_email').value.trim(),
          password: byId('login_password').value,
        };
        const btn = qs('button[type="submit"]', form);
        try {
          if (btn) { btn.disabled = true; btn.textContent = 'Logging in...'; }
          const data = await apiRequest('/api/login', { method: 'POST', body: payload });
          state.user = data.data && data.data.user ? data.data.user : null;
          showToast('Login successful.', 'success');
          const next = getQueryParam('next');
          window.location.href = next && next.startsWith('/') ? next : '/dashboard';
        } catch (err) {
          if (msg) msg.textContent = err.message;
          showToast(err.message, 'error');
        } finally {
          if (btn) { btn.disabled = false; btn.textContent = 'Login'; }
        }
      });
    }
    const forgotLink = byId('forgotPasswordLink');
    if (forgotLink) forgotLink.addEventListener('click', (e) => { e.preventDefault(); openModal('forgotModal'); });
    const forgotForm = byId('forgotPasswordForm');
    if (forgotForm) {
      forgotForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = byId('forgotMessage');
        if (msg) msg.textContent = '';
        const payload = {
          email: byId('forgot_email').value.trim(),
          new_password: byId('forgot_new_password').value,
          confirm_password: byId('forgot_confirm_password').value,
        };
        if (payload.new_password !== payload.confirm_password) {
          if (msg) msg.textContent = 'Passwords do not match.';
          return;
        }
        try {
          const data = await apiRequest('/api/forgot-password', { method: 'POST', body: payload });
          showToast(data.message || 'Password reset successful.', 'success');
          if (msg) { msg.style.color = 'var(--success)'; msg.textContent = data.message; }
          setTimeout(() => { closeModal('forgotModal'); forgotForm.reset(); if (msg) { msg.textContent=''; msg.style.color=''; } }, 1200);
        } catch (err) {
          if (msg) { msg.style.color = 'var(--danger)'; msg.textContent = err.message; }
          showToast(err.message, 'error');
        }
      });
    }
  }

  /* ---------------------------
   * Dashboard
   * --------------------------- */
  async function initDashboardPage() {
    const welcome = byId('welcomeName');
    if (welcome && state.user) welcome.textContent = state.user.full_name || 'User';
    setLoading(true);
    try {
      const [perfRes, histRes] = await Promise.all([
        apiRequest('/api/performance'),
        apiRequest('/api/interviews/history'),
      ]);
      const perf = (perfRes.data && perfRes.data.summary) || {};
      setText(byId('statTotalInterviews'), perf.total_interviews ?? 0);
      setText(byId('statAverageScore'), percentText(perf.average_score ?? 0));
      setText(byId('statHighestScore'), percentText(perf.highest_score ?? 0));
      setText(byId('statImprovement'), perf.improvement || 'Baseline');
      const history = (histRes.data && histRes.data.history) || [];
      renderDashboardRecent(history);
      renderDashboardTip(perf, history);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  function renderDashboardRecent(history) {
    const body = byId('recentInterviewsBody');
    const empty = byId('recentInterviewsEmpty');
    if (!body) return;
    const rows = history.slice(0, 5);
    if (!rows.length) {
      body.innerHTML = '';
      if (empty) empty.classList.remove('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');
    body.innerHTML = rows.map(r => `
      <tr>
        <td data-label="Date">${escapeHtml(formatDate(r.completed_at || r.started_at))}</td>
        <td data-label="Category">${escapeHtml(r.category_name || '-')}</td>
        <td data-label="Difficulty">${escapeHtml(r.difficulty_level || '-')}</td>
        <td data-label="Score">${escapeHtml(percentText(r.percentage))}</td>
        <td data-label="Action"><a class="btn btn-sm btn-outline" href="/result?id=${encodeURIComponent(r.interview_id)}">View</a></td>
      </tr>`).join('');
  }

  function renderDashboardTip(perf, history) {
    const tip = byId('dashboardTip');
    if (!tip) return;
    if (!history.length) {
      tip.textContent = 'Start your first mock interview to receive personalized feedback and performance insights.';
      return;
    }
    if (perf.weakest_category) {
      tip.textContent = `Focus area: ${perf.weakest_category}. Practice more questions in this category to improve your overall score.`;
    } else if (perf.strongest_category) {
      tip.textContent = `Strongest category so far: ${perf.strongest_category}. Keep practicing to build consistency across all categories.`;
    } else {
      tip.textContent = 'Keep taking mock interviews to identify strengths and weaknesses.';
    }
  }

  /* ---------------------------
   * Profile
   * --------------------------- */
  async function initProfilePage() {
    setLoading(true);
    try {
      const data = await apiRequest('/api/profile');
      const user = data.data && data.data.user;
      if (!user) throw new Error('Profile not found');
      state.user = { ...(state.user || {}), ...user };
      applyNavState();
      setText(byId('profileName'), user.full_name || '-');
      setText(byId('profileEmail'), user.email || '-');
      setText(byId('profileRole'), user.role || 'student');
      setText(byId('profilePhone'), user.phone || 'Not provided');
      setText(byId('profileCreated'), formatDate(user.created_at));
      setText(byId('profileAvatar'), (user.full_name || 'U').trim().charAt(0).toUpperCase());
      if (byId('full_name')) byId('full_name').value = user.full_name || '';
      if (byId('phone')) byId('phone').value = user.phone || '';
      if (byId('email')) byId('email').value = user.email || '';
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }

    const profileForm = byId('profileForm');
    if (profileForm) {
      profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msg = byId('profileMessage');
        if (msg) msg.textContent = '';
        const payload = {
          full_name: byId('full_name').value.trim(),
          phone: byId('phone').value.trim(),
          current_password: byId('current_password').value,
          new_password: byId('new_password').value,
          confirm_new_password: byId('confirm_new_password').value,
        };
        try {
          const data = await apiRequest('/api/profile', { method: 'PUT', body: payload });
          showToast(data.message || 'Profile updated.', 'success');
          if (msg) { msg.style.color = 'var(--success)'; msg.textContent = data.message; }
          ['current_password','new_password','confirm_new_password'].forEach(id => { if (byId(id)) byId(id).value = ''; });
          await refreshSession(); applyNavState(); await initProfilePage();
        } catch (err) {
          if (msg) { msg.style.color = 'var(--danger)'; msg.textContent = err.message; }
          showToast(err.message, 'error');
        }
      });
    }

    const logoutBtn = byId('profileLogoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', async () => {
      try { await apiRequest('/api/logout', { method: 'POST' }); } catch (_) {}
      state.user = null; applyNavState(); window.location.href = '/login';
    });
  }

  /* ---------------------------
   * Question Bank (+ admin actions visible to admin)
   * --------------------------- */
  async function initQuestionBankPage() {
    await loadCategoriesIntoSelect(byId('qbCategoryFilter'), true);
    await loadQuestionBank();
    ['qbCategoryFilter','qbDifficultyFilter'].forEach(id => {
      const el = byId(id);
      if (el) el.addEventListener('change', loadQuestionBank);
    });
    const reset = byId('qbResetBtn');
    if (reset) reset.addEventListener('click', () => {
      if (byId('qbCategoryFilter')) byId('qbCategoryFilter').value = '';
      if (byId('qbDifficultyFilter')) byId('qbDifficultyFilter').value = '';
      loadQuestionBank();
    });

    if (state.user && state.user.role === 'admin') {
      show(byId('qbAdminActions'));
      await loadCategoriesIntoSelect(byId('qFormCategory'), false);
      bindQuestionForm('qb');
    }
  }

  async function loadQuestionBank() {
    const category = byId('qbCategoryFilter') ? byId('qbCategoryFilter').value : '';
    const difficulty = byId('qbDifficultyFilter') ? byId('qbDifficultyFilter').value : '';
    const params = new URLSearchParams();
    if (category) params.set('category_id', category);
    if (difficulty) params.set('difficulty_level', difficulty);
    const list = byId('questionBankList');
    const countEl = byId('questionCount');
    if (list) list.innerHTML = '<div class="empty-state">Loading questions...</div>';
    try {
      const data = await apiRequest('/api/questions' + (params.toString() ? `?${params.toString()}` : ''));
      const questions = (data.data && data.data.questions) || [];
      if (countEl) countEl.textContent = `${questions.length} question${questions.length === 1 ? '' : 's'}`;
      renderQuestionBankList(questions);
    } catch (err) {
      if (list) list.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    }
  }

  function renderQuestionBankList(questions) {
    const list = byId('questionBankList');
    if (!list) return;
    if (!questions.length) {
      list.innerHTML = '<div class="empty-state"><i class="fa-regular fa-folder-open"></i><p>No questions found for the selected filters.</p></div>';
      return;
    }
    const grouped = {};
    questions.forEach(q => {
      const key = q.category_name || 'Other';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(q);
    });
    const isAdmin = state.user && state.user.role === 'admin';
    list.innerHTML = Object.keys(grouped).map(cat => `
      <section class="section-block">
        <div class="flex-between mb-1"><h3>${escapeHtml(cat)}</h3><span class="muted">${grouped[cat].length} question(s)</span></div>
        <div class="grid grid-2">
          ${grouped[cat].map(q => `
            <article class="card question-card">
              <div class="question-meta">
                <span class="${badgeClass('category', q.category_name)}">${escapeHtml(q.category_name)}</span>
                <span class="${badgeClass('difficulty', q.difficulty_level)}">${escapeHtml(q.difficulty_level)}</span>
                <span class="badge badge-status">${escapeHtml(q.marks)} mark(s)</span>
              </div>
              <p><strong>Q.</strong> ${escapeHtml(q.question_text)}</p>
              <ol class="options-list" type="A">
                <li>${escapeHtml(q.option_a)}</li>
                <li>${escapeHtml(q.option_b)}</li>
                <li>${escapeHtml(q.option_c)}</li>
                <li>${escapeHtml(q.option_d)}</li>
              </ol>
              <div class="mt-1 flex gap-1 flex-wrap">
                <button class="btn btn-sm btn-outline" data-toggle-answer="${q.question_id}">Show Answer</button>
                ${isAdmin ? `<button class="btn btn-sm btn-secondary" data-edit-question='${escapeHtml(JSON.stringify(q))}'>Edit</button>
                <button class="btn btn-sm btn-danger" data-delete-question="${q.question_id}">Delete</button>` : ''}
              </div>
              <div id="answer-${q.question_id}" class="answer-reveal hidden">
                <p><strong>Correct Answer:</strong> ${escapeHtml(q.correct_answer)} - ${escapeHtml(optionText(q, q.correct_answer))}</p>
                <p class="mb-1"><strong>Explanation:</strong> ${escapeHtml(q.explanation || 'No explanation provided.')}</p>
              </div>
            </article>`).join('')}
        </div>
      </section>`).join('');

    qsa('[data-toggle-answer]', list).forEach(btn => btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-toggle-answer');
      const box = byId(`answer-${id}`);
      if (!box) return;
      const hidden = box.classList.toggle('hidden');
      btn.textContent = hidden ? 'Show Answer' : 'Hide Answer';
    }));
    if (isAdmin) {
      qsa('[data-edit-question]', list).forEach(btn => btn.addEventListener('click', () => {
        const q = JSON.parse(btn.getAttribute('data-edit-question'));
        fillQuestionForm('qb', q);
        openModal('qbQuestionModal');
      }));
      qsa('[data-delete-question]', list).forEach(btn => btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-delete-question');
        if (!confirm('Delete this question?')) return;
        try {
          await apiRequest(`/api/questions/${id}`, { method: 'DELETE' });
          showToast('Question deleted.', 'success');
          await loadQuestionBank();
        } catch (err) { showToast(err.message, 'error'); }
      }));
    }
  }

  function optionText(q, ans) {
    const a = String(ans || '').toUpperCase();
    if (a === 'A') return q.option_a || '';
    if (a === 'B') return q.option_b || '';
    if (a === 'C') return q.option_c || '';
    if (a === 'D') return q.option_d || '';
    return ans || '';
  }

  async function loadCategoriesIntoSelect(selectEl, includeAll = false) {
    if (!selectEl) return;
    try {
      const data = await apiRequest('/api/categories');
      const cats = (data.data && data.data.categories) || [];
      state.categories = cats;
      const opts = [`${includeAll ? '<option value="">All Categories</option>' : '<option value="">Select Category</option>'}`]
        .concat(cats.map(c => `<option value="${c.category_id}">${escapeHtml(c.category_name)}</option>`));
      selectEl.innerHTML = opts.join('');
    } catch (err) {
      selectEl.innerHTML = `<option value="">Failed to load categories</option>`;
    }
  }

  function bindQuestionForm(prefix) {
    const addBtn = byId(`${prefix}AddQuestionBtn`);
    const form = byId(`${prefix}QuestionForm`);
    if (addBtn) addBtn.addEventListener('click', () => { resetQuestionForm(prefix); openModal(`${prefix}QuestionModal`); });
    if (form) form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = byId(`${prefix}QuestionId`).value;
      const payload = {
        category_id: byId(`${prefix}QCategory`).value,
        question_text: byId(`${prefix}QText`).value.trim(),
        option_a: byId(`${prefix}QOptionA`).value.trim(),
        option_b: byId(`${prefix}QOptionB`).value.trim(),
        option_c: byId(`${prefix}QOptionC`).value.trim(),
        option_d: byId(`${prefix}QOptionD`).value.trim(),
        correct_answer: byId(`${prefix}QCorrect`).value,
        explanation: byId(`${prefix}QExplanation`).value.trim(),
        difficulty_level: byId(`${prefix}QDifficulty`).value,
        marks: byId(`${prefix}QMarks`).value || 1,
      };
      try {
        if (id) await apiRequest(`/api/questions/${id}`, { method: 'PUT', body: payload });
        else await apiRequest('/api/questions', { method: 'POST', body: payload });
        showToast(id ? 'Question updated.' : 'Question added.', 'success');
        closeModal(`${prefix}QuestionModal`);
        resetQuestionForm(prefix);
        if (prefix === 'qb') await loadQuestionBank();
        if (prefix === 'admin') await loadAdminQuestions();
      } catch (err) { showToast(err.message, 'error'); }
    });
  }
  function fillQuestionForm(prefix, q) {
    setText(byId(`${prefix}QuestionModalTitle`), 'Edit Question');
    byId(`${prefix}QuestionId`).value = q.question_id;
    byId(`${prefix}QCategory`).value = q.category_id;
    byId(`${prefix}QText`).value = q.question_text || '';
    byId(`${prefix}QOptionA`).value = q.option_a || '';
    byId(`${prefix}QOptionB`).value = q.option_b || '';
    byId(`${prefix}QOptionC`).value = q.option_c || '';
    byId(`${prefix}QOptionD`).value = q.option_d || '';
    byId(`${prefix}QCorrect`).value = (q.correct_answer || 'A').toUpperCase();
    byId(`${prefix}QExplanation`).value = q.explanation || '';
    byId(`${prefix}QDifficulty`).value = q.difficulty_level || 'Beginner';
    byId(`${prefix}QMarks`).value = q.marks || 1;
  }
  function resetQuestionForm(prefix) {
    setText(byId(`${prefix}QuestionModalTitle`), 'Add Question');
    const form = byId(`${prefix}QuestionForm`);
    if (form) form.reset();
    if (byId(`${prefix}QuestionId`)) byId(`${prefix}QuestionId`).value = '';
    if (byId(`${prefix}QMarks`)) byId(`${prefix}QMarks`).value = 1;
  }

  /* ---------------------------
   * Mock Interview
   * --------------------------- */
  async function initMockInterviewPage() {
    await loadCategoriesIntoSelect(byId('miCategory'), false);
    showView('setup');
    const startForm = byId('mockSetupForm');
    if (startForm) startForm.addEventListener('submit', startMockInterview);
    const nextBtn = byId('nextQuestionBtn');
    if (nextBtn) nextBtn.addEventListener('click', () => handleNextQuestion(false));
    const submitBtn = byId('submitInterviewBtn');
    if (submitBtn) submitBtn.addEventListener('click', submitMockInterview);
  }

  function showView(which) {
    ['setupView','interviewView','completeView'].forEach(id => hide(byId(id)));
    if (which === 'setup') show(byId('setupView'));
    if (which === 'interview') show(byId('interviewView'));
    if (which === 'complete') show(byId('completeView'));
  }

  async function startMockInterview(e) {
    e.preventDefault();
    const category_id = byId('miCategory').value;
    const difficulty_level = byId('miDifficulty').value;
    const total_questions = byId('miCount').value;
    const msg = byId('mockSetupMessage');
    if (msg) msg.textContent = '';
    if (!category_id || !difficulty_level || !total_questions) {
      if (msg) msg.textContent = 'Please select category, difficulty, and question count.';
      return;
    }
    setLoading(true);
    try {
      const data = await apiRequest('/api/interviews/start', { method: 'POST', body: { category_id, difficulty_level, total_questions } });
      const d = data.data || {};
      state.interview = d.interview;
      state.questions = d.questions || [];
      state.currentIndex = 0;
      state.answers = {};
      state.questionSeconds = (d.interview && d.interview.seconds_per_question) || 60;
      state.submittingInterview = false;
      if (d.warning) showToast(d.warning, 'warning');
      showView('interview');
      renderCurrentQuestion();
      startTimer();
    } catch (err) {
      if (msg) msg.textContent = err.message;
      showToast(err.message, 'error');
    } finally { setLoading(false); }
  }

  function renderCurrentQuestion() {
    const q = state.questions[state.currentIndex];
    if (!q) return;
    setText(byId('miQuestionCounter'), `Question ${state.currentIndex + 1} of ${state.questions.length}`);
    setText(byId('miQuestionText'), q.question_text);
    setText(byId('miCategoryBadge'), state.interview ? state.interview.category_name : '');
    setText(byId('miDifficultyBadge'), state.interview ? state.interview.difficulty_level : '');
    const pct = ((state.currentIndex) / state.questions.length) * 100;
    const fill = byId('miProgressFill');
    if (fill) fill.style.width = `${pct}%`;
    const optionsWrap = byId('miOptions');
    const saved = state.answers[q.question_id] || null;
    if (optionsWrap) {
      const opts = [
        { key: 'A', text: q.option_a }, { key: 'B', text: q.option_b },
        { key: 'C', text: q.option_c }, { key: 'D', text: q.option_d },
      ];
      optionsWrap.innerHTML = opts.map(o => `
        <label class="option-item ${saved === o.key ? 'selected' : ''}" data-key="${o.key}">
          <input type="radio" name="mi_option" value="${o.key}" ${saved === o.key ? 'checked' : ''}>
          <div><strong>${o.key}.</strong> ${escapeHtml(o.text)}</div>
        </label>`).join('');
      qsa('.option-item', optionsWrap).forEach(item => item.addEventListener('click', (e) => {
        const key = item.getAttribute('data-key');
        const radio = qs('input[type="radio"]', item);
        if (radio) radio.checked = true;
        state.answers[q.question_id] = key;
        qsa('.option-item', optionsWrap).forEach(i => i.classList.toggle('selected', i === item));
      }));
    }
    const nextBtn = byId('nextQuestionBtn');
    if (nextBtn) nextBtn.textContent = (state.currentIndex === state.questions.length - 1) ? 'Finish Interview' : 'Next Question';
  }

  function startTimer() {
    clearInterval(state.timerId);
    state.timeLeft = state.questionSeconds;
    updateTimerUI();
    state.timerId = setInterval(() => {
      state.timeLeft -= 1;
      updateTimerUI();
      if (state.timeLeft <= 0) {
        clearInterval(state.timerId);
        handleTimeout();
      }
    }, 1000);
  }
  function updateTimerUI() {
    const chip = byId('miTimer');
    const text = byId('miTimerText');
    if (text) text.textContent = `${state.timeLeft}s`;
    if (chip) {
      chip.classList.toggle('warn', state.timeLeft <= 30 && state.timeLeft > 10);
      chip.classList.toggle('danger', state.timeLeft <= 10);
    }
  }
  function handleTimeout() {
    // auto move on timeout as unanswered (if not selected, keep null)
    const q = state.questions[state.currentIndex];
    if (q && !state.answers.hasOwnProperty(q.question_id)) state.answers[q.question_id] = null;
    showToast('Time up! Moving to next question.', 'warning');
    setTimeout(() => handleNextQuestion(true), 400);
  }
  function handleNextQuestion(fromTimeout) {
    clearInterval(state.timerId);
    const q = state.questions[state.currentIndex];
    if (q) {
      const selected = qs('input[name="mi_option"]:checked');
      if (selected) state.answers[q.question_id] = selected.value;
      else if (!state.answers.hasOwnProperty(q.question_id)) state.answers[q.question_id] = null;
    }
    if (state.currentIndex < state.questions.length - 1) {
      state.currentIndex += 1;
      renderCurrentQuestion();
      startTimer();
    } else {
      finishInterviewView();
    }
  }
  function finishInterviewView() {
    clearInterval(state.timerId);
    const total = state.questions.length;
    let answered = 0;
    state.questions.forEach(q => { const a = state.answers[q.question_id]; if (a !== null && a !== undefined && a !== '') answered++; });
    setText(byId('completeAnswered'), `${answered} / ${total}`);
    setText(byId('completeUnanswered'), `${total - answered}`);
    const fill = byId('miProgressFill');
    if (fill) fill.style.width = '100%';
    showView('complete');
  }

  async function submitMockInterview() {
    if (state.submittingInterview) return;
    if (!state.interview) { showToast('No active interview found.', 'error'); return; }
    state.submittingInterview = true;
    const btn = byId('submitInterviewBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Submitting...'; }
    setLoading(true);
    try {
      const answers = state.questions.map(q => ({ question_id: q.question_id, user_answer: state.answers.hasOwnProperty(q.question_id) ? state.answers[q.question_id] : null }));
      const data = await apiRequest('/api/interviews/submit', { method: 'POST', body: { interview_id: state.interview.interview_id, answers } });
      showToast('Interview submitted successfully.', 'success');
      const id = data.data && (data.data.evaluation_id || data.data.interview_id);
      window.location.href = `/result?id=${encodeURIComponent(id || state.interview.interview_id)}`;
    } catch (err) {
      showToast(err.message, 'error');
      state.submittingInterview = false;
      if (btn) { btn.disabled = false; btn.textContent = 'Submit for Evaluation'; }
    } finally { setLoading(false); }
  }

  /* ---------------------------
   * Result / Evaluation
   * --------------------------- */
  async function initResultPage() {
    const id = getQueryParam('id');
    if (!id) { showToast('Result id is missing.', 'error'); return; }
    setLoading(true);
    try {
      const data = await apiRequest(`/api/evaluation/${encodeURIComponent(id)}`);
      renderEvaluation(data.data);
    } catch (err) {
      showToast(err.message, 'error');
      const root = byId('resultRoot');
      if (root) root.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
    } finally { setLoading(false); }
  }

  function renderEvaluation(data) {
    if (!data) return;
    const interview = data.interview || {};
    const answers = data.answers || [];
    const feedback = data.feedback || {};
    setText(byId('resultCategory'), interview.category_name || '-');
    setText(byId('resultDifficulty'), interview.difficulty_level || '-');
    setText(byId('resultScoreLine'), `You scored ${interview.total_score ?? interview.correct_answers ?? 0} marks (${percentText(interview.percentage)})`);
    setText(byId('resultMeta'), `Date: ${formatDate(interview.completed_at || interview.started_at)} | Duration: ${formatDuration(interview.duration)}`);
    const pct = Number(interview.percentage || 0);
    const ring = byId('scoreRing');
    if (ring) ring.style.background = `conic-gradient(var(--orange-500) ${pct * 3.6}deg, var(--gray-200) 0deg)`;
    setText(byId('scoreRingText'), percentText(pct));

    const correct = feedback.correct_count != null ? feedback.correct_count : answers.filter(a => a.status === 'Correct').length;
    const incorrect = feedback.incorrect_count != null ? feedback.incorrect_count : answers.filter(a => a.status === 'Incorrect').length;
    const unanswered = feedback.unanswered_count != null ? feedback.unanswered_count : answers.filter(a => a.status === 'Unanswered').length;
    setText(byId('resCorrectCount'), correct);
    setText(byId('resIncorrectCount'), incorrect);
    setText(byId('resUnansweredCount'), unanswered);
    setText(byId('feedbackStrengths'), feedback.strengths || 'No strengths data available.');
    setText(byId('feedbackWeaknesses'), feedback.weaknesses || 'No weaknesses data available.');
    setText(byId('feedbackSuggestions'), feedback.suggestions || 'No suggestions available.');

    const review = byId('answerReviewList');
    if (review) {
      if (!answers.length) review.innerHTML = '<div class="empty-state">No answers available for this interview.</div>';
      else review.innerHTML = answers.map((a, idx) => {
        const statusClass = a.status === 'Correct' ? 'correct' : (a.status === 'Incorrect' ? 'incorrect' : 'unanswered');
        return `<div class="review-item ${statusClass}">
          <div class="review-head">
            <div><strong>Q${idx + 1}.</strong> ${escapeHtml(a.question_text)}</div>
            <span class="badge ${a.status === 'Correct' ? 'badge-success' : a.status === 'Incorrect' ? 'badge-danger' : 'badge-warning'}">${escapeHtml(a.status)}</span>
          </div>
          <div class="answer-compare">
            <div class="answer-box"><strong>Your Answer</strong><div>${escapeHtml(a.user_answer ? `${a.user_answer} - ${a.user_answer_text || ''}` : 'Not answered')}</div></div>
            <div class="answer-box"><strong>Correct Answer</strong><div>${escapeHtml(a.correct_answer)} - ${escapeHtml(a.correct_answer_text || '')}</div></div>
          </div>
          <div class="mt-1"><strong>Explanation:</strong> ${escapeHtml(a.explanation || 'No explanation provided.')}</div>
        </div>`;
      }).join('');
    }

    if (window.Chart && byId('resultChart')) {
      const ctx = byId('resultChart').getContext('2d');
      if (state.charts.result) state.charts.result.destroy();
      state.charts.result = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Correct', 'Incorrect', 'Unanswered'],
          datasets: [{ data: [correct, incorrect, unanswered], backgroundColor: ['#16a34a', '#dc2626', '#f59e0b'] }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
      });
    }
  }

  /* ---------------------------
   * Report
   * --------------------------- */
  async function initReportPage() {
    setLoading(true);
    try {
      const [perfRes, histRes] = await Promise.all([
        apiRequest('/api/performance'),
        apiRequest('/api/interviews/history'),
      ]);
      const perf = perfRes.data || {};
      const summary = perf.summary || {};
      const history = (histRes.data && histRes.data.history) || [];
      setText(byId('repTotalInterviews'), summary.total_interviews ?? 0);
      setText(byId('repAverageScore'), percentText(summary.average_score ?? 0));
      setText(byId('repHighestScore'), percentText(summary.highest_score ?? 0));
      setText(byId('repImprovement'), summary.improvement || 'Baseline');
      setText(byId('repStrongest'), summary.strongest_category || 'N/A');
      setText(byId('repWeakest'), summary.weakest_category || 'N/A');
      renderHistoryTable(history);
      renderTrendChart(perf.trend || []);
      renderCategoryChart(perf.category_averages || []);
    } catch (err) {
      showToast(err.message, 'error');
    } finally { setLoading(false); }
    const printBtn = byId('downloadReportBtn');
    if (printBtn) printBtn.addEventListener('click', () => window.print());
  }

  function renderHistoryTable(history) {
    const body = byId('historyTableBody');
    const empty = byId('historyEmpty');
    if (!body) return;
    if (!history.length) {
      body.innerHTML = '';
      if (empty) empty.classList.remove('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');
    body.innerHTML = history.map(r => `
      <tr>
        <td data-label="Date">${escapeHtml(formatDate(r.completed_at || r.started_at))}</td>
        <td data-label="Category">${escapeHtml(r.category_name || '-')}</td>
        <td data-label="Difficulty">${escapeHtml(r.difficulty_level || '-')}</td>
        <td data-label="Questions">${escapeHtml(r.total_questions ?? '-')}</td>
        <td data-label="Score">${escapeHtml(percentText(r.percentage))}</td>
        <td data-label="Duration">${escapeHtml(formatDuration(r.duration))}</td>
        <td data-label="Status">${escapeHtml(r.status || '-')}</td>
        <td data-label="Actions" class="no-print">
          <a class="btn btn-sm btn-outline" href="/result?id=${encodeURIComponent(r.interview_id)}">View</a>
        </td>
      </tr>`).join('');
  }

  function renderTrendChart(trend) {
    if (!window.Chart || !byId('trendChart')) return;
    const ctx = byId('trendChart').getContext('2d');
    if (state.charts.trend) state.charts.trend.destroy();
    const labels = trend.map(t => t.label || `#${t.interview_id}`);
    const data = trend.map(t => t.percentage || 0);
    state.charts.trend = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{ label: 'Score %', data, borderColor: '#1f4da8', backgroundColor: 'rgba(31,77,168,0.15)', tension: 0.25, fill: true, pointBackgroundColor: '#ff7a00' }]
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } } }
    });
  }
  function renderCategoryChart(catAvgs) {
    if (!window.Chart || !byId('categoryChart')) return;
    const ctx = byId('categoryChart').getContext('2d');
    if (state.charts.category) state.charts.category.destroy();
    state.charts.category = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: catAvgs.map(c => c.category_name),
        datasets: [{ label: 'Average Score %', data: catAvgs.map(c => c.average_percentage), backgroundColor: ['#1f4da8', '#5b34c9', '#0f7b5a', '#c25a00'] }]
      },
      options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, max: 100 } } }
    });
  }

  /* ---------------------------
   * Admin page
   * --------------------------- */
  async function initAdminPage() {
    await loadCategoriesIntoSelect(byId('adminQCategory'), false);
    await loadAdminQuestions();
    bindQuestionForm('admin');
    const refreshBtn = byId('adminRefreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', loadAdminQuestions);
  }
  async function loadAdminQuestions() {
    const body = byId('adminQuestionsBody');
    if (body) body.innerHTML = '<tr><td colspan="7">Loading...</td></tr>';
    try {
      const data = await apiRequest('/api/questions');
      const questions = (data.data && data.data.questions) || [];
      renderAdminQuestions(questions);
    } catch (err) {
      if (body) body.innerHTML = `<tr><td colspan="7" class="form-error">${escapeHtml(err.message)}</td></tr>`;
    }
  }
  function renderAdminQuestions(questions) {
    const body = byId('adminQuestionsBody');
    if (!body) return;
    if (!questions.length) { body.innerHTML = '<tr><td colspan="7">No questions found.</td></tr>'; return; }
    body.innerHTML = questions.map(q => `
      <tr>
        <td data-label="ID">${q.question_id}</td>
        <td data-label="Category">${escapeHtml(q.category_name)}</td>
        <td data-label="Difficulty">${escapeHtml(q.difficulty_level)}</td>
        <td data-label="Question">${escapeHtml(q.question_text)}</td>
        <td data-label="Correct">${escapeHtml(q.correct_answer)}</td>
        <td data-label="Marks">${escapeHtml(q.marks)}</td>
        <td data-label="Actions">
          <div class="admin-actions">
            <button class="btn btn-sm btn-secondary" data-admin-edit='${escapeHtml(JSON.stringify(q))}'>Edit</button>
            <button class="btn btn-sm btn-danger" data-admin-delete="${q.question_id}">Delete</button>
          </div>
        </td>
      </tr>`).join('');
    qsa('[data-admin-edit]', body).forEach(btn => btn.addEventListener('click', () => {
      const q = JSON.parse(btn.getAttribute('data-admin-edit'));
      fillQuestionForm('admin', q);
      openModal('adminQuestionModal');
    }));
    qsa('[data-admin-delete]', body).forEach(btn => btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-admin-delete');
      if (!confirm('Delete this question?')) return;
      try {
        await apiRequest(`/api/questions/${id}`, { method: 'DELETE' });
        showToast('Question deleted.', 'success');
        await loadAdminQuestions();
      } catch (err) { showToast(err.message, 'error'); }
    }));
  }
})();
