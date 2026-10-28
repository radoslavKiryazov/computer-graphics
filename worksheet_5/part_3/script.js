"use strict";
window.onload = function () { main(); }

async function main() {
    // ── WebGPU initialisation ─────────────────────────────────────────────────
    if (!navigator.gpu) { alert("WebGPU not supported."); return; }
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const canvas = document.getElementById('webgpu');
    const context = canvas.getContext('webgpu');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: canvasFormat });

    // ── Load WGSL shader ──────────────────────────────────────────────────────
    const wgslFile = document.getElementById('wgsl').src;
    const wgslCode = await fetch(wgslFile, { cache: "reload" }).then(r => r.text());
    const wgsl = device.createShaderModule({ code: wgslCode });

    // ── Load OBJ mesh via OBJParser.js ────────────────────────────────────────
    // readOBJFile(filename, scale, reverse) parses the OBJ file and directly
    // returns a DrawingInfo object — no second .getDrawingInfo() call needed.
    //
    // DrawingInfo fields:
    //   .vertices  Float32Array – flat array of vec4 positions (stride 16 bytes)
    //   .normals   Float32Array – flat array of vec4 normals   (stride 16 bytes)
    //   .colors    Float32Array – flat array of vec4 colours   (stride 16 bytes)
    //   .indices   Uint32Array  – triangle indices
    //
    // reverse=true flips computed face normals so they point outward given the
    // coordinate conventions of the OBJ exporter.
    const drawInfo = await readOBJFile("../../util/suzanne.obj", 1.0, true);
    if (!drawInfo) { alert("Failed to load OBJ file."); return; }

    // ── Render pipeline ───────────────────────────────────────────────────────
    // Two separate vertex buffers: positions (slot 0) and normals (slot 1).
    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wgsl,
            entryPoint: 'main_vs',
            buffers: [
                {   // slot 0 – positions (vec4f → 16 bytes per vertex)
                    arrayStride: 16,
                    attributes: [{ format: 'float32x4', offset: 0, shaderLocation: 0 }],
                },
                {   // slot 1 – normals (vec4f → 16 bytes per vertex)
                    arrayStride: 16,
                    attributes: [{ format: 'float32x4', offset: 0, shaderLocation: 1 }],
                },
            ],
        },
        fragment: {
            module: wgsl,
            entryPoint: 'main_fs',
            targets: [{ format: canvasFormat }],
        },
        primitive: { topology: 'triangle-list', frontFace: 'ccw', cullMode: 'back' },
        depthStencil: {
            format: 'depth24plus',
            depthWriteEnabled: true,
            depthCompare: 'less',
        },
    });

    // ── Depth texture ─────────────────────────────────────────────────────────
    const depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // ── GPU buffers ───────────────────────────────────────────────────────────
    const positionBuffer = device.createBuffer({
        size: drawInfo.vertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(positionBuffer, 0, drawInfo.vertices);

    const normalBuffer = device.createBuffer({
        size: drawInfo.normals.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(normalBuffer, 0, drawInfo.normals);

    const indexBuffer = device.createBuffer({
        size: drawInfo.indices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(indexBuffer, 0, drawInfo.indices);

    // Uniform buffer: mvp mat4x4f = 64 bytes
    const uniformBuffer = device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });

    // ── Camera / projection ───────────────────────────────────────────────────
    const aspect = canvas.width / canvas.height;
    // WebGPU NDC depth is [0, 1]; apply half-z remapping via M_st
    const M_st = mat4(
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0
    );
    const P = perspective(45.0, aspect, 0.1, 20.0);

    const radius = 3.0;
    let alpha = 0.0;
    let orbiting = true;

    const uniformData = new Float32Array(16);

    function updateUniforms() {
        const eye = vec3(radius * Math.sin(alpha), 0.0, radius * Math.cos(alpha));
        const V = lookAt(eye, vec3(0.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0));
        uniformData.set(flatten(mult(M_st, mult(P, V))), 0);
        device.queue.writeBuffer(uniformBuffer, 0, uniformData);
    }

    // ── Render loop ───────────────────────────────────────────────────────────
    function render() {
        updateUniforms();

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0.2, g: 0.2, b: 0.2, a: 1.0 },
            }],
            depthStencilAttachment: {
                view: depthTexture.createView(),
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
                depthClearValue: 1.0,
            },
        });

        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, positionBuffer);
        pass.setVertexBuffer(1, normalBuffer);
        pass.setIndexBuffer(indexBuffer, 'uint32');
        pass.drawIndexed(drawInfo.indices.length);
        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    function animate() {
        if (orbiting) alpha += 0.01;
        render();
        requestAnimationFrame(animate);
    }

    document.getElementById('orbit').onclick = () => { orbiting = !orbiting; };

    animate();
}
