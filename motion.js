/* Shared motion layer for index.html, about.html, projects.html:
   - scroll progress bar
   - staggered scroll-reveal (apply class="reveal" to a container; its direct
     children fade/slide in one after another as it enters the viewport)
   - custom cursor + subtle scroll-linked parallax on [data-parallax] elements
   The cursor and parallax are skipped entirely for touch devices and for
   visitors with prefers-reduced-motion enabled — not just slowed down. */
(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = window.matchMedia('(pointer: fine)').matches;

  /* ---- mobile nav toggle ---- */
  const navToggle = document.querySelector('.nav-toggle');
  const navLinks = document.querySelector('.sitenav-links');
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      const open = navLinks.classList.toggle('open');
      navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    navLinks.querySelectorAll('a, button').forEach(el => {
      el.addEventListener('click', () => {
        navLinks.classList.remove('open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });
    document.addEventListener('click', (e) => {
      if (!navLinks.classList.contains('open')) return;
      if (navLinks.contains(e.target) || navToggle.contains(e.target)) return;
      navLinks.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  }

  /* ---- mobile-only: fade out the nav brand once the page is scrolled ---- */
  const brand = document.querySelector('.sitenav .brand');
  const mobileQuery = window.matchMedia('(max-width:767px)');
  if (brand) {
    const updateBrandVisibility = () => {
      if (!mobileQuery.matches) {
        brand.classList.remove('nav-hidden');
        return;
      }
      brand.classList.toggle('nav-hidden', window.scrollY > 24);
    };
    document.addEventListener('scroll', updateBrandVisibility, { passive: true });
    mobileQuery.addEventListener('change', updateBrandVisibility);
    updateBrandVisibility();
  }

  /* ---- scroll progress bar ---- */
  const bar = document.createElement('div');
  bar.id = 'scrollProgress';
  bar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bar);
  function updateProgress() {
    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    const pct = max > 0 ? (doc.scrollTop / max) * 100 : 0;
    bar.style.width = pct + '%';
  }
  document.addEventListener('scroll', updateProgress, { passive: true });
  updateProgress();

  /* ---- staggered scroll-reveal ---- */
  document.querySelectorAll('.reveal').forEach(container => {
    Array.from(container.children).forEach(child => child.classList.add('reveal-child'));
  });
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        Array.from(entry.target.children).forEach((child, i) => {
          child.style.transitionDelay = (i * 90) + 'ms';
          child.classList.add('in');
        });
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

  if (reduceMotion || !finePointer) return; // skip cursor + parallax

  /* ---- custom cursor ---- */
  const dot = document.createElement('div');
  dot.className = 'cursor-dot';
  const ring = document.createElement('div');
  ring.className = 'cursor-ring';
  document.body.appendChild(dot);
  document.body.appendChild(ring);
  document.body.classList.add('custom-cursor-active');

  let mouseX = window.innerWidth / 2, mouseY = window.innerHeight / 2;
  let ringX = mouseX, ringY = mouseY;
  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    dot.style.left = mouseX + 'px';
    dot.style.top = mouseY + 'px';
  });
  document.addEventListener('mouseover', (e) => {
    const isInteractive = e.target.closest('a, button, .photo, input, textarea, label');
    ring.classList.toggle('cursor-hover', !!isInteractive);
  });

  function tick() {
    ringX += (mouseX - ringX) * 0.18;
    ringY += (mouseY - ringY) * 0.18;
    ring.style.left = ringX + 'px';
    ring.style.top = ringY + 'px';
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* ---- subtle scroll-linked parallax ---- */
  const parallaxEls = document.querySelectorAll('[data-parallax]');
  if (parallaxEls.length) {
    function updateParallax() {
      parallaxEls.forEach(el => {
        const speed = parseFloat(el.dataset.parallax) || 0.15;
        const rect = el.getBoundingClientRect();
        const distanceFromCenter = rect.top + rect.height / 2 - window.innerHeight / 2;
        el.style.transform = `translateY(${distanceFromCenter * -speed}px)`;
      });
      requestAnimationFrame(updateParallax);
    }
    requestAnimationFrame(updateParallax);
  }
})();
