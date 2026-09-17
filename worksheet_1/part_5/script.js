"use strict";
window.onload = function () { main(); }

const add_circle = (array, center, radius, segments) => {
    for (let i = 0; i < segments; i++) {
        const theta0 = (i / segments) * 2 * Math.PI;
        const theta1 = ((i + 1) / segments) * 2 * Math.PI;
        const p0 = vec2(center[0] + radius * Math.cos(theta0), center[1] + radius * Math.sin(theta0));
        const p1 = vec2(center[0] + radius * Math.cos(theta1), center[1] + radius * Math.sin(theta1));
        array.push(center);
        array.push(p0);
        array.push(p1);
    }
}

async function main() {

    //Initialize WebGPU
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

    // Create a shader module from the WGSL code in the HTML

    const wgslfile = document.getElementById('wgsl').src;
    const wgslcode
        = await fetch(wgslfile, { cache: "reload" }).then(r => r.text());
    const wgsl = device.createShaderModule({
        code: wgslcode
    });

    const radius = 0.5;
    const segments = 64;
    const baseY = -0.7;

    // Create a buffer with the positions of the triangle's 3 vertices
    var positions = [];
    add_circle(positions, [0.0, baseY], radius, segments);

    const positionBufferLayout = {
        arrayStride: sizeof['vec2'],
        attributes: [{
            format: 'float32x2',
            offset: 0,
            shaderLocation: 0,
        }]
    }

    const positionBuffer = device.createBuffer({
        size: flatten(positions).byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(positionBuffer, 0, flatten(positions));

    const uniformBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wgsl,
            entryPoint: 'main_vs',
            buffers: [positionBufferLayout]
        },
        fragment: {
            module: wgsl,
            entryPoint: 'main_fs',
            targets: [{ format: canvasFormat }]
        },
        primitive: {
            topology: 'triangle-list'
        }
    });

    const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
    })

    const amplitude = 0.6;
    const speed = 2.0;


    const render = (timeMs) => {
        const time = timeMs / 1000 * speed;
        const offsetY = amplitude * Math.abs(Math.sin(time));

        // device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([Math.cos(angle), Math.sin(angle), 0, 0]));
        device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([offsetY, 0, 0, 0]));
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: 'clear',
                storeOp: 'store',
                clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 },
            }],
        });

        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, positionBuffer);
        pass.draw(positions.length);
        pass.end();

        device.queue.submit([encoder.finish()]);

        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
}