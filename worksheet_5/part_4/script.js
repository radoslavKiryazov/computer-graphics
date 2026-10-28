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

    // ── Load OBJ mesh ─────────────────────────────────────────────────────────
    // The OBJParser provides:
    //   drawInfo.vertices : Float32Array – vec4 positions  (stride 16 bytes)
    //   drawInfo.normals  : Float32Array – vec4 normals    (stride 16 bytes)
    //   drawInfo.indices  : Uint32Array  – triangle indices
    //
    // Using smooth normals (exported from Blender "Shade Smooth") gives
    // per-vertex interpolated normals → smooth appearance despite flat triangles.
    // Flat (face) normals would produce a faceted look with hard shading edges.
    const drawInfo = await readOBJFile("../../util/suzanne.obj", 1.0, true);
    if (!drawInfo) { alert("Failed to load OBJ file."); return; }

    // ── Render pipeline ───────────────────────────────────────────────────────
    // Phong shading is done in the FRAGMENT shader, so we pass world-space
    // position and normal as varyings from the vertex shader.
    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wgsl,
            entryPoint: 'main_vs',
            buffers: [
                {   // buffer 0 – positions (vec4f)
                    arrayStride: 16,
                    attributes: [{ format: 'float32x4', offset: 0, shaderLocation: 0 }],
                },
                {   // buffer 1 – normals (vec4f)
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

    // Uniform buffer layout (aligned to 16-byte / vec4 boundaries):
    //   offset  0 – mvp       mat4x4f  (64 bytes)
    //   offset 64 – eye       vec4f    (16 bytes)  camera world-space position
    //   offset 80 – params    vec4f    (16 bytes)  x=L_e, y=L_a, z=k_d, w=k_s
    //   offset 96 – shininess f32      ( 4 bytes)
    //   total: 100 bytes → round up to 112 bytes (next multiple of 16)
    const uniformBuffer = device.createBuffer({
        size: 128,   // generous padding, satisfies 256-byte alignment requirement
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });

    // ── Camera / projection ───────────────────────────────────────────────────
    const aspect = canvas.width / canvas.height;
    const M_st = mat4(           // [0,1] depth remapping for WebGPU NDC
        1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0
    );
    const P = perspective(45.0, aspect, 0.1, 20.0);

    const radius = 3.0;
    let alpha = 0.0;
    let orbiting = true;

    // Phong parameters – driven by HTML sliders
    let Le = 1.0, La = 0.1, kd = 0.9, ks = 1.0, shin = 50.0;

    const uniformData = new Float32Array(32);  // 128 bytes / 4

    function updateUniforms() {
        const eye = vec3(radius * Math.sin(alpha), 0.0, radius * Math.cos(alpha));
        const V = lookAt(eye, vec3(0.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0));

        uniformData.set(flatten(mult(M_st, mult(P, V))), 0);    // mvp   (offset  0)
        uniformData.set([eye[0], eye[1], eye[2], 0.0], 16);  // eye   (offset 64)
        uniformData.set([Le, La, kd, ks], 20);  // params(offset 80)
        uniformData[24] = shin;                                  // shin  (offset 96)

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
                clearValue: { r: 0.15, g: 0.15, b: 0.15, a: 1.0 },
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

    // ── Slider helpers ────────────────────────────────────────────────────────
    function hookSlider(id, setter) {
        const el = document.getElementById(id);
        const label = document.getElementById(id + '_val');
        const update = () => { const v = parseFloat(el.value); setter(v); label.textContent = v.toFixed(2); };
        el.addEventListener('input', update);
        update();   // initialise label and variable
    }
    hookSlider('Le', v => Le = v);
    hookSlider('La', v => La = v);
    hookSlider('kd', v => kd = v);
    hookSlider('ks', v => ks = v);
    hookSlider('shin', v => shin = v);

    document.getElementById('orbit').onclick = () => { orbiting = !orbiting; };

    animate();
}
