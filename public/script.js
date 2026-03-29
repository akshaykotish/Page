/* ============================================
   AKSHAY KOTISH & CO. — Interactive Scripts
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {
    // === Navbar Scroll Effect ===
    const navbar = document.getElementById('navbar');
    const navLinks = document.querySelectorAll('.nav-link');
    const sections = document.querySelectorAll('section[id]');

    window.addEventListener('scroll', () => {
        // Add scrolled class
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }

        // Active nav link based on scroll position
        let current = '';
        sections.forEach(section => {
            const sectionTop = section.offsetTop - 120;
            if (window.scrollY >= sectionTop) {
                current = section.getAttribute('id');
            }
        });

        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === '#' + current) {
                link.classList.add('active');
            }
        });
    });

    // === Mobile Nav Toggle ===
    const navToggle = document.getElementById('navToggle');
    const navLinksContainer = document.getElementById('navLinks');

    navToggle.addEventListener('click', () => {
        navToggle.classList.toggle('active');
        navLinksContainer.classList.toggle('open');
    });

    // Close mobile nav on link click
    navLinksContainer.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => {
            navToggle.classList.remove('active');
            navLinksContainer.classList.remove('open');
        });
    });

    // === Animated Counters ===
    const statNumbers = document.querySelectorAll('.stat-number');
    let countersAnimated = false;

    function animateCounters() {
        if (countersAnimated) return;

        const statsSection = document.querySelector('.hero-stats');
        if (!statsSection) return;

        const rect = statsSection.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
            countersAnimated = true;

            statNumbers.forEach(counter => {
                const target = parseInt(counter.getAttribute('data-target'));
                const duration = 2000;
                const startTime = performance.now();

                function updateCounter(currentTime) {
                    const elapsed = currentTime - startTime;
                    const progress = Math.min(elapsed / duration, 1);

                    // Ease out cubic
                    const eased = 1 - Math.pow(1 - progress, 3);
                    const current = Math.floor(eased * target);

                    counter.textContent = current;

                    if (progress < 1) {
                        requestAnimationFrame(updateCounter);
                    } else {
                        counter.textContent = target;
                    }
                }

                requestAnimationFrame(updateCounter);
            });
        }
    }

    window.addEventListener('scroll', animateCounters);
    animateCounters(); // Check on load

    // === Fade In on Scroll ===
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const fadeObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                fadeObserver.unobserve(entry.target);
            }
        });
    }, observerOptions);

    // Add fade-in class to elements
    const fadeElements = document.querySelectorAll(
        '.product-card, .service-card, .detail-card, .timeline-item, ' +
        '.achievement-card, .section-header, .about-card, .contact-card, ' +
        '.envelope-card, .contact-links-card'
    );

    fadeElements.forEach((el, index) => {
        el.classList.add('fade-in');
        el.style.transitionDelay = `${index % 4 * 100}ms`;
        fadeObserver.observe(el);
    });

    // === Smooth Scroll for Anchor Links ===
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                const offsetTop = target.offsetTop - 80;
                window.scrollTo({
                    top: offsetTop,
                    behavior: 'smooth'
                });
            }
        });
    });

    // === Product Card Tilt Effect ===
    const productCards = document.querySelectorAll('.product-card');

    productCards.forEach(card => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const centerX = rect.width / 2;
            const centerY = rect.height / 2;
            const rotateX = (y - centerY) / 30;
            const rotateY = (centerX - x) / 30;

            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-6px)`;
        });

        card.addEventListener('mouseleave', () => {
            card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) translateY(0)';
        });
    });

    // === Tech Belt Pause on Hover ===
    const techBelt = document.querySelector('.tech-belt-inner');
    if (techBelt) {
        techBelt.addEventListener('mouseenter', () => {
            techBelt.style.animationPlayState = 'paused';
        });
        techBelt.addEventListener('mouseleave', () => {
            techBelt.style.animationPlayState = 'running';
        });
    }

    // === Notebook Parallax ===
    const notebook = document.querySelector('.hero-notebook');
    if (notebook) {
        window.addEventListener('scroll', () => {
            const scrolled = window.scrollY;
            if (scrolled < 800) {
                notebook.style.transform = `translateY(${scrolled * 0.1}px)`;
            }
        });
    }

    // === Keyboard Navigation ===
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            navToggle.classList.remove('active');
            navLinksContainer.classList.remove('open');
        }
    });
});
