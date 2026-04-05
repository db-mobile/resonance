document.addEventListener('DOMContentLoaded', function () {

  /* ── Version badge ── */
  fetch('https://api.github.com/repos/db-mobile/resonance/releases/latest')
    .then(r => r.json())
    .then(data => {
      const raw = data.tag_name || data.name || '';
      const ver = raw.startsWith('v') ? raw.slice(1) : raw;
      const el = document.getElementById('vb-val');
      if (el) { el.textContent = ver || '—'; }
    })
    .catch(() => {
      const el = document.getElementById('vb-val');
      if (el) { el.textContent = '—'; }
    });

  /* ── Sticky header shadow on scroll ── */
  const header = document.getElementById('header');
  const onScroll = () => {
    if (window.scrollY > 10) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ── Smooth scroll for anchor links ── */
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', function (e) {
      const href = this.getAttribute('href');
      if (href === '#') { e.preventDefault(); return; }
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        const offset = parseInt(getComputedStyle(document.documentElement)
          .getPropertyValue('--nav-h'), 10) || 60;
        const top = target.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top, behavior: 'smooth' });
        // Close mobile nav if open
        navLinks.classList.remove('open');
        burger.setAttribute('aria-expanded', 'false');
      }
    });
  });

  /* ── Mobile burger ── */
  const burger   = document.getElementById('burger');
  const navLinks = document.getElementById('nav-links');

  burger.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  /* ── Scroll reveal (Intersection Observer) ── */
  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08, rootMargin: '0px 0px -40px 0px' }
  );

  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));

});
