const reviewForm = document.querySelector('#review-form');
const reviewList = document.querySelector('#review-list');
const formStatus = document.querySelector('#form-status');
const revealElements = document.querySelectorAll('.reveal');
const storageKeys = {
  reviews: 'somesh-blog-reviews'
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

function readLocalReviews() {
  try {
    return JSON.parse(localStorage.getItem(storageKeys.reviews) || '[]');
  } catch {
    return [];
  }
}

function saveLocalReviews(reviews) {
  localStorage.setItem(storageKeys.reviews, JSON.stringify(reviews));
}

function sortReviews(reviews) {
  return [...reviews].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function renderReviews(reviews) {
  if (!reviews.length) {
    reviewList.innerHTML = `
      <article class="review-card">
        <strong>No reviews yet</strong>
        <p>Be the first person to leave a kind review for Somesh.</p>
      </article>
    `;
    return;
  }

  reviewList.innerHTML = reviews.map(review => `
    <article class="review-card">
      <div class="review-meta">
        <strong>${escapeHtml(review.name)}</strong>
        <span class="stars">${'&#9733;'.repeat(review.rating)}${'&#9734;'.repeat(5 - review.rating)}</span>
      </div>
      <p>${escapeHtml(review.message)}</p>
      <small>${formatDate(review.createdAt)}</small>
      ${review.reply ? `
        <div class="review-reply">
          <strong>Somesh replied</strong>
          <p>${escapeHtml(review.reply.text)}</p>
        </div>
      ` : ''}
    </article>
  `).join('');
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error('Static host detected');
  }

  if (!response.ok) {
    throw new Error(data.error || 'Request failed.');
  }

  return data;
}

async function loadReviews() {
  if (useLocalMode) {
    renderReviews(sortReviews(readLocalReviews()));
    return;
  }

  try {
    const reviews = await fetchJson('./api/reviews');
    renderReviews(sortReviews(reviews));
  } catch {
    useLocalMode = true;
    renderReviews(sortReviews(readLocalReviews()));
    formStatus.textContent = 'Running in static mode: reviews are saved in this browser on this device.';
  }
}

reviewForm.addEventListener('submit', async event => {
  event.preventDefault();
  formStatus.textContent = 'Saving review...';

  const formData = new FormData(reviewForm);
  const payload = {
    id: Date.now(),
    name: String(formData.get('name') || '').trim(),
    rating: Number(formData.get('rating')),
    message: String(formData.get('message') || '').trim(),
    createdAt: new Date().toISOString(),
    reply: null
  };

  if (!payload.name || !payload.message || !Number.isInteger(payload.rating) || payload.rating < 1 || payload.rating > 5) {
    formStatus.textContent = 'Please enter a valid name, review, and rating.';
    return;
  }

  if (useLocalMode) {
    const reviews = readLocalReviews();
    reviews.push(payload);
    saveLocalReviews(reviews);
    formStatus.textContent = 'Review saved in this browser.';
    reviewForm.reset();
    renderReviews(sortReviews(reviews));
    return;
  }

  try {
    await fetchJson('./api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    formStatus.textContent = 'Review saved successfully.';
    reviewForm.reset();
    await loadReviews();
  } catch {
    useLocalMode = true;
    const reviews = readLocalReviews();
    reviews.push(payload);
    saveLocalReviews(reviews);
    formStatus.textContent = 'Backend not available here. Review saved in this browser instead.';
    reviewForm.reset();
    renderReviews(sortReviews(reviews));
  }
});

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.16 });

revealElements.forEach(element => observer.observe(element));
loadReviews();
