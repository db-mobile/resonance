// Smooth scrolling for navigation links
document.addEventListener('DOMContentLoaded', function() {
    // Fetch latest version from GitHub Releases
    const versionBadge = document.getElementById('version-badge');
    fetch('https://api.github.com/repos/db-mobile/resonance/releases/latest')
        .then(response => response.json())
        .then(data => {
            const version = data.tag_name || data.name || '1.7.1';
            // Remove 'v' prefix if present
            const cleanVersion = version.startsWith('v') ? version.substring(1) : version;
            versionBadge.textContent = `Version ${cleanVersion}`;
        })
        .catch(error => {
            console.error('Error fetching version:', error);
            versionBadge.textContent = 'Version 1.7.1'; // Fallback to current version
        });

    // Handle smooth scrolling for anchor links
    const links = document.querySelectorAll('a[href^="#"]');

    links.forEach(link => {
        link.addEventListener('click', function(e) {
            const href = this.getAttribute('href');

            // Skip if it's just "#"
            if (href === '#') {
                e.preventDefault();
                return;
            }

            const target = document.querySelector(href);

            if (target) {
                e.preventDefault();
                const headerOffset = 80;
                const elementPosition = target.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;

                window.scrollTo({
                    top: offsetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });

    // Add animation on scroll
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Observe feature cards and screenshot items
    const animatedElements = document.querySelectorAll('.feature-card, .screenshot-item, .download-card, .tech-item');

    animatedElements.forEach(el => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(20px)';
        el.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(el);
    });

    // Mobile menu toggle (if needed in future)
    const createMobileMenu = () => {
        const nav = document.querySelector('nav');
        const navLinks = document.querySelector('.nav-links');

        if (window.innerWidth <= 768) {
            if (!document.querySelector('.mobile-menu-toggle')) {
                const toggle = document.createElement('button');
                toggle.className = 'mobile-menu-toggle';
                toggle.innerHTML = '☰';
                toggle.style.cssText = 'background: none; border: none; font-size: 1.5rem; cursor: pointer; display: block;';

                toggle.addEventListener('click', () => {
                    navLinks.classList.toggle('active');
                });

                nav.appendChild(toggle);
            }
        }
    };

    window.addEventListener('resize', createMobileMenu);
    createMobileMenu();
});
