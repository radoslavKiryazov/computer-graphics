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

    // Frame-filling Background Quad Geometry in Clip Coordinates (z = 0.999)[cite: 7, 22]
    const quadPositions = new Float32Array([
        -1.0, -1.0, 0.999,
        1.0, -1.0, 0.999,
        -1.0, 1.0, 0.999,
        1.0, 1.0, 0.999,
    ]);
    const quadNormals = new Float32Array([
        0.0, 0.0, 1.0,
        0.0, 0.0, 1.0,
        0.0, 0.0, 1.0,
        0.0, 0.0, 1.0,
    ]);
    const quadIndices = new Uint16Array([0, 1, 2, 2, 1, 3]);

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

    const quadPositionBuffer = createBuffer(quadPositions, GPUBufferUsage.VERTEX);
    const quadNormalBuffer = createBuffer(quadNormals, GPUBufferUsage.VERTEX);
    const quadIndexBuffer = createBuffer(quadIndices, GPUBufferUsage.INDEX);

    const cubemapFiles = [
        '../cubemaps/terrain_cubemap/terrain_posx.png',   // POSITIVE_X[cite: 22]
        '../cubemaps/terrain_cubemap/terrain_negx.png',  // NEGATIVE_X[cite: 22]
        '../cubemaps/terrain_cubemap/terrain_posy.png',    // POSITIVE_Y[cite: 22]
        '../cubemaps/terrain_cubemap/terrain_negy.png', // NEGATIVE_Y[cite: 22]
        '../cubemaps/terrain_cubemap/terrain_posz.png',   // POSITIVE_Z[cite: 22]
        '../cubemaps/terrain_cubemap/terrain_negz.png'   // NEGATIVE_Z[cite: 22]
    ];

    const imgs = await Promise.all(
        cubemapFiles.map(async (filename) => {
            const response = await fetch(filename);
            const blob = await response.blob();
            return await createImageBitmap(blob, { colorSpaceConversion: 'none' });
        })
    );

    const texture = device.createTexture({
        dimension: '2d',
        size: [imgs[0].width, imgs[0].height, 6],
        format: 'rgba8unorm',
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    for (let i = 0; i < imgs.length; ++i) {
        device.queue.copyExternalImageToTexture(
            { source: imgs[i], flipY: false },
            { texture: texture, origin: [0, 0, i] },
            { width: imgs[i].width, height: imgs[i].height }
        );
    }

    // Static Perspective & Inverse Projection Calculations
    const aspect = canvas.width / canvas.height;
    const fovRadians = (45 * Math.PI) / 180;
    const near = 0.1, far = 100.0;
    const f = 1.0 / Math.tan(fovRadians / 2);
    const rangeInv = 1.0 / (near - far);

    const projectionMatrix = new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, far * rangeInv, -1,
        0, 0, near * far * rangeInv, 0
    ]);

    const invProj = new Float32Array([
        aspect / f, 0, 0, 0,
        0, 1.0 / f, 0, 0,
        0, 0, 0, (near - far) / (near * far),
        0, 0, -1.0, 1.0 / near
    ]);

    function multiplyMat4(a, b) {
        const out = new Float32Array(16);
        for (let col = 0; col < 4; col++) {
            for (let row = 0; row < 4; row++) {
                let sum = 0;
                for (let k = 0; k < 4; k++) {
                    sum += a[k * 4 + row] * b[col * 4 + k];
                }
                out[col * 4 + row] = sum;
            }
        }
        return out;
    }

    // Uniform buffer: mvp (64) + mTex (64) + eyePosition (12) + reflective (4) = 144 bytes
    const uniformBufferSize = 144;
    const sphereUniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const quadUniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Camera Orbit Controls
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
        rotX = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, rotX));

        lastMouseX = e.clientX;
        lastMouseY = e.clientY;

        requestAnimationFrame(render);
    });

    function getCameraState() {
        const distance = 4.5;
        const eyeX = distance * Math.sin(rotY) * Math.cos(rotX);
        const eyeY = distance * Math.sin(rotX);
        const eyeZ = distance * Math.cos(rotY) * Math.cos(rotX);

        const z = normalize([eyeX, eyeY, eyeZ]);
        const x = normalize(cross([0, 1, 0], z));
        const y = cross(z, x);

        const viewMatrix = new Float32Array([
            x[0], y[0], z[0], 0,
            x[1], y[1], z[1], 0,
            x[2], y[2], z[2], 0,
            -dot(x, [eyeX, eyeY, eyeZ]), -dot(y, [eyeX, eyeY, eyeZ]), -dot(z, [eyeX, eyeY, eyeZ]), 1
        ]);

        const invVrot = new Float32Array([
            x[0], x[1], x[2], 0,
            y[0], y[1], y[2], 0,
            z[0], z[1], z[2], 0,
            0, 0, 0, 0
        ]);

        return { viewMatrix, invVrot, eye: [eyeX, eyeY, eyeZ] };
    }

    function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
    function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    function normalize(v) {
        const len = Math.hypot(v[0], v[1], v[2]);
        return len > 0 ? [v[0] / len, v[1] / len, v[2] / len] : [0, 0, 0];
    }

    const sampler = device.createSampler({
        minFilter: 'linear',
        magFilter: 'linear',
        mipmapFilter: 'linear',
    });

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: 'cube' } }
        ]
    });

    const cubeView = texture.createView({ dimension: 'cube' });

    const sphereBindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: sphereUniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: cubeView },
        ]
    });

    const quadBindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: quadUniformBuffer } },
            { binding: 1, resource: sampler },
            { binding: 2, resource: cubeView },
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

    const identityMatrix = new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
    ]);

    function render() {
        const { viewMatrix, invVrot, eye } = getCameraState();
        const sphereMVP = multiplyMat4(projectionMatrix, viewMatrix);
        const quadMTex = multiplyMat4(invVrot, invProj);

        // Update Sphere Uniform Buffer (reflective = 1)[cite: 23]
        const sphereUniformData = new Float32Array(36);
        sphereUniformData.set(sphereMVP, 0);
        sphereUniformData.set(identityMatrix, 16);
        sphereUniformData.set(eye, 32);                             // eyePosition[cite: 10, 23]
        new Uint32Array(sphereUniformData.buffer)[35] = 1;          // reflective = 1[cite: 23]
        device.queue.writeBuffer(sphereUniformBuffer, 0, sphereUniformData);

        // Update Quad Uniform Buffer (reflective = 0)[cite: 23]
        const quadUniformData = new Float32Array(36);
        quadUniformData.set(identityMatrix, 0);
        quadUniformData.set(quadMTex, 16);
        quadUniformData.set(eye, 32);                               // eyePosition[cite: 10, 23]
        new Uint32Array(quadUniformData.buffer)[35] = 0;            // reflective = 0[cite: 23]
        device.queue.writeBuffer(quadUniformBuffer, 0, quadUniformData);

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: 'clear',
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
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

        // 1. Draw Background Quad[cite: 7, 22]
        pass.setBindGroup(0, quadBindGroup);
        pass.setVertexBuffer(0, quadPositionBuffer);
        pass.setVertexBuffer(1, quadNormalBuffer);
        pass.setIndexBuffer(quadIndexBuffer, 'uint16');
        pass.drawIndexed(6);

        // 2. Draw Reflective Sphere[cite: 23]
        pass.setBindGroup(0, sphereBindGroup);
        pass.setVertexBuffer(0, positionBuffer);
        pass.setVertexBuffer(1, normalBuffer);
        pass.setIndexBuffer(indexBuffer, 'uint16');
        pass.drawIndexed(sphere.indices.length);

        pass.end();

        device.queue.submit([encoder.finish()]);
    }

    render();
}