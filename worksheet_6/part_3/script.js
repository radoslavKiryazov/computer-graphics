"use strict";
window.onload = function () { main(); }

async function main() {
    if (!navigator.gpu) { alert("WebGPU not supported."); return; }
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const canvas = document.getElementById('webgpu');
    const context = canvas.getContext('webgpu');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: canvasFormat });

    const wgslFile = document.getElementById('wgsl').src;
    const wgslCode = await fetch(wgslFile, { cache: "reload" }).then(r => r.text());
    const wgsl = device.createShaderModule({ code: wgslCode });

    // Generate Sphere Geometry
    function createSphere(radius, subdivisionLat, subdivisionLong) {
        const positions = [];
        const normals = [];
        const indices = [];

        for (let lat = 0; lat <= subdivisionLat; lat++) {
            const theta = (lat * Math.PI) / subdivisionLat;
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);

            for (let long = 0; long <= subdivisionLong; long++) {
                const phi = (long * 2 * Math.PI) / subdivisionLong;
                const sinPhi = Math.sin(phi);
                const cosPhi = Math.cos(phi);

                const x = cosPhi * sinTheta;
                const y = cosTheta;
                const z = sinPhi * sinTheta;

                positions.push(radius * x, radius * y, radius * z);
                normals.push(x, y, z);
            }
        }

        for (let lat = 0; lat < subdivisionLat; lat++) {
            for (let long = 0; long < subdivisionLong; long++) {
                const first = lat * (subdivisionLong + 1) + long;
                const second = first + subdivisionLong + 1;

                indices.push(first, second, first + 1);
                indices.push(second, second + 1, first + 1);
            }
        }

        return {
            positions: new Float32Array(positions),
            normals: new Float32Array(normals),
            indices: new Uint16Array(indices)
        };
    }

    const sphere = createSphere(1.5, 64, 64);

    function createBuffer(data, usage) {
        const buffer = device.createBuffer({
            size: (data.byteLength + 3) & ~3,
            usage: usage,
            mappedAtCreation: true,
        });
        new data.constructor(buffer.getMappedRange()).set(data);
        buffer.unmap();
        return buffer;
    }

    const positionBuffer = createBuffer(sphere.positions, GPUBufferUsage.VERTEX);
    const normalBuffer = createBuffer(sphere.normals, GPUBufferUsage.VERTEX);
    const indexBuffer = createBuffer(sphere.indices, GPUBufferUsage.INDEX);

    // Asynchronously Load earth.jpg Image
    const response = await fetch('earth.jpg');
    const blob = await response.blob();
    const img = await createImageBitmap(blob, { colorSpaceConversion: 'none' });

    const mipLevelCount = numMipLevels(img.width, img.height); // from genmipmap.js

    const texture = device.createTexture({
        size: [img.width, img.height, 1],
        format: 'rgba8unorm',
        mipLevelCount: mipLevelCount,
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    device.queue.copyExternalImageToTexture(
        { source: img, flipY: false },
        { texture: texture },
        { width: img.width, height: img.height }
    );

    generateMipmap(device, texture);

    // Perspective Matrix
    function createPerspectiveMatrix(fovRadians, aspect, near, far) {
        const f = 1.0 / Math.tan(fovRadians / 2);
        const rangeInv = 1.0 / (near - far);
        return new Float32Array([
            f / aspect, 0, 0, 0,
            0, f, 0, 0,
            0, 0, far * rangeInv, -1,
            0, 0, near * far * rangeInv, 0
        ]);
    }

    const aspect = canvas.width / canvas.height;
    const projectionMatrix = createPerspectiveMatrix((45 * Math.PI) / 180, aspect, 0.1, 100.0);

    const uniformBuffer = device.createBuffer({
        size: 2 * 16 * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(uniformBuffer, 0, projectionMatrix);

    // Camera Orbit State Controls
    let rotX = 0;
    let rotY = 0;
    let isDragging = false;
    let lastMouseX = 0;
    let lastMouseY = 0;

    canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    });

    window.addEventListener('mouseup', () => { isDragging = false; });

    canvas.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - lastMouseX;
        const dy = e.clientY - lastMouseY;

        rotY += dx * 0.005;
        rotX += dy * 0.005;

        // Clamp pitch to avoid flipping
        rotX = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, rotX));

        lastMouseX = e.clientX;
        lastMouseY = e.clientY;

        requestAnimationFrame(render);
    });

    // Helper to compute View Matrix from Orbit angles
    function updateViewMatrix() {
        const distance = 4.5;
        const eyeX = distance * Math.sin(rotY) * Math.cos(rotX);
        const eyeY = distance * Math.sin(rotX);
        const eyeZ = distance * Math.cos(rotY) * Math.cos(rotX);

        // Simple LookAt Matrix (looking at origin)
        const z = normalize([eyeX, eyeY, eyeZ]);
        const x = normalize(cross([0, 1, 0], z));
        const y = cross(z, x);

        const viewMatrix = new Float32Array([
            x[0], y[0], z[0], 0,
            x[1], y[1], z[1], 0,
            x[2], y[2], z[2], 0,
            -dot(x, [eyeX, eyeY, eyeZ]), -dot(y, [eyeX, eyeY, eyeZ]), -dot(z, [eyeX, eyeY, eyeZ]), 1
        ]);

        device.queue.writeBuffer(uniformBuffer, 64, viewMatrix);
    }

    function subtract(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
    function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
    function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    function normalize(v) {
        const len = Math.hypot(v[0], v[1], v[2]);
        return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0];
    }

    // Trilinear Sampler for smooth minification
    const sampler = device.createSampler({
        addressModeU: 'repeat',
        addressModeV: 'clamp-to-edge',
        minFilter: 'linear',
        magFilter: 'linear',
        mipmapFilter: 'linear',
    });

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        ]
    });

    const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: texture.createView() },
        ]
    });

    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

    const pipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
            module: wgsl,
            entryPoint: 'main_vs',
            buffers: [
                {
                    arrayStride: 3 * Float32Array.BYTES_PER_ELEMENT,
                    attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }],
                },
                {
                    arrayStride: 3 * Float32Array.BYTES_PER_ELEMENT,
                    attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }],
                }
            ]
        },
        fragment: {
            module: wgsl,
            entryPoint: 'main_fs',
            targets: [{ format: canvasFormat }]
        },
        primitive: { topology: 'triangle-list' },
        depthStencil: {
            depthWriteEnabled: true,
            depthCompare: 'less',
            format: 'depth24plus',
        }
    });

    const depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    function render() {
        updateViewMatrix();

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: 'clear',
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 }, // Solid Black Background
                storeOp: 'store',
            }],
            depthStencilAttachment: {
                view: depthTexture.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            }
        });

        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, positionBuffer);
        pass.setVertexBuffer(1, normalBuffer);
        pass.setIndexBuffer(indexBuffer, 'uint16');
        pass.drawIndexed(sphere.indices.length);
        pass.end();

        device.queue.submit([encoder.finish()]);
    }

    render();
}