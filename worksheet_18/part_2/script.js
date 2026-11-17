"use strict";
window.onload = function () { main(); }

async function main() {
    if (!navigator.gpu) { alert("WebGPU not supported."); return; }
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const canvas = document.getElementById('webgpu');

    // Ensure canvas drawing dimensions match its display size
    canvas.width = canvas.clientWidth || 800;
    canvas.height = canvas.clientHeight || 600;

    const context = canvas.getContext('webgpu');
    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: canvasFormat });

    const wgslFile = document.getElementById('wgsl').src;
    const wgslCode = await fetch(wgslFile, { cache: "reload" }).then(r => r.text());
    const wgsl = device.createShaderModule({ code: wgslCode });

    // Load PLY file using readPlyFile[cite: 26]
    const plyElements = await readPlyFile('../lego-splats/lego-2d-sorted.ply');
    const splatElement = plyElements[0]; // Gaussian splats element[cite: 26]

    // Create and copy binary data to GPU vertex buffer[cite: 26]
    const vertexBuffer = device.createBuffer({
        size: (splatElement.data.byteLength + 3) & ~3,
        usage: GPUBufferUsage.VERTEX,
        mappedAtCreation: true,
    });
    new Uint8Array(vertexBuffer.getMappedRange()).set(splatElement.data);
    vertexBuffer.unmap();

    const instanceCount = splatElement.count;

    // Canvas Resolution Uniform Buffer[cite: 26]
    const resolutionBuffer = device.createBuffer({
        size: 8,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(resolutionBuffer, 0, new Float32Array([canvas.width, canvas.height]));

    const bindGroupLayout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }
        ]
    });

    const bindGroup = device.createBindGroup({
        layout: bindGroupLayout,
        entries: [
            { binding: 0, resource: { buffer: resolutionBuffer } }
        ]
    });

    const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });

    const pipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: {
            module: wgsl,
            entryPoint: 'main_vs',
            buffers: [{
                arrayStride: splatElement.stride, // Dynamic PLY element stride[cite: 26]
                stepMode: 'instance',
                attributes: [
                    { shaderLocation: 0, offset: 0, format: 'float32x3' }, // Position (x, y, depth)[cite: 26]
                    { shaderLocation: 1, offset: 12, format: 'float32x2' }, // Half side lengths (sx, sy)[cite: 26]
                    { shaderLocation: 2, offset: 20, format: 'float32x2' }, // Direction 1 (d1x, d1y)[cite: 26]
                    { shaderLocation: 3, offset: 28, format: 'float32x2' }, // Direction 2 (d2x, d2y)[cite: 26]
                    { shaderLocation: 4, offset: 36, format: 'float32x4' }, // Color (rgba)[cite: 26]
                    { shaderLocation: 5, offset: 52, format: 'float32' }, // Opacity[cite: 26]
                ]
            }]
        },
        fragment: {
            module: wgsl,
            entryPoint: 'main_fs',
            targets: [{
                format: canvasFormat,
                blend: {
                    color: {
                        srcFactor: 'src-alpha',
                        dstFactor: 'one-minus-src-alpha',
                        operation: 'add',
                    },
                    alpha: {
                        srcFactor: 'one',
                        dstFactor: 'one-minus-src-alpha',
                        operation: 'add',
                    }
                }
            }]
        },
        primitive: {
            topology: 'triangle-strip',
        }
    });

    function render() {
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: 'clear',
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                storeOp: 'store',
            }]
        });

        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.setVertexBuffer(0, vertexBuffer);
        pass.draw(4, instanceCount);
        pass.end();

        device.queue.submit([encoder.finish()]);
    }

    render();
}