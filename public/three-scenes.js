/* ============================================
   3D SCENES — Three.js for Akshay Kotish & Co.
   Big 3D Lights & Reflective Elements
   ============================================ */

(function () {
    if (typeof THREE === 'undefined') return;

    const COLORS = {
        green: 0x2e7d32,
        greenLight: 0x4caf50,
        lime: 0xc0e040,
        emerald: 0x50c878,
        teal: 0x008080,
        cyan: 0x00e5ff,
        white: 0xffffff,
        warmWhite: 0xfff5e6,
        dark: 0x0a0a12,
        deepBlack: 0x050508,
    };

    let mouseX = 0, mouseY = 0;
    document.addEventListener('mousemove', (e) => {
        mouseX = (e.clientX / window.innerWidth) * 2 - 1;
        mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    /* ========================
       HERO: VOLUMETRIC LIGHTS + REFLECTIVE FLOOR
       ======================== */
    function initHeroScene() {
        const container = document.getElementById('hero3d');
        const canvas = document.getElementById('heroCanvas');
        if (!container || !canvas) return;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(COLORS.deepBlack);
        scene.fog = new THREE.FogExp2(COLORS.deepBlack, 0.04);

        const w = container.clientWidth;
        const h = container.clientHeight || 420;
        const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 200);
        camera.position.set(0, 3, 14);
        camera.lookAt(0, 0, 0);

        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.2;

        // ─── Reflective ground plane ───
        const floorGeo = new THREE.PlaneGeometry(80, 80);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x0a0a0f,
            roughness: 0.05,
            metalness: 0.95,
            envMapIntensity: 1.5,
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -2;
        scene.add(floor);

        // ─── Big volumetric light cones (fake god rays) ───
        const lightCones = [];

        function createLightCone(color, posX, posZ, height, radius, intensity) {
            const coneGeo = new THREE.CylinderGeometry(0.05, radius, height, 32, 1, true);
            const coneMat = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.04 * intensity,
                side: THREE.DoubleSide,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
            });
            const cone = new THREE.Mesh(coneGeo, coneMat);
            cone.position.set(posX, height / 2 - 2, posZ);
            scene.add(cone);

            // Actual point light at the top
            const light = new THREE.PointLight(color, intensity * 3, height * 2.5, 1.5);
            light.position.set(posX, height - 2, posZ);
            scene.add(light);

            // Bright sphere at light source
            const glowGeo = new THREE.SphereGeometry(0.15, 16, 16);
            const glowMat = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.9,
            });
            const glow = new THREE.Mesh(glowGeo, glowMat);
            glow.position.copy(light.position);
            scene.add(glow);

            // Outer glow halo
            const haloGeo = new THREE.SphereGeometry(0.6, 16, 16);
            const haloMat = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.15,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            const halo = new THREE.Mesh(haloGeo, haloMat);
            halo.position.copy(light.position);
            scene.add(halo);

            return { cone, light, glow, halo, baseX: posX, baseZ: posZ, color };
        }

        // 5 big light pillars
        lightCones.push(createLightCone(COLORS.lime, -4, -2, 18, 3.5, 1.2));
        lightCones.push(createLightCone(COLORS.green, 0, -1, 22, 4, 1.5));
        lightCones.push(createLightCone(COLORS.emerald, 4, -3, 16, 3, 1.0));
        lightCones.push(createLightCone(COLORS.cyan, -2, 2, 14, 2.5, 0.8));
        lightCones.push(createLightCone(COLORS.teal, 3, 1, 12, 2, 0.7));

        // ─── Reflective spheres (like chrome balls catching light) ───
        const reflectiveSpheres = [];
        const spherePositions = [
            { x: -1.5, y: -0.5, z: 2, r: 0.7 },
            { x: 2, y: -1, z: 1, r: 0.5 },
            { x: 0, y: 0, z: 0, r: 1.2 },
            { x: -3.5, y: -1.5, z: -1, r: 0.4 },
            { x: 3.5, y: -1.5, z: -2, r: 0.35 },
        ];

        spherePositions.forEach(pos => {
            const geo = new THREE.SphereGeometry(pos.r, 64, 64);
            const mat = new THREE.MeshStandardMaterial({
                color: 0x111111,
                roughness: 0.02,
                metalness: 1.0,
                envMapIntensity: 2.0,
            });
            const sphere = new THREE.Mesh(geo, mat);
            sphere.position.set(pos.x, pos.y, pos.z);
            scene.add(sphere);
            reflectiveSpheres.push(sphere);
        });

        // ─── Floating light particles ───
        const particleCount = 80;
        const pGeo = new THREE.BufferGeometry();
        const pPos = new Float32Array(particleCount * 3);
        const pSizes = new Float32Array(particleCount);
        for (let i = 0; i < particleCount; i++) {
            pPos[i * 3] = (Math.random() - 0.5) * 20;
            pPos[i * 3 + 1] = Math.random() * 15 - 2;
            pPos[i * 3 + 2] = (Math.random() - 0.5) * 15;
            pSizes[i] = 0.03 + Math.random() * 0.08;
        }
        pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
        const pMat = new THREE.PointsMaterial({
            color: COLORS.lime,
            size: 0.08,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            sizeAttenuation: true,
        });
        const particles = new THREE.Points(pGeo, pMat);
        scene.add(particles);

        // Subtle ambient
        scene.add(new THREE.AmbientLight(0xffffff, 0.05));

        const clock = new THREE.Clock();

        function animate() {
            requestAnimationFrame(animate);
            const t = clock.getElapsedTime();

            // Animate light cones — gentle sway
            lightCones.forEach((lc, i) => {
                const phase = i * 1.3;
                const swayX = Math.sin(t * 0.3 + phase) * 0.5;
                const swayZ = Math.cos(t * 0.25 + phase) * 0.3;
                lc.cone.position.x = lc.baseX + swayX;
                lc.cone.position.z = lc.baseZ + swayZ;
                lc.light.position.x = lc.baseX + swayX;
                lc.light.position.z = lc.baseZ + swayZ;
                lc.glow.position.copy(lc.light.position);
                lc.halo.position.copy(lc.light.position);

                // Pulsing intensity
                lc.cone.material.opacity = 0.03 + Math.sin(t * 0.5 + phase) * 0.015;
                lc.halo.scale.setScalar(1 + Math.sin(t * 0.8 + phase) * 0.3);
                lc.light.intensity = lc.light.intensity * 0.99 + (2 + Math.sin(t * 0.6 + phase)) * 0.01;
            });

            // Reflective spheres — gentle float
            reflectiveSpheres.forEach((s, i) => {
                s.position.y += Math.sin(t * 0.4 + i * 2) * 0.002;
                s.rotation.y = t * 0.1 + i;
            });

            // Particles drift upward
            const posArr = pGeo.attributes.position.array;
            for (let i = 0; i < particleCount; i++) {
                posArr[i * 3 + 1] += 0.005;
                if (posArr[i * 3 + 1] > 15) posArr[i * 3 + 1] = -2;
                posArr[i * 3] += Math.sin(t * 0.2 + i) * 0.002;
            }
            pGeo.attributes.position.needsUpdate = true;

            // Camera sway
            camera.position.x += (mouseX * 2 - camera.position.x) * 0.015;
            camera.position.y += (3 + mouseY * 1 - camera.position.y) * 0.015;
            camera.lookAt(0, 0, 0);

            renderer.render(scene, camera);
        }

        animate();

        window.addEventListener('resize', () => {
            const w2 = container.clientWidth;
            const h2 = container.clientHeight || 420;
            camera.aspect = w2 / h2;
            camera.updateProjectionMatrix();
            renderer.setSize(w2, h2);
        });
    }

    /* ========================
       BACKGROUND: SOFT LIGHT PARTICLES
       ======================== */
    function initBgParticles() {
        const canvas = document.getElementById('bgParticles');
        if (!canvas) return;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
        camera.position.z = 30;

        const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(1);

        const particleCount = 60;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const palette = [
            new THREE.Color(COLORS.lime),
            new THREE.Color(COLORS.emerald),
            new THREE.Color(COLORS.green),
            new THREE.Color(COLORS.cyan),
        ];

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 60;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 40;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 20;
            const c = palette[Math.floor(Math.random() * palette.length)];
            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 0.25,
            vertexColors: true,
            transparent: true,
            opacity: 0.35,
            sizeAttenuation: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const particles = new THREE.Points(geometry, material);
        scene.add(particles);

        const clock = new THREE.Clock();

        function animate() {
            requestAnimationFrame(animate);
            const t = clock.getElapsedTime();
            const posArr = geometry.attributes.position.array;

            for (let i = 0; i < particleCount; i++) {
                posArr[i * 3 + 1] += Math.sin(t * 0.2 + i * 0.15) * 0.003;
                posArr[i * 3] += Math.cos(t * 0.15 + i * 0.1) * 0.002;
            }
            geometry.attributes.position.needsUpdate = true;
            particles.rotation.y = t * 0.008;

            renderer.render(scene, camera);
        }

        animate();

        window.addEventListener('resize', () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    /* ========================
       TECH 3D: LIGHT BEAMS + REFLECTIVE RINGS
       ======================== */
    function initTech3D() {
        const wrapper = document.getElementById('tech3dWrapper');
        const canvas = document.getElementById('tech3dCanvas');
        if (!wrapper || !canvas) return;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(COLORS.deepBlack);
        scene.fog = new THREE.FogExp2(COLORS.deepBlack, 0.025);

        const w = wrapper.clientWidth;
        const h = wrapper.clientHeight || 500;
        const camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 100);
        camera.position.set(0, 3, 14);

        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.0;

        // ─── Reflective floor ───
        const floorGeo = new THREE.PlaneGeometry(60, 60);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x080810,
            roughness: 0.03,
            metalness: 0.98,
        });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -3;
        scene.add(floor);

        // ─── Central reflective sphere (hero element) ───
        const centerGeo = new THREE.SphereGeometry(2, 128, 128);
        const centerMat = new THREE.MeshStandardMaterial({
            color: 0x0a0a0a,
            roughness: 0.0,
            metalness: 1.0,
            envMapIntensity: 3.0,
        });
        const centerSphere = new THREE.Mesh(centerGeo, centerMat);
        centerSphere.position.set(0, 0, 0);
        scene.add(centerSphere);

        // ─── Concentric reflective rings ───
        const rings = [];
        const ringRadii = [3.5, 5, 6.5];
        ringRadii.forEach((r, i) => {
            const ringGeo = new THREE.TorusGeometry(r, 0.04, 16, 128);
            const ringMat = new THREE.MeshStandardMaterial({
                color: 0x222222,
                roughness: 0.02,
                metalness: 1.0,
                emissive: COLORS.lime,
                emissiveIntensity: 0.05,
            });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.x = Math.PI / 2 + i * 0.15;
            ring.rotation.z = i * 0.2;
            scene.add(ring);
            rings.push(ring);
        });

        // ─── Orbiting light sources (5 tech domains) ───
        const domainLights = [];
        const domains = [
            { color: COLORS.lime, dist: 4, speed: 0.35, y: 0.5, label: 'AI/ML' },
            { color: COLORS.cyan, dist: 5.2, speed: -0.25, y: -0.5, label: 'PropTech' },
            { color: COLORS.emerald, dist: 3.8, speed: 0.45, y: 1, label: 'LegalTech' },
            { color: 0xff6090, dist: 5.8, speed: -0.2, y: -1, label: 'PetTech' },
            { color: 0xb388ff, dist: 4.5, speed: 0.3, y: 0.8, label: 'Security' },
        ];

        domains.forEach((d, i) => {
            // Point light
            const light = new THREE.PointLight(d.color, 4, 12, 1.5);
            scene.add(light);

            // Glowing orb
            const orbGeo = new THREE.SphereGeometry(0.15, 16, 16);
            const orbMat = new THREE.MeshBasicMaterial({
                color: d.color,
                transparent: true,
                opacity: 0.95,
            });
            const orb = new THREE.Mesh(orbGeo, orbMat);
            scene.add(orb);

            // Glow halo
            const haloGeo = new THREE.SphereGeometry(0.5, 16, 16);
            const haloMat = new THREE.MeshBasicMaterial({
                color: d.color,
                transparent: true,
                opacity: 0.12,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            });
            const halo = new THREE.Mesh(haloGeo, haloMat);
            scene.add(halo);

            // Light beam down to floor
            const beamGeo = new THREE.CylinderGeometry(0.02, 0.3, 3, 8, 1, true);
            const beamMat = new THREE.MeshBasicMaterial({
                color: d.color,
                transparent: true,
                opacity: 0.06,
                blending: THREE.AdditiveBlending,
                side: THREE.DoubleSide,
                depthWrite: false,
            });
            const beam = new THREE.Mesh(beamGeo, beamMat);
            scene.add(beam);

            domainLights.push({
                light, orb, halo, beam,
                dist: d.dist, speed: d.speed, y: d.y,
                phase: (i / domains.length) * Math.PI * 2,
            });
        });

        // ─── Ambient particles ───
        const pCount = 150;
        const pGeo = new THREE.BufferGeometry();
        const pPos = new Float32Array(pCount * 3);
        for (let i = 0; i < pCount; i++) {
            pPos[i * 3] = (Math.random() - 0.5) * 25;
            pPos[i * 3 + 1] = Math.random() * 12 - 3;
            pPos[i * 3 + 2] = (Math.random() - 0.5) * 20;
        }
        pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
        const pMat = new THREE.PointsMaterial({
            color: COLORS.lime,
            size: 0.04,
            transparent: true,
            opacity: 0.3,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });
        scene.add(new THREE.Points(pGeo, pMat));

        scene.add(new THREE.AmbientLight(0xffffff, 0.03));

        // Mouse tracking
        let localMouseX = 0, localMouseY = 0;
        wrapper.addEventListener('mousemove', (e) => {
            const rect = wrapper.getBoundingClientRect();
            localMouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            localMouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        });

        const clock = new THREE.Clock();
        let isVisible = true;

        function animate() {
            if (!isVisible) return;
            requestAnimationFrame(animate);
            const t = clock.getElapsedTime();

            // Center sphere subtle rotation
            centerSphere.rotation.y = t * 0.1;

            // Rings rotate slowly
            rings.forEach((ring, i) => {
                ring.rotation.z = i * 0.2 + t * 0.05 * (i % 2 === 0 ? 1 : -1);
            });

            // Orbiting lights
            domainLights.forEach((dl) => {
                const angle = t * dl.speed + dl.phase;
                const x = Math.cos(angle) * dl.dist;
                const z = Math.sin(angle) * dl.dist;
                const y = dl.y + Math.sin(t * 0.5 + dl.phase) * 0.4;

                dl.light.position.set(x, y, z);
                dl.orb.position.set(x, y, z);
                dl.halo.position.set(x, y, z);
                dl.beam.position.set(x, y - 1.5, z);

                // Pulse halo
                dl.halo.scale.setScalar(1 + Math.sin(t * 0.7 + dl.phase) * 0.25);
                dl.light.intensity = 3 + Math.sin(t * 0.5 + dl.phase) * 1.5;
            });

            // Camera
            camera.position.x += (localMouseX * 3 - camera.position.x) * 0.025;
            camera.position.y += (3 + localMouseY * 1.5 - camera.position.y) * 0.025;
            camera.lookAt(0, 0, 0);

            renderer.render(scene, camera);
        }

        animate();

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                isVisible = entry.isIntersecting;
                if (isVisible) animate();
            });
        }, { threshold: 0.1 });
        observer.observe(wrapper);

        window.addEventListener('resize', () => {
            const w2 = wrapper.clientWidth;
            const h2 = wrapper.clientHeight || 500;
            camera.aspect = w2 / h2;
            camera.updateProjectionMatrix();
            renderer.setSize(w2, h2);
        });
    }

    /* ========================
       INIT ALL
       ======================== */
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            initHeroScene();
            initBgParticles();
            initTech3D();
        });
    } else {
        initHeroScene();
        initBgParticles();
        initTech3D();
    }
})();
