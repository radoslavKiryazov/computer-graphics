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
    if (!navigator.gpu) { alert("WebGPU not supported."); return; }
    const adapter = await gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const canvas = document.getElementById('webgpu');
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
    // ---------- Geometry: unit cube, diagonal (0,0,0) to (1,1,1) ----------
    const positions = [
        vec3(0.0, 0.0, 1.0), // v0
        vec3(0.0, 1.0, 1.0), // v1
        vec3(1.0, 1.0, 1.0), // v2
        vec3(1.0, 0.0, 1.0), // v3
        vec3(0.0, 0.0, 0.0), // v4
        vec3(0.0, 1.0, 0.0), // v5
        vec3(1.0, 1.0, 0.0), // v6
        vec3(1.0, 0.0, 0.0), // v7
    ];
    const wire_indices = new Uint32Array([
        0, 1, 1, 2, 2, 3, 3, 0, // front
        2, 3, 3, 7, 7, 6, 6, 2, // right
        0, 3, 3, 7, 7, 4, 4, 0, // down
        1, 2, 2, 6, 6, 5, 5, 1, // up
        4, 5, 5, 6, 6, 7, 7, 4, // back
        0, 1, 1, 5, 5, 4, 4, 0  // left
    ]);

    const positionBuffer = device.createBuffer({
        size: 8 * 3 * 4,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(positionBuffer, 0, flatten(positions));

    const indexBuffer = device.createBuffer({
        size: wire_indices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(indexBuffer, 0, wire_indices);

    // ---------- Pipeline (line-list for wireframe) ----------
    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wgsl,
            entryPoint: 'main_vs',
            buffers: [{
                arrayStride: 12,
                attributes: [{ format: 'float32x3', offset: 0, shaderLocation: 0 }],
            }],
        },
        fragment: { module: wgsl, entryPoint: 'main_fs', targets: [{ format: canvasFormat }] },
        primitive: { topology: 'line-list' },
    });

    const uniformBuffer = device.createBuffer({
        size: 3 * 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });

    // Matrices
    const aspect = canvas.width / canvas.height;

    // WebGPU depth is [0,1]; the conventional matrices give [-1,1].
    const M_st = mat4(1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0);

    const c = vec3(0.5, 0.5, 0.5); // cube center
    // Apply rotation R about the cube center: T(c) * R * T(-c)
    function aboutCenter(R) {
        return mult(translate(c[0], c[1], c[2]), mult(R, translate(-c[0], -c[1], -c[2])));
    }

    // camera
    const eye = vec3(c[0], c[1], 8.0);
    const V = lookAt(eye, c, vec3(0.0, 1.0, 0.0));
    const P = perspective(45.0, aspect, 0.1, 20.0);
    const PV = mult(M_st, mult(P, V));

    // model matrices.
    const M1 = translate(-2.2, 0.0, 0.0);                                                        // one-point
    const M2 = aboutCenter(rotateY(45.0));                                                       // two-point
    const M3 = mult(translate(2.2, 0.0, 0.0), aboutCenter(mult(rotateX(35.0), rotateY(45.0)))); // three-point

    const data = new Float32Array(48);
    [M1, M2, M3].forEach((M, i) => data.set(flatten(mult(PV, M)), 16 * i));
    device.queue.writeBuffer(uniformBuffer, 0, data);

    // render
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 1.0, g: 1.0, b: 1.0, a: 1.0 },
        }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.setVertexBuffer(0, positionBuffer);
    pass.setIndexBuffer(indexBuffer, 'uint32');
    pass.drawIndexed(wire_indices.length, 3); // three instances
    pass.end();
    device.queue.submit([encoder.finish()]);
}