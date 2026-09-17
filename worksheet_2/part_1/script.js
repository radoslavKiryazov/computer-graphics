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

    // world
    const radius = 0.15;
    const floorY = -0.9;
    const gravity = -2.5;   // clip-space units / s^2
    const dt = 1 / 60;

    let ballY = floorY + radius;
    // Axis-aligned rectangle (two triangles) from (x0,y0) to (x1,y1).
    let ballVY = 0;
    let running = true;
    let jumpVelocity = parseFloat(document.getElementById('velocity-slider').value);

    // ---- Geometry ----
    // Ball is built centered on the origin; the shader translates it by ballY.
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
        size: 16,
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

    // physics
    function physicsStep() {
        ballVY += gravity * dt;
        ballY += ballVY * dt;
        if (ballY <= floorY + radius) {
            ballY = floorY + radius;
            ballVY = jumpVelocity; // relaunch with the current slider value
        }
    }

    // render
    function render() {
        device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([ballY, 0, 0, 0]));

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
        if (running) {
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

    stepBtn.disabled = running;

    toggleBtn.addEventListener('click', () => {
        running = !running;
        toggleBtn.textContent = running ? 'Stop' : 'Start';
        stepBtn.disabled = running;
    });

    stepBtn.addEventListener('click', () => {
        if (!running) {
            physicsStep();
        }
    });

    slider.addEventListener('input', () => {
        jumpVelocity = parseFloat(slider.value);
        valueLabel.textContent = jumpVelocity.toFixed(1);
    });
}
