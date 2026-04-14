const interactiveSelectors = [
  '.button',
  '.nav a',
  '.brand',
  '.tile',
  '.gallery-card',
  '.contact-item',
  '.review-card',
  '.hero-card',
  '.card'
];

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let audioContext;

function getAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContext = new AudioContextClass();
  }
  return audioContext;
}

function playClickSound() {
  const ctx = getAudioContext();
  if (!ctx) return;

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = 'triangle';
  oscillator.frequency.setValueAtTime(620, ctx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + 0.06);
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  oscillator.start();
  oscillator.stop(ctx.currentTime + 0.08);
}

function addClickBurst(target, event) {
  if (prefersReducedMotion) return;
  const rect = target.getBoundingClientRect();
  const burst = document.createElement('span');
  burst.className = 'click-burst';
  burst.style.left = `${event.clientX - rect.left}px`;
  burst.style.top = `${event.clientY - rect.top}px`;
  target.appendChild(burst);
  burst.addEventListener('animationend', () => burst.remove());
}

function bindTilt(target) {
  if (prefersReducedMotion) return;

  target.addEventListener('mousemove', event => {
    const rect = target.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    const rotateY = (x - 0.5) * 10;
    const rotateX = (0.5 - y) * 8;
    target.style.transform = `perspective(900px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-8px)`;
  });

  target.addEventListener('mouseleave', () => {
    target.style.transform = '';
  });
}

function bindEffects(target) {
  if (!target) return;

  if (target.matches('.tile, .gallery-card, .contact-item, .review-card, .hero-card')) {
    bindTilt(target);
  }

  target.addEventListener('click', event => {
    addClickBurst(target, event);
    playClickSound();
  });
}

interactiveSelectors.forEach(selector => {
  document.querySelectorAll(selector).forEach(bindEffects);
});
