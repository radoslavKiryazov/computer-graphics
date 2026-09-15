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
    var colors = [];
    const point_size = 10 * (2 / canvas.height);

    add_point(positions, vec2(1.0, 1.0), point_size);
    add_color(colors, vec3(1.0, 0.0, 0.0), 6); // red

    add_point(positions, vec2(0.0, 0.0), point_size);
    add_color(colors, vec3(0.0, 1.0, 0.0), 6); // green 

    add_point(positions, vec2(1.0, 0.0), point_size);
    add_color(colors, vec3(0.0, 0.0, 1.0), 6); // blue

    positions.push(vec2(1.0, 1.0), vec2(0.0, 0.0), vec2(1.0, 0.0));
    colors.push(vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), vec3(0.0, 0.0, 1.0));


    const positionBuffer = device.createBuffer({
        size: flatten(positions).byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(positionBuffer, /*bufferOffset=*/0, flatten(positions));
    const positionBufferLayout = {
        arrayStride: sizeof['vec2'],
        attributes: [{
            format: 'float32x2',
            offset: 0,
            shaderLocation: 0, // Position, see vertex shader
        }],
    };

    const colorBuffer = device.createBuffer({
        size: flatten(colors).byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(colorBuffer, /*bufferOffset=*/0, flatten(colors));
    const colorBufferLayout = {
        arrayStride: sizeof['vec3'],
        attributes: [{
            format: 'float32x3',
            offset: 0,
            shaderLocation: 1, // Color, see vertex shader
        }],
    };

    // Create a render pipeline with the shader module and both buffer layouts
    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wgsl,
            entryPoint: 'main_vs',
            buffers: [positionBufferLayout, colorBufferLayout],
        },
        fragment: {
            module: wgsl,
            entryPoint: 'main_fs',
            targets: [{ format: canvasFormat }],
        },
        primitive: { topology: 'triangle-list', },
    });

    // Create a render pass in a command buffer and submit it
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
        colorAttachments: [{
            view: context.getCurrentTexture().createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0.3921, g: 0.5843, b: 0.9294, a: 1.0 },
        }],
    });

    // Insert render pass commands here
    pass.setPipeline(pipeline);
    pass.setVertexBuffer(0, positionBuffer);
    pass.setVertexBuffer(1, colorBuffer);
    pass.draw(positions.length);
    pass.end();

    device.queue.submit([encoder.finish()]);
}