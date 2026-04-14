const signupForm = document.querySelector('#signup-form');
const loginForm = document.querySelector('#login-form');
const adminStatus = document.querySelector('#admin-status');
const adminHeading = document.querySelector('#admin-heading');
const adminDescription = document.querySelector('#admin-description');
const adminActions = document.querySelector('#admin-actions');
const adminWelcome = document.querySelector('#admin-welcome');
const adminReviewList = document.querySelector('#admin-review-list');
const logoutButton = document.querySelector('#logout-button');
const storageKeys = {
  reviews: 'somesh-blog-reviews',
  admin: 'somesh-blog-admin',
  session: 'somesh-blog-admin-session'
};

let useLocalMode = window.location.protocol === 'file:' || window.location.hostname.endsWith('github.io');

function formatDate(value) {
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getStoredAdmin() {
  return readJson(storageKeys.admin, null);
}

function getStoredReviews() {
  return readJson(storageKeys.reviews, []);
}

function saveStoredReviews(reviews) {
  writeJson(storageKeys.reviews, reviews);
}

function getSession() {
  return sessionStorage.getItem(storageKeys.session) || '';
}

function setSession(username) {
  sessionStorage.setItem(storageKeys.session, username);
}

function clearSession() {
  sessionStorage.removeItem(storageKeys.session);
}

function setLoggedInState(username) {
  signupForm.classList.add('hidden-block');
  loginForm.classList.add('hidden-block');
  adminActions.classList.remove('hidden-block');
  adminHeading.textContent = 'Admin dashboard';
  adminDescription.textContent = useLocalMode
    ? 'Static mode is active. Admin and reviews are stored only in this browser.'
    : 'Review new feedback, reply to visitors, and remove unwanted messages.';
  adminWelcome.textContent = `Logged in as ${username}`;
}

function setSignupState() {
  signupForm.classList.remove('hidden-block');
  loginForm.classList.add('hidden-block');
  adminActions.classList.add('hidden-block');
  adminHeading.textContent = 'Create your admin account';
  adminDescription.textContent = 'Sign up once to manage reviews, delete spam, and reply to visitors.';
}

function setLoginState() {
  signupForm.classList.add('hidden-block');
  loginForm.classList.remove('hidden-block');
  adminActions.classList.add('hidden-block');
  adminHeading.textContent = 'Admin login';
  adminDescription.textContent = 'Use your admin account to control review replies and deletions.';
}

function renderAdminReviews(reviews, loggedIn = false) {
  if (!reviews.length) {
    adminReviewList.innerHTML = `
      <article class="review-card">
        <strong>${loggedIn ? 'No reviews yet' : 'Login required'}</strong>
        <p>${loggedIn ? 'New visitor reviews will appear here for you to manage.' : 'Log in to manage reviews from this dashboard.'}</p>
      </article>
    `;
    return;
  }

  adminReviewList.innerHTML = reviews.map(review => `
    <article class="review-card" data-review-id="${review.id}">
      <div class="review-meta">
        <strong>${escapeHtml(review.name)}</strong>
        <span class="stars">${'&#9733;'.repeat(review.rating)}${'&#9734;'.repeat(5 - review.rating)}</span>
      </div>
      <p>${escapeHtml(review.message)}</p>
      <small>${formatDate(review.createdAt)}</small>
      ${review.reply ? `
        <div class="review-reply">
          <strong>Your reply</strong>
          <p>${escapeHtml(review.reply.text)}</p>
        </div>
      ` : ''}
      <form class="reply-form review-form">
        <label>
          Reply to this review
          <textarea name="reply" rows="3" maxlength="300" placeholder="Write your reply here...">${review.reply ? escapeHtml(review.reply.text) : ''}</textarea>
        </label>
        <div class="review-actions">
          <button class="button primary" type="submit">Save Reply</button>
          <button class="button danger delete-review" type="button">Delete Review</button>
        </div>
      </form>
    </article>
  `).join('');
}

async function fetchJson(url, options = {}) {
  const hasBody = Object.prototype.hasOwnProperty.call(options, 'body');
  const headers = { ...(options.headers || {}) };
  if (hasBody) headers['Content-Type'] = 'application/json';

  const response = await fetch(url, { ...options, headers });
  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('Static host detected');
  }

  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function sortReviews(reviews) {
  return [...reviews].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function loadLocalAdminReviews() {
  const username = getSession();
  if (!username) {
    renderAdminReviews([], false);
    return;
  }
  setLoggedInState(username);
  renderAdminReviews(sortReviews(getStoredReviews()), true);
}

async function loadAdminReviews() {
  if (useLocalMode) {
    loadLocalAdminReviews();
    return;
  }

  try {
    const data = await fetchJson('./api/admin/reviews');
    setLoggedInState(data.username);
    renderAdminReviews(sortReviews(data.reviews), true);
  } catch {
    useLocalMode = true;
    loadLocalAdminReviews();
    adminStatus.textContent = 'Static mode is active. Admin data works only in this browser.';
  }
}

async function checkAdminStatus() {
  if (useLocalMode) {
    const admin = getStoredAdmin();
    const username = getSession();
    if (admin && username === admin.username) {
      adminStatus.textContent = 'Static mode is active. Changes stay in this browser.';
      loadLocalAdminReviews();
      return;
    }
    renderAdminReviews([], false);
    if (admin) setLoginState(); else setSignupState();
    adminStatus.textContent = 'Static mode is active. Admin login is saved only in this browser.';
    return;
  }

  try {
    const data = await fetchJson('./api/admin/status');
    if (data.authenticated) {
      adminStatus.textContent = '';
      await loadAdminReviews();
      return;
    }
    renderAdminReviews([], false);
    if (data.setupRequired) setSignupState(); else setLoginState();
  } catch {
    useLocalMode = true;
    await checkAdminStatus();
  }
}

signupForm.addEventListener('submit', async event => {
  event.preventDefault();
  adminStatus.textContent = 'Creating admin account...';
  const formData = new FormData(signupForm);
  const username = String(formData.get('username') || '').trim();
  const password = String(formData.get('password') || '').trim();

  if (!username || password.length < 6) {
    adminStatus.textContent = 'Use a username and a password with at least 6 characters.';
    return;
  }

  if (useLocalMode) {
    if (getStoredAdmin()) {
      adminStatus.textContent = 'Admin account already exists in this browser. Please log in.';
      setLoginState();
      return;
    }
    writeJson(storageKeys.admin, { username, password });
    setSession(username);
    signupForm.reset();
    adminStatus.textContent = 'Admin account created in this browser.';
    loadLocalAdminReviews();
    return;
  }

  try {
    const data = await fetchJson('./api/admin/signup', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    adminStatus.textContent = data.message;
    signupForm.reset();
    await loadAdminReviews();
  } catch {
    useLocalMode = true;
    if (!getStoredAdmin()) {
      writeJson(storageKeys.admin, { username, password });
      setSession(username);
      signupForm.reset();
      adminStatus.textContent = 'Backend unavailable. Admin account created in this browser instead.';
      loadLocalAdminReviews();
    } else {
      adminStatus.textContent = 'Backend unavailable and admin already exists in this browser. Please log in.';
      setLoginState();
    }
  }
});

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  adminStatus.textContent = 'Logging in...';
  const formData = new FormData(loginForm);
  const username = String(formData.get('username') || '').trim();
  const password = String(formData.get('password') || '').trim();

  if (useLocalMode) {
    const admin = getStoredAdmin();
    if (!admin || admin.username !== username || admin.password !== password) {
      adminStatus.textContent = 'Invalid username or password.';
      return;
    }
    setSession(username);
    loginForm.reset();
    adminStatus.textContent = 'Logged in successfully in this browser.';
    loadLocalAdminReviews();
    return;
  }

  try {
    const data = await fetchJson('./api/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    adminStatus.textContent = data.message;
    loginForm.reset();
    await loadAdminReviews();
  } catch {
    useLocalMode = true;
    const admin = getStoredAdmin();
    if (!admin || admin.username !== username || admin.password !== password) {
      adminStatus.textContent = 'Backend unavailable and local admin login did not match.';
      return;
    }
    setSession(username);
    loginForm.reset();
    adminStatus.textContent = 'Backend unavailable. Logged in using this browser storage.';
    loadLocalAdminReviews();
  }
});

logoutButton.addEventListener('click', async () => {
  if (useLocalMode) {
    clearSession();
    adminStatus.textContent = 'Logged out.';
    checkAdminStatus();
    return;
  }

  try {
    const data = await fetchJson('./api/admin/logout', { method: 'POST' });
    adminStatus.textContent = data.message;
    await checkAdminStatus();
  } catch {
    useLocalMode = true;
    clearSession();
    adminStatus.textContent = 'Backend unavailable. Logged out of this browser session.';
    checkAdminStatus();
  }
});

adminReviewList.addEventListener('submit', async event => {
  const replyForm = event.target.closest('.reply-form');
  if (!replyForm) return;
  event.preventDefault();
  const card = replyForm.closest('[data-review-id]');
  const reviewId = Number(card.dataset.reviewId);
  const reply = String(new FormData(replyForm).get('reply') || '').trim();

  if (!reply) {
    adminStatus.textContent = 'Reply cannot be empty.';
    return;
  }

  if (useLocalMode) {
    const reviews = getStoredReviews();
    const review = reviews.find(item => item.id === reviewId);
    if (!review) {
      adminStatus.textContent = 'Review not found.';
      return;
    }
    review.reply = { text: reply, createdAt: new Date().toISOString() };
    saveStoredReviews(reviews);
    adminStatus.textContent = 'Reply saved in this browser.';
    loadLocalAdminReviews();
    return;
  }

  try {
    await fetchJson(`./api/admin/reviews/${reviewId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ reply })
    });
    adminStatus.textContent = 'Reply saved.';
    await loadAdminReviews();
  } catch {
    useLocalMode = true;
    const reviews = getStoredReviews();
    const review = reviews.find(item => item.id === reviewId);
    if (review) {
      review.reply = { text: reply, createdAt: new Date().toISOString() };
      saveStoredReviews(reviews);
      adminStatus.textContent = 'Backend unavailable. Reply saved in this browser instead.';
      loadLocalAdminReviews();
    } else {
      adminStatus.textContent = 'Review not found.';
    }
  }
});

adminReviewList.addEventListener('click', async event => {
  const deleteButton = event.target.closest('.delete-review');
  if (!deleteButton) return;
  const card = deleteButton.closest('[data-review-id]');
  const reviewId = Number(card.dataset.reviewId);

  if (useLocalMode) {
    const nextReviews = getStoredReviews().filter(item => item.id !== reviewId);
    saveStoredReviews(nextReviews);
    adminStatus.textContent = 'Review deleted from this browser.';
    loadLocalAdminReviews();
    return;
  }

  try {
    await fetchJson(`./api/admin/reviews/${reviewId}`, { method: 'DELETE' });
    adminStatus.textContent = 'Review deleted.';
    await loadAdminReviews();
  } catch {
    useLocalMode = true;
    const nextReviews = getStoredReviews().filter(item => item.id !== reviewId);
    saveStoredReviews(nextReviews);
    adminStatus.textContent = 'Backend unavailable. Review deleted from this browser instead.';
    loadLocalAdminReviews();
  }
});

checkAdminStatus();
