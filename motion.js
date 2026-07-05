/* Shared motion layer for index.html, about.html, projects.html:
   - mobile nav toggle, scroll progress bar, back-to-top, page fades
   - staggered scroll-reveal, timeline draw-in, skills marquee
   - scroll-linked parallax and card tilt on [data-parallax]/[data-tilt]
   Parallax and tilt are skipped entirely for touch devices and for
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
    Array.from(container.children).forEach(child => {
      if (!child.classList.contains('glow')) child.classList.add('reveal-child');
    });
  });
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        Array.from(entry.target.children).filter(c => !c.classList.contains('glow')).forEach((child, i) => {
          child.style.transitionDelay = (i * 90) + 'ms';
          child.classList.add('in');
        });
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  document.querySelectorAll('.reveal').forEach(el => revealObserver.observe(el));

  /* ---- film grain overlay ---- */
  const grain = document.createElement('div');
  grain.className = 'grain';
  grain.setAttribute('aria-hidden', 'true');
  document.body.appendChild(grain);

  /* ---- back-to-top button ---- */
  const topBtn = document.createElement('button');
  topBtn.id = 'backToTop';
  topBtn.type = 'button';
  topBtn.setAttribute('aria-label', 'Back to top');
  topBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  document.body.appendChild(topBtn);
  topBtn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }));
  document.addEventListener('scroll', () => {
    topBtn.classList.toggle('show', window.scrollY > 600);
  }, { passive: true });

  /* ---- page transition fade on internal navigation ---- */
  if (!reduceMotion) {
    document.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (!link) return;
      const href = link.getAttribute('href');
      // only fade for same-site page links, not anchors/new tabs/external
      if (!href || href.startsWith('#') || href.startsWith('http') || href.startsWith('mailto:')) return;
      if (link.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      document.body.classList.add('page-leaving');
      setTimeout(() => { window.location.href = href; }, 260);
    });
    // restore if the page is shown again from bfcache after back-navigation
    window.addEventListener('pageshow', () => document.body.classList.remove('page-leaving'));
  }

  /* ---- timeline draw-in ---- */
  const timelineItems = document.querySelectorAll('.timeline-item');
  if (timelineItems.length) {
    const tlObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('drawn');
          tlObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.35 });
    timelineItems.forEach(el => tlObserver.observe(el));
  }

  /* ---- skills marquee: convert static .tool-chips rows into scrolling bands ---- */
  if (!reduceMotion) {
    document.querySelectorAll('.tool-chips').forEach((chips, bandIndex) => {
      const items = Array.from(chips.children);
      if (!items.length) return;
      const marquee = document.createElement('div');
      marquee.className = 'marquee';
      const track = document.createElement('div');
      track.className = 'marquee-track';
      // two identical halves so the -50% translate loops seamlessly;
      // few chips = short half, so repeat items until each half is reasonably wide
      const makeHalf = (hidden) => {
        const half = document.createElement('div');
        half.className = 'm-half';
        if (hidden) half.setAttribute('aria-hidden', 'true');
        const repeats = items.length < 6 ? Math.ceil(6 / items.length) : 1;
        for (let r = 0; r < repeats; r++) {
          items.forEach(item => half.appendChild(item.cloneNode(true)));
        }
        return half;
      };
      track.appendChild(makeHalf(false));
      track.appendChild(makeHalf(true));
      track.style.setProperty('--marquee-dur', (26 + bandIndex * 7) + 's');
      marquee.appendChild(track);
      chips.replaceWith(marquee);
    });
  }

  if (reduceMotion || !finePointer) return; // skip parallax + tilt

  /* ---- subtle scroll-linked parallax (updates only while scrolling,
          not in a permanent per-frame loop) ---- */
  const parallaxEls = document.querySelectorAll('[data-parallax]');
  if (parallaxEls.length) {
    let parallaxQueued = false;
    function updateParallax() {
      parallaxQueued = false;
      parallaxEls.forEach(el => {
        const speed = parseFloat(el.dataset.parallax) || 0.15;
        const rect = el.getBoundingClientRect();
        const distanceFromCenter = rect.top + rect.height / 2 - window.innerHeight / 2;
        el.style.transform = `translateY(${distanceFromCenter * -speed}px)`;
      });
    }
    function queueParallax() {
      if (!parallaxQueued) {
        parallaxQueued = true;
        requestAnimationFrame(updateParallax);
      }
    }
    document.addEventListener('scroll', queueParallax, { passive: true });
    window.addEventListener('resize', queueParallax);
    updateParallax();
  }

  /* ---- 3D tilt toward cursor on [data-tilt] cards ---- */
  document.querySelectorAll('[data-tilt]').forEach(card => {
    card.style.transition = 'transform .18s ease-out';
    card.style.willChange = 'transform';
    card.addEventListener('mousemove', (e) => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;   // -0.5 .. 0.5
      const py = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `perspective(900px) rotateX(${py * -4}deg) rotateY(${px * 5}deg) translateY(-2px)`;
    });
    card.addEventListener('mouseleave', () => {
      card.style.transform = 'perspective(900px) rotateX(0deg) rotateY(0deg)';
    });
  });
})();
