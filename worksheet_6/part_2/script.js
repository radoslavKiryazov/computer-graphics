"use strict";
window.onload = function () { main(); }

async function main() {
    // WebGPU initialisation
    if (!navigator.gpu) { alert("WebGPU not supported."); return; }
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const canvas = document.getElementById('webgpu');
    const context = canvas.getContext('webgpu');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: canvasFormat });

    // Load WGSL 
    const wgslFile = document.getElementById('wgsl').src;
    const wgslCode = await fetch(wgslFile, { cache: "reload" }).then(r => r.text());
    const wgsl = device.createShaderModule({ code: wgslCode });

    // Quad geometry
    const positions = new Float32Array([
        -4.0, -1.0, -1.0,
        4.0, -1.0, -1.0,
        4.0, -1.0, -21.0,
        -4.0, -1.0, -21.0,
    ]);

    const texCoords = new Float32Array([
        -1.5, 0.0,
        2.5, 0.0,
        2.5, 10.0,
        -1.5, 10.0,
    ]);

    const indices = new Uint16Array([
        0, 1, 2,
        0, 2, 3
    ]);

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

    const positionBuffer = createBuffer(positions, GPUBufferUsage.VERTEX);
    const texCoordBuffer = createBuffer(texCoords, GPUBufferUsage.VERTEX);
    const indexBuffer = createBuffer(indices, GPUBufferUsage.INDEX);

    // Generate 64x64 checkerboard texture
    const texSize = 64;
    const numRows = 8;
    const numCols = 8;
    const myTexels = new Uint8Array(4 * texSize * texSize);

    for (let i = 0; i < texSize; ++i) {
        for (let j = 0; j < texSize; ++j) {
            const patchx = Math.floor(i / (texSize / numRows));
            const patchy = Math.floor(j / (texSize / numCols));
            const c = (patchx % 2 !== patchy % 2) ? 255 : 0;
            const idx = 4 * (i * texSize + j);

            myTexels[idx] = c;   // R
            myTexels[idx + 1] = c;   // G
            myTexels[idx + 2] = c;   // B
            myTexels[idx + 3] = 255; // A
        }
    }

    const mipLevelCount = numMipLevels(texSize, texSize); // from genmipmap.js

    const texture = device.createTexture({
        size: [texSize, texSize, 1],
        format: 'rgba8unorm',
        mipLevelCount: mipLevelCount,
        usage: GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });

    device.queue.writeTexture(
        { texture: texture },
        myTexels,
        { offset: 0, bytesPerRow: texSize * 4, rowsPerImage: texSize },
        [texSize, texSize, 1]
    );

    // Generate lower resolution mip levels using genmipmap.js
    generateMipmap(device, texture);

    // Perspective Projection & View Matrices
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
    const fov = (90 * Math.PI) / 180;
    const projectionMatrix = createPerspectiveMatrix(fov, aspect, 0.1, 100.0);

    const viewMatrix = new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1
    ]);

    const uniformBuffer = device.createBuffer({
        size: 2 * 16 * 4,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    device.queue.writeBuffer(uniformBuffer, 0, projectionMatrix);
    device.queue.writeBuffer(uniformBuffer, 64, viewMatrix);

    // Bind Group Layout
    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
            { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
            { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: {} },
        ]
    });

    const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [bindGroupLayout]
    });

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
                    arrayStride: 2 * Float32Array.BYTES_PER_ELEMENT,
                    attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }],
                }
            ]
        },
        fragment: {
            module: wgsl,
            entryPoint: 'main_fs',
            targets: [{ format: canvasFormat }]
        },
        primitive: { topology: 'triangle-list' }
    });

    let bindGroup;

    // Dynamic Sampler Creation based on UI controls
    function updateSampler() {
        const addressMode = document.getElementById('wrapMode').value;
        const minFilter = document.getElementById('minFilter').value;
        const magFilter = document.getElementById('magFilter').value;
        const mipmapFilter = document.getElementById('mipmapFilter').value;
        const useMipmap = document.getElementById('enableMipmap').checked;

        // Create sampler with or without mipmapFilter depending on checkbox
        const sampler = device.createSampler({
            addressModeU: addressMode,
            addressModeV: addressMode,
            minFilter: minFilter,
            magFilter: magFilter,
            mipmapFilter: useMipmap ? mipmapFilter : undefined,
        });

        bindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: uniformBuffer } },
                { binding: 1, resource: sampler },
                { binding: 2, resource: texture.createView() },
            ]
        });

        requestAnimationFrame(render);
    }

    // Attach listeners to DOM controls
    ['wrapMode', 'minFilter', 'magFilter', 'mipmapFilter', 'enableMipmap'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', updateSampler);
    });

    // Render pass
    function render() {
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: 'clear',
                clearValue: { r: 0.0, g: 0.0, b: 1.0, a: 1.0 },
                storeOp: 'store',
            }]
        });

        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, positionBuffer);
        pass.setVertexBuffer(1, texCoordBuffer);
        pass.setIndexBuffer(indexBuffer, 'uint16');
        pass.drawIndexed(indices.length);
        pass.end();

        device.queue.submit([encoder.finish()]);
    }

    // Initial sampler setup & draw
    updateSampler();
}