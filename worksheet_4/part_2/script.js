"use strict";
window.onload = function () { main(); }

const MAX_SUBDIVS = 8;
let level = 0;

// Tetrahedron with vertices on the unit sphere
const M_SQRT2 = Math.sqrt(2.0);
const M_SQRT6 = Math.sqrt(6.0);
const positions = [
    vec3(0.0, 0.0, 1.0),
    vec3(0.0, 2.0 * M_SQRT2 / 3.0, -1.0 / 3.0),
    vec3(-M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
    vec3(M_SQRT6 / 3.0, -M_SQRT2 / 3.0, -1.0 / 3.0),
];
let indices = new Uint32Array([0, 1, 2, 0, 3, 1, 1, 3, 2, 0, 2, 3]);

function subdivide_sphere(positions, indices) {
    const new_indices = new Uint32Array(indices.length * 4);
    const triangles = indices.length / 3;
    let idx = triangles;                       // V_k = Δ_k
    for (let i = 0; i < triangles; ++i) {
        const i0 = indices[i * 3], i1 = indices[i * 3 + 1], i2 = indices[i * 3 + 2];
        const c01 = idx, c12 = idx + 1, c20 = idx + 2;
        idx += 3;
        if (idx > positions.length) {          // create midpoints only the first time
            positions.push(normalize(add(positions[i0], positions[i1])));
            positions.push(normalize(add(positions[i1], positions[i2])));
            positions.push(normalize(add(positions[i2], positions[i0])));
        }
        new_indices.set([i0, c01, c20,
            c20, c01, c12,
            c12, c01, i1,
            c20, c12, i2], i * 12);
    }
    return new_indices;
}

function coarsen_sphere(indices) {
    // In each group of 12 indices the parent corners are at offsets 0, 8, 11
    const new_indices = new Uint32Array(indices.length / 4);
    for (let i = 0; i < new_indices.length / 3; ++i) {
        new_indices[i * 3] = indices[i * 12];
        new_indices[i * 3 + 1] = indices[i * 12 + 8];
        new_indices[i * 3 + 2] = indices[i * 12 + 11];
    }
    return new_indices;
}

async function main() {
    // Initialize WebGPU
    if (!navigator.gpu) { alert("WebGPU not supported."); return; }
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const canvas = document.getElementById('webgpu');
    const context = canvas.getContext('webgpu');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device: device, format: canvasFormat });

    const wgslfile = document.getElementById('wgsl').src;
    const wgslcode = await fetch(wgslfile, { cache: "reload" }).then(r => r.text());
    const wgsl = device.createShaderModule({ code: wgslcode });

    // Pipeline: triangle-list instead of line-list
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
        primitive: { topology: 'triangle-list', frontFace: 'cw', cullMode: 'front' },
        depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
    });

    const depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: 'depth24plus',
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // Buffers pre-allocated for MAX_SUBDIVS: 4^(M+1) vertices, 3*4^(M+1) indices
    const positionBuffer = device.createBuffer({
        size: 12 * Math.pow(4, MAX_SUBDIVS + 1),
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    const indexBuffer = device.createBuffer({
        size: 4 * 3 * Math.pow(4, MAX_SUBDIVS + 1),
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    const uniformBuffer = device.createBuffer({
        size: 64,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
    });

    // Matrices (one sphere at the origin, camera on the z-axis)
    const aspect = canvas.width / canvas.height;
    const M_st = mat4(1.0, 0.0, 0.0, 0.0,
        0.0, 1.0, 0.0, 0.0,
        0.0, 0.0, 0.5, 0.5,
        0.0, 0.0, 0.0, 1.0);
    const V = lookAt(vec3(0.0, 0.0, 3.0), vec3(0.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0));
    const P = perspective(45.0, aspect, 0.1, 20.0);
    device.queue.writeBuffer(uniformBuffer, 0, flatten(mult(M_st, mult(P, V))));

    function render() {
        device.queue.writeBuffer(positionBuffer, 0, flatten(positions));
        device.queue.writeBuffer(indexBuffer, 0, indices);

        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0.2555, g: 0.1822, b: 0.1933, a: 1.0 },
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
        pass.setIndexBuffer(indexBuffer, 'uint32');
        pass.drawIndexed(indices.length);
        pass.end();
        device.queue.submit([encoder.finish()]);
    }

    document.getElementById('subdivide').onclick = () => {
        if (level < MAX_SUBDIVS) {
            indices = subdivide_sphere(positions, indices);
            level++;
            render();
        }
    };
    document.getElementById('coarsen').onclick = () => {
        if (level > 0) {
            indices = coarsen_sphere(indices);
            level--;
            render();
        }
    };

    render();
}