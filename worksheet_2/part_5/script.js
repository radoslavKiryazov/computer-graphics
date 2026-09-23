"use strict";
window.onload = function () { main(); }

const build_ball = (array, center, radius, segments) => {
    for (let i = 0; i < segments; i++) {
        const theta0 = (i / segments) * 2 * Math.PI;
        const theta1 = ((i + 1) / segments) * 2 * Math.PI;
        array.push(vec2(center[0], center[1]));
        array.push(vec2(center[0] + radius * Math.cos(theta0), center[1] + radius * Math.sin(theta0)));
        array.push(vec2(center[0] + radius * Math.cos(theta1), center[1] + radius * Math.sin(theta1)));
    }
}

const build_ground = (array, x0, y0, x1, y1) => {
    array.push(vec2(x0, y0));
    array.push(vec2(x1, y0));
    array.push(vec2(x0, y1));
    array.push(vec2(x0, y1));
    array.push(vec2(x1, y0));
    array.push(vec2(x1, y1));
}

async function main() {

    // Initialize WebGPU
    const gpu = navigator.gpu;
    const adapter = await gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const canvas = document.getElementById('my-canvas');
    const context = canvas.getContext('webgpu');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device: device,
        format: canvasFormat,
    });

    const wgslfile = document.getElementById('wgsl').src;
    const wgslcode = await fetch(wgslfile, { cache: "reload" }).then(r => r.text());
    const wgsl = device.createShaderModule({
        code: wgslcode
    });

    // world -- RADIUS here must match the constant hardcoded in the shader.
    const radius = 0.15;
    const floorY = -0.9;
    const gravity = -2.5;   // clip-space units / s^2
    const dt = 1 / 60;

    let ballX = 0;
    let ballY = floorY + radius;
    let ballVY = 0;
    let running = true;
    let isDragging = false;

    // squash/stretch state
    let state = 'jumping'; // 'jumping' | 'squashing'
    let scaleX = 1;
    let scaleY = 1;

    // spring state (drives squashing mode, also reused for drag-squash)
    let springY = 0;
    let springVelocity = 0;

    // flat-pause state
    let hasPausedThisCycle = false;
    let pauseFramesRemaining = 0;

    let jumpVelocity = parseFloat(document.getElementById('velocity-slider').value);
    let stretchFactor = parseFloat(document.getElementById('stretch-slider').value);
    let stiffness = parseFloat(document.getElementById('stiffness-slider').value);
    let damping = parseFloat(document.getElementById('damping-slider').value);
    let flatness = parseFloat(document.getElementById('flatness-slider').value);
    let flatPauseDuration = parseInt(document.getElementById('pause-slider').value, 10);

    // ---- Geometry ----
    var ballPositions = [];
    build_ball(ballPositions, [0.0, 0.0], radius, 64);

    var floorPositions = [];
    build_ground(floorPositions, -1.0, floorY - 0.03, 1.0, floorY);

    const positionBufferLayout = {
        arrayStride: sizeof['vec2'],
        attributes: [{
            format: 'float32x2',
            offset: 0,
            shaderLocation: 0,
        }]
    }

    const ballBuffer = device.createBuffer({
        size: flatten(ballPositions).byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(ballBuffer, 0, flatten(ballPositions));

    const floorBuffer = device.createBuffer({
        size: flatten(floorPositions).byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(floorBuffer, 0, flatten(floorPositions));

    const uniformBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // pipelines
    const ballPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: wgsl, entryPoint: 'main_vs', buffers: [positionBufferLayout] },
        fragment: { module: wgsl, entryPoint: 'main_fs', targets: [{ format: canvasFormat }] },
        primitive: { topology: 'triangle-list' }
    });

    const floorPipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: wgsl, entryPoint: 'floor_vs', buffers: [positionBufferLayout] },
        fragment: { module: wgsl, entryPoint: 'floor_fs', targets: [{ format: canvasFormat }] },
        primitive: { topology: 'triangle-list' }
    });

    const bindGroup = device.createBindGroup({
        layout: ballPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
    });

    // Mirrors the shader's per-vertex flattening formula, evaluated at the
    // ball's bottom vertex, so we can keep it pinned to the floor.
    function bottomContactScaleY() {
        if (scaleX > 1) {
            const amplify = 1 + flatness * 1.0; // belowTop = 1 at the very bottom
            return Math.max(0.05, 1 + (scaleY - 1) * amplify);
        }
        return scaleY;
    }

    // physics + spring-driven squash/stretch state machine, with a flat pause
    function physicsStep() {
        if (state === 'jumping') {
            ballVY += gravity * dt;
            ballY += ballVY * dt;

            const speed = Math.abs(ballVY);
            scaleY = 1 + stretchFactor * speed;
            scaleX = 1 / scaleY;

            if (ballY <= floorY + radius) {
                state = 'squashing';
                springVelocity = ballVY;
                springY = stretchFactor * speed;
                hasPausedThisCycle = false;
                pauseFramesRemaining = 0;
            }
        } else { // 'squashing'
            if (pauseFramesRemaining > 0) {
                pauseFramesRemaining--;
            } else {
                const prevVelocity = springVelocity;
                const accel = -stiffness * springY - damping * springVelocity;
                springVelocity += accel * dt;
                springY += springVelocity * dt;

                if (!hasPausedThisCycle && prevVelocity <= 0 && springVelocity > 0) {
                    hasPausedThisCycle = true;
                    pauseFramesRemaining = flatPauseDuration;
                } else if (springVelocity > 0 && springY > -0.05) {
                    state = 'jumping';
                    springY = 0;
                    springVelocity = 0;
                    scaleX = 1;
                    scaleY = 1;
                    hasPausedThisCycle = false;
                    ballY = floorY + radius;
                    ballVY = jumpVelocity;
                }
            }

            if (state === 'squashing') {
                scaleY = 1 + springY;
                scaleX = 1 / scaleY;
                ballY = floorY + radius * bottomContactScaleY();
            }
        }
    }

    // ---- Mouse interaction ----
    function updateBallFromMouse(event) {
        const rect = event.target.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;

        // pixel space (0..width, 0..height, y-down) -> clip space (-1..1, y-up)
        const cx = (px / rect.width) * 2 - 1;
        const cy = 1 - (py / rect.height) * 2;

        ballX = Math.max(-1 + radius, Math.min(1 - radius, cx));
        const rawY = Math.max(floorY, Math.min(1 - radius, cy));
        ballVY = 0;

        // Squash proportional to how far the raw cursor position has been
        // pushed below the ball's normal resting height (floorY + radius)
        // -- not a bounce, just direct proximity-driven compression,
        // reusing the same visual pipeline as the physics-driven squash.
        const restY = floorY + radius;
        const penetration = Math.max(0, restY - rawY);
        springY = Math.max(-penetration, -0.7);
        springVelocity = 0;
        scaleY = 1 + springY;
        scaleX = 1 / scaleY;

        // Once squashed, pin the rendered bottom of the ball to the floor
        // surface instead of letting it clip through as you drag further
        // down -- same trick used by the physics-driven squash state.
        ballY = (scaleX > 1) ? (floorY + radius * bottomContactScaleY()) : rawY;
    }

    canvas.addEventListener('mousedown', (event) => {
        if (event.button !== 0) return; // left button only
        isDragging = true;
        state = 'jumping';
        hasPausedThisCycle = false;
        pauseFramesRemaining = 0;
        updateBallFromMouse(event);
    });

    canvas.addEventListener('mousemove', (event) => {
        if (!isDragging) return;
        updateBallFromMouse(event);
    });

    canvas.addEventListener('mouseup', (event) => {
        if (!isDragging) return;
        isDragging = false;
        running = true;
        toggleBtnSetLabel();
    });

    // Also catch release outside the canvas so dragging doesn't get stuck.
    window.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
        running = true;
        toggleBtnSetLabel();
    });

    // render
    function render() {
        device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([ballX, ballY, scaleX, scaleY, flatness, 0, 0, 0]));

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 },
            }],
        });

        pass.setPipeline(floorPipeline);
        pass.setVertexBuffer(0, floorBuffer);
        pass.draw(floorPositions.length);

        pass.setPipeline(ballPipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, ballBuffer);
        pass.draw(ballPositions.length);

        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    const loop = () => {
        if (!isDragging && running) {
            physicsStep();
        }
        render();
        requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);

    // UI
    const toggleBtn = document.getElementById('toggle-btn');
    const stepBtn = document.getElementById('step-btn');
    const slider = document.getElementById('velocity-slider');
    const valueLabel = document.getElementById('velocity-value');
    const stretchSlider = document.getElementById('stretch-slider');
    const stretchValue = document.getElementById('stretch-value');
    const stiffnessSlider = document.getElementById('stiffness-slider');
    const stiffnessValue = document.getElementById('stiffness-value');
    const dampingSlider = document.getElementById('damping-slider');
    const dampingValue = document.getElementById('damping-value');
    const flatnessSlider = document.getElementById('flatness-slider');
    const flatnessValue = document.getElementById('flatness-value');
    const pauseSlider = document.getElementById('pause-slider');
    const pauseValue = document.getElementById('pause-value');

    function toggleBtnSetLabel() {
        toggleBtn.textContent = running ? 'Stop' : 'Start';
        stepBtn.disabled = running;
    }

    stepBtn.disabled = running;

    toggleBtn.addEventListener('click', () => {
        running = !running;
        toggleBtnSetLabel();
    });

    stepBtn.addEventListener('click', () => {
        if (!running && !isDragging) {
            physicsStep();
        }
    });

    slider.addEventListener('input', () => {
        jumpVelocity = parseFloat(slider.value);
        valueLabel.textContent = jumpVelocity.toFixed(1);
    });

    stretchSlider.addEventListener('input', () => {
        stretchFactor = parseFloat(stretchSlider.value);
        stretchValue.textContent = stretchFactor.toFixed(2);
    });

    stiffnessSlider.addEventListener('input', () => {
        stiffness = parseFloat(stiffnessSlider.value);
        stiffnessValue.textContent = stiffness.toFixed(0);
    });

    dampingSlider.addEventListener('input', () => {
        damping = parseFloat(dampingSlider.value);
        dampingValue.textContent = damping.toFixed(0);
    });

    flatnessSlider.addEventListener('input', () => {
        flatness = parseFloat(flatnessSlider.value);
        flatnessValue.textContent = flatness.toFixed(1);
    });

    pauseSlider.addEventListener('input', () => {
        flatPauseDuration = parseInt(pauseSlider.value, 10);
        pauseValue.textContent = flatPauseDuration.toString();
    });
}