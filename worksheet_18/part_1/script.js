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

    // Instance Data for 3 Points: [Position (xyz), Color (rgba)][cite: 26]
    // Width = 0.5, Alpha = 0.3[cite: 26]
    const instanceData = new Float32Array([
        // Red Point (Offset slightly left)
        -0.2, 0.1, 0.0, 1.0, 0.0, 0.0, 0.3,
        // Green Point (Offset top)
        0.0, 0.3, 0.0, 0.0, 1.0, 0.0, 0.3,
        // Blue Point (Offset right)
        0.2, -0.1, 0.0, 0.0, 0.0, 1.0, 0.3,
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

    const instanceBuffer = createBuffer(instanceData, GPUBufferUsage.VERTEX);

    const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: {
            module: wgsl,
            entryPoint: 'main_vs',
            buffers: [{
                arrayStride: 7 * Float32Array.BYTES_PER_ELEMENT, // 3 floats pos + 4 floats color[cite: 26]
                stepMode: 'instance',                           // Instanced rendering mode[cite: 26]
                attributes: [
                    { shaderLocation: 0, offset: 0, format: 'float32x3' },                            // position
                    { shaderLocation: 1, offset: 3 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x4' } // color
                ]
            }]
        },
        fragment: {
            module: wgsl,
            entryPoint: 'main_fs',
            targets: [{
                format: canvasFormat,
                // Conventional Alpha Blending Configuration[cite: 26]
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
            topology: 'triangle-strip', // 4 vertices per quad instance[cite: 26]
        }
    });

    function render() {
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: 'clear',
                clearValue: { r: 0.1, g: 0.1, b: 0.1, a: 1.0 },
                storeOp: 'store',
            }]
        });

        pass.setPipeline(pipeline);
        pass.setVertexBuffer(0, instanceBuffer);
        pass.draw(4, 3); // 4 vertices per quad, 3 point instances[cite: 26]
        pass.end();

        device.queue.submit([encoder.finish()]);
    }

    render();
}