"use strict";
window.onload = function () { main(); }

//helper
const add_point = (array, point, size) => {
    const offset = size / 2;
    var point_coords = [vec2(point[0] - offset, point[1] - offset), vec2(point[0] + offset, point[1] - offset),
    vec2(point[0] - offset, point[1] + offset), vec2(point[0] - offset, point[1] + offset),
    vec2(point[0] + offset, point[1] - offset), vec2(point[0] + offset, point[1] + offset)];
    array.push.apply(array, point_coords);
}

const add_color = (array, color, count) => {
    for (let i = 0; i < count; i++) {
        array.push(color);
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

    // Create a buffer with the positions of the triangle's 3 vertices
    var positions = [];
    positions.push(vec2(-0.5, -0.5));
    positions.push(vec2(0.5, -0.5));
    positions.push(vec2(-0.5, 0.5));

    positions.push(vec2(-0.5, 0.5));
    positions.push(vec2(0.5, -0.5));
    positions.push(vec2(0.5, 0.5));

    const uniformBuffer = device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

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

    const render = (timeMs) => {
        const angle = timeMs / 1000;

        // device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([Math.cos(angle), Math.sin(angle), 0, 0]));
        device.queue.writeBuffer(uniformBuffer, 0, new Float32Array([angle, 0, 0, 0]));

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