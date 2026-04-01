/* ============================================
   3D SCENES — Three.js for Akshay Kotish & Co.
   Neubrutalism-themed 3D elements
   ============================================ */

(function () {
    if (typeof THREE === 'undefined') return;

    const COLORS = {
        green: 0x2e7d32,
        greenLight: 0x4caf50,
        greenDark: 0x1b5e20,
        lime: 0xc0e040,
        yellow: 0xfff176,
        pink: 0xf8bbd0,
        blue: 0x90caf9,
        orange: 0xffcc80,
        lavender: 0xd1c4e9,
        dark: 0x1a1a1a,
        white: 0xffffff,
    };

    let mouseX = 0, mouseY = 0;
    document.addEventListener('mousemove', (e) => {
        mouseX = (e.clientX / window.innerWidth) * 2 - 1;
        mouseY = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    /* ========================
       HERO 3D SCENE
       ======================== */
    function initHeroScene() {
        const container = document.getElementById('hero3d');
        const canvas = document.getElementById('heroCanvas');
        if (!container || !canvas) return;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x111118);

        const w = container.clientWidth;
        const h = container.clientHeight || 420;
        const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 100);
        camera.position.set(0, 0, 8);

        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // Lights
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
        scene.add(ambientLight);
        const dirLight = new THREE.DirectionalLight(COLORS.lime, 1.2);
        dirLight.position.set(5, 5, 5);
        scene.add(dirLight);
        const pointLight = new THREE.PointLight(COLORS.green, 1.5, 20);
        pointLight.position.set(-3, 2, 3);
        scene.add(pointLight);
        const pointLight2 = new THREE.PointLight(COLORS.pink, 0.8, 15);
        pointLight2.position.set(3, -2, 2);
        scene.add(pointLight2);

        // Materials — neubrutalism wireframe + solid combo
        const matWireGreen = new THREE.MeshBasicMaterial({ color: COLORS.lime, wireframe: true });
        const matSolidGreen = new THREE.MeshStandardMaterial({ color: COLORS.green, roughness: 0.3, metalness: 0.6 });
        const matSolidLime = new THREE.MeshStandardMaterial({ color: COLORS.lime, roughness: 0.4, metalness: 0.5 });
        const matWireWhite = new THREE.MeshBasicMaterial({ color: 0x444444, wireframe: true });
        const matSolidPink = new THREE.MeshStandardMaterial({ color: COLORS.pink, roughness: 0.3, metalness: 0.4 });
        const matSolidYellow = new THREE.MeshStandardMaterial({ color: COLORS.yellow, roughness: 0.3, metalness: 0.4 });
        const matSolidBlue = new THREE.MeshStandardMaterial({ color: COLORS.blue, roughness: 0.3, metalness: 0.5 });

        const objects = [];

        // Central torus knot
        const torusKnotGeo = new THREE.TorusKnotGeometry(1.2, 0.35, 128, 32);
        const torusKnot = new THREE.Mesh(torusKnotGeo, matSolidGreen);
        torusKnot.position.set(0, 0, 0);
        scene.add(torusKnot);
        objects.push({ mesh: torusKnot, rotSpeed: { x: 0.003, y: 0.005, z: 0 }, floatSpeed: 1.2, floatAmp: 0.15 });

        // Wireframe icosahedron around it
        const icoGeo = new THREE.IcosahedronGeometry(2.2, 1);
        const icoWire = new THREE.Mesh(icoGeo, matWireGreen);
        scene.add(icoWire);
        objects.push({ mesh: icoWire, rotSpeed: { x: -0.002, y: 0.003, z: 0.001 }, floatSpeed: 0.8, floatAmp: 0.1 });

        // Floating octahedron — top right
        const octaGeo = new THREE.OctahedronGeometry(0.6, 0);
        const octa = new THREE.Mesh(octaGeo, matSolidLime);
        octa.position.set(3, 1.5, -1);
        scene.add(octa);
        objects.push({ mesh: octa, rotSpeed: { x: 0.01, y: 0.015, z: 0 }, floatSpeed: 1.5, floatAmp: 0.3 });

        // Floating box — bottom left
        const boxGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
        const box = new THREE.Mesh(boxGeo, matSolidPink);
        box.position.set(-3, -1.2, 0.5);
        box.rotation.set(0.4, 0.6, 0);
        scene.add(box);
        objects.push({ mesh: box, rotSpeed: { x: 0.008, y: 0.012, z: 0.005 }, floatSpeed: 1.8, floatAmp: 0.25 });

        // Wireframe box outline
        const boxWireGeo = new THREE.BoxGeometry(0.85, 0.85, 0.85);
        const boxWire = new THREE.Mesh(boxWireGeo, matWireWhite);
        boxWire.position.copy(box.position);
        boxWire.rotation.copy(box.rotation);
        scene.add(boxWire);
        objects.push({ mesh: boxWire, rotSpeed: { x: 0.008, y: 0.012, z: 0.005 }, floatSpeed: 1.8, floatAmp: 0.25, followIndex: 3 });

        // Dodecahedron — top left
        const dodecaGeo = new THREE.DodecahedronGeometry(0.5, 0);
        const dodeca = new THREE.Mesh(dodecaGeo, matSolidYellow);
        dodeca.position.set(-2.5, 2, 0);
        scene.add(dodeca);
        objects.push({ mesh: dodeca, rotSpeed: { x: -0.006, y: 0.01, z: 0.003 }, floatSpeed: 2, floatAmp: 0.2 });

        // Cone — bottom right
        const coneGeo = new THREE.ConeGeometry(0.4, 0.9, 6);
        const cone = new THREE.Mesh(coneGeo, matSolidBlue);
        cone.position.set(2.8, -1.8, 1);
        scene.add(cone);
        objects.push({ mesh: cone, rotSpeed: { x: 0.005, y: -0.008, z: 0 }, floatSpeed: 1.3, floatAmp: 0.22 });

        // Torus ring — mid left
        const torusGeo = new THREE.TorusGeometry(0.5, 0.12, 16, 32);
        const torus = new THREE.Mesh(torusGeo, matSolidLime);
        torus.position.set(-1.8, -0.5, 2);
        torus.rotation.x = Math.PI / 3;
        scene.add(torus);
        objects.push({ mesh: torus, rotSpeed: { x: 0.01, y: 0, z: 0.008 }, floatSpeed: 1.6, floatAmp: 0.18 });

        // Small spheres scattered
        for (let i = 0; i < 15; i++) {
            const sphereGeo = new THREE.SphereGeometry(0.08 + Math.random() * 0.08, 8, 8);
            const mat = new THREE.MeshStandardMaterial({
                color: [COLORS.lime, COLORS.green, COLORS.yellow, COLORS.pink, COLORS.blue][Math.floor(Math.random() * 5)],
                roughness: 0.2, metalness: 0.8
            });
            const sphere = new THREE.Mesh(sphereGeo, mat);
            sphere.position.set(
                (Math.random() - 0.5) * 8,
                (Math.random() - 0.5) * 5,
                (Math.random() - 0.5) * 4
            );
            scene.add(sphere);
            objects.push({
                mesh: sphere,
                rotSpeed: { x: 0, y: 0, z: 0 },
                floatSpeed: 0.5 + Math.random() * 2,
                floatAmp: 0.1 + Math.random() * 0.3,
                phaseOffset: Math.random() * Math.PI * 2
            });
        }

        // Grid floor (subtle)
        const gridGeo = new THREE.PlaneGeometry(20, 20, 20, 20);
        const gridMat = new THREE.MeshBasicMaterial({ color: COLORS.lime, wireframe: true, transparent: true, opacity: 0.06 });
        const grid = new THREE.Mesh(gridGeo, gridMat);
        grid.rotation.x = -Math.PI / 2;
        grid.position.y = -3;
        scene.add(grid);

        const clock = new THREE.Clock();

        function animate() {
            requestAnimationFrame(animate);
            const t = clock.getElapsedTime();

            objects.forEach((obj, i) => {
                const m = obj.mesh;
                m.rotation.x += obj.rotSpeed.x;
                m.rotation.y += obj.rotSpeed.y;
                m.rotation.z += obj.rotSpeed.z;

                const phase = obj.phaseOffset || i * 0.5;
                const floatY = Math.sin(t * obj.floatSpeed + phase) * obj.floatAmp;
                if (!obj._baseY) obj._baseY = m.position.y;
                m.position.y = obj._baseY + floatY;

                if (obj.followIndex !== undefined) {
                    const leader = objects[obj.followIndex].mesh;
                    m.position.copy(leader.position);
                    m.rotation.copy(leader.rotation);
                }
            });

            // Mouse-reactive camera sway
            camera.position.x += (mouseX * 1.5 - camera.position.x) * 0.02;
            camera.position.y += (mouseY * 0.8 - camera.position.y) * 0.02;
            camera.lookAt(0, 0, 0);

            // Animate point light
            pointLight.position.x = Math.sin(t * 0.5) * 4;
            pointLight.position.z = Math.cos(t * 0.5) * 3;

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
       BACKGROUND PARTICLES
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

        const particleCount = 120;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const palette = [
            new THREE.Color(COLORS.lime),
            new THREE.Color(COLORS.green),
            new THREE.Color(COLORS.greenLight),
            new THREE.Color(COLORS.yellow),
        ];

        for (let i = 0; i < particleCount; i++) {
            positions[i * 3] = (Math.random() - 0.5) * 60;
            positions[i * 3 + 1] = (Math.random() - 0.5) * 40;
            positions[i * 3 + 2] = (Math.random() - 0.5) * 30;
            const c = palette[Math.floor(Math.random() * palette.length)];
            colors[i * 3] = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 0.15,
            vertexColors: true,
            transparent: true,
            opacity: 0.7,
            sizeAttenuation: true,
        });

        const particles = new THREE.Points(geometry, material);
        scene.add(particles);

        // Connect nearby particles with lines
        const lineMat = new THREE.LineBasicMaterial({ color: COLORS.lime, transparent: true, opacity: 0.06 });

        const clock = new THREE.Clock();

        function animate() {
            requestAnimationFrame(animate);
            const t = clock.getElapsedTime();
            const posArr = geometry.attributes.position.array;

            for (let i = 0; i < particleCount; i++) {
                posArr[i * 3 + 1] += Math.sin(t * 0.3 + i * 0.1) * 0.003;
                posArr[i * 3] += Math.cos(t * 0.2 + i * 0.15) * 0.002;
            }
            geometry.attributes.position.needsUpdate = true;

            particles.rotation.y = t * 0.015;
            particles.rotation.x = Math.sin(t * 0.1) * 0.05;

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
       TECH 3D INTERACTIVE SCENE
       ======================== */
    function initTech3D() {
        const wrapper = document.getElementById('tech3dWrapper');
        const canvas = document.getElementById('tech3dCanvas');
        if (!wrapper || !canvas) return;

        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0a0a0f);
        scene.fog = new THREE.FogExp2(0x0a0a0f, 0.035);

        const w = wrapper.clientWidth;
        const h = wrapper.clientHeight || 500;
        const camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 100);
        camera.position.set(0, 2, 12);

        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setSize(w, h);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        // Lights
        scene.add(new THREE.AmbientLight(0xffffff, 0.15));
        const spot1 = new THREE.SpotLight(COLORS.lime, 2, 30, Math.PI / 4, 0.5);
        spot1.position.set(5, 8, 5);
        scene.add(spot1);
        const spot2 = new THREE.SpotLight(COLORS.green, 1.5, 25, Math.PI / 3, 0.5);
        spot2.position.set(-5, 5, -3);
        scene.add(spot2);
        const pointL = new THREE.PointLight(COLORS.pink, 0.6, 15);
        pointL.position.set(0, -2, 5);
        scene.add(pointL);

        const shapes = [];

        // Central sphere with wireframe overlay
        const sphereGeo = new THREE.IcosahedronGeometry(1.8, 2);
        const sphereMat = new THREE.MeshStandardMaterial({
            color: COLORS.green, roughness: 0.15, metalness: 0.9,
            emissive: COLORS.greenDark, emissiveIntensity: 0.15
        });
        const sphere = new THREE.Mesh(sphereGeo, sphereMat);
        scene.add(sphere);
        shapes.push({ mesh: sphere, orbit: false, rotSpeed: { x: 0.002, y: 0.004 } });

        const sphereWire = new THREE.Mesh(
            new THREE.IcosahedronGeometry(2.0, 1),
            new THREE.MeshBasicMaterial({ color: COLORS.lime, wireframe: true, transparent: true, opacity: 0.3 })
        );
        scene.add(sphereWire);
        shapes.push({ mesh: sphereWire, orbit: false, rotSpeed: { x: -0.003, y: 0.002 } });

        // Orbiting shapes — each representing a tech domain
        const orbitConfigs = [
            { geo: new THREE.OctahedronGeometry(0.5, 0), color: COLORS.lime, dist: 4, speed: 0.4, yOff: 0.5, label: 'AI/ML' },
            { geo: new THREE.BoxGeometry(0.6, 0.6, 0.6), color: COLORS.yellow, dist: 5, speed: -0.3, yOff: -0.3, label: 'PropTech' },
            { geo: new THREE.TetrahedronGeometry(0.5, 0), color: COLORS.pink, dist: 3.5, speed: 0.55, yOff: 1, label: 'LegalTech' },
            { geo: new THREE.TorusGeometry(0.35, 0.12, 8, 16), color: COLORS.blue, dist: 5.5, speed: -0.25, yOff: -1, label: 'PetTech' },
            { geo: new THREE.DodecahedronGeometry(0.4, 0), color: COLORS.lavender, dist: 4.5, speed: 0.35, yOff: 0.8, label: 'Security' },
        ];

        orbitConfigs.forEach((cfg, i) => {
            const mat = new THREE.MeshStandardMaterial({
                color: cfg.color, roughness: 0.2, metalness: 0.7,
                emissive: cfg.color, emissiveIntensity: 0.1
            });
            const mesh = new THREE.Mesh(cfg.geo, mat);
            scene.add(mesh);
            shapes.push({
                mesh, orbit: true,
                dist: cfg.dist, speed: cfg.speed, yOff: cfg.yOff,
                rotSpeed: { x: 0.01 + i * 0.003, y: 0.015 - i * 0.002 },
                phase: (i / orbitConfigs.length) * Math.PI * 2
            });

            // Wireframe outline
            const wireGeo = cfg.geo.clone();
            const wireMesh = new THREE.Mesh(wireGeo, new THREE.MeshBasicMaterial({
                color: 0x333333, wireframe: true, transparent: true, opacity: 0.5
            }));
            scene.add(wireMesh);
            shapes.push({
                mesh: wireMesh, orbit: true,
                dist: cfg.dist, speed: cfg.speed, yOff: cfg.yOff,
                rotSpeed: { x: 0.01 + i * 0.003, y: 0.015 - i * 0.002 },
                phase: (i / orbitConfigs.length) * Math.PI * 2,
                scaleUp: 1.15
            });
        });

        // Orbit rings
        for (let i = 0; i < 3; i++) {
            const ringGeo = new THREE.TorusGeometry(3.5 + i * 1.2, 0.01, 8, 64);
            const ringMat = new THREE.MeshBasicMaterial({ color: COLORS.lime, transparent: true, opacity: 0.08 + i * 0.02 });
            const ring = new THREE.Mesh(ringGeo, ringMat);
            ring.rotation.x = Math.PI / 2 + i * 0.2;
            ring.rotation.z = i * 0.3;
            scene.add(ring);
        }

        // Floating particles
        const pCount = 200;
        const pGeo = new THREE.BufferGeometry();
        const pPos = new Float32Array(pCount * 3);
        for (let i = 0; i < pCount; i++) {
            pPos[i * 3] = (Math.random() - 0.5) * 25;
            pPos[i * 3 + 1] = (Math.random() - 0.5) * 15;
            pPos[i * 3 + 2] = (Math.random() - 0.5) * 20;
        }
        pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
        const pMat = new THREE.PointsMaterial({ color: COLORS.lime, size: 0.06, transparent: true, opacity: 0.5 });
        const pCloud = new THREE.Points(pGeo, pMat);
        scene.add(pCloud);

        // Mouse tracking for this section
        let localMouseX = 0, localMouseY = 0;
        wrapper.addEventListener('mousemove', (e) => {
            const rect = wrapper.getBoundingClientRect();
            localMouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            localMouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        });

        const clock = new THREE.Clock();

        function animate() {
            requestAnimationFrame(animate);
            const t = clock.getElapsedTime();

            shapes.forEach((s) => {
                const m = s.mesh;
                if (s.rotSpeed) {
                    m.rotation.x += s.rotSpeed.x;
                    m.rotation.y += s.rotSpeed.y;
                }
                if (s.orbit) {
                    const angle = t * s.speed + (s.phase || 0);
                    m.position.x = Math.cos(angle) * s.dist;
                    m.position.z = Math.sin(angle) * s.dist;
                    m.position.y = s.yOff + Math.sin(t * 0.8 + (s.phase || 0)) * 0.3;
                    if (s.scaleUp) {
                        m.position.copy(shapes[shapes.indexOf(s) - 1].mesh.position);
                        m.scale.setScalar(s.scaleUp);
                    }
                }
            });

            // Camera follows mouse
            camera.position.x += (localMouseX * 3 - camera.position.x) * 0.03;
            camera.position.y += (2 + localMouseY * 1.5 - camera.position.y) * 0.03;
            camera.lookAt(0, 0, 0);

            pCloud.rotation.y = t * 0.02;

            renderer.render(scene, camera);
        }

        animate();

        // Intersection observer to only animate when visible
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    renderer.setAnimationLoop(() => {
                        animate();
                    });
                } else {
                    renderer.setAnimationLoop(null);
                }
            });
        }, { threshold: 0.1 });
        // Start with rAF, observer will manage later
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
