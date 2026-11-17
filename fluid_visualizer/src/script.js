"use strict";

const DIFFUSE_ITERATIONS = 24;

window.onload = function () {
    main().catch((err) => console.error(err));
};

async function main() {
    const gpu = navigator.gpu;
    if (!gpu) {
        alert("WebGPU not supported in this browser.");
        return;
    }

    const adapter = await gpu.requestAdapter();
    const device = await adapter.requestDevice();

    const canvas = document.getElementById("webgpu");
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("webgpu");
    const canvasFormat = gpu.getPreferredCanvasFormat();
    context.configure({
        device,
        format: canvasFormat,
    });

    const wgslfile = document.getElementById("wgsl").src;
    const wgslcode = await fetch(wgslfile, { cache: "reload" }).then((r) => r.text());
    const shaderModule = device.createShaderModule({ code: wgslcode });

    const makeSimTexture = () =>
        device.createTexture({
            size: [width, height],
            format: "rgba16float",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
        });

    const dye0 = makeSimTexture();
    const dye1 = makeSimTexture();

    const vel0 = makeSimTexture();
    const vel1 = makeSimTexture();
    const velRHS = makeSimTexture();

    const sampler = device.createSampler({
        magFilter: "linear",
        minFilter: "linear",
        addressModeU: "clamp-to-edge",
        addressModeV: "clamp-to-edge",
    });

    const paramsBuffer = device.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const writeParams = (dt, dyeDissipation, velDissipation, viscosity) => {
        device.queue.writeBuffer(
            paramsBuffer,
            0,
            new Float32Array([dt, width, height, dyeDissipation, velDissipation, viscosity, 0, 0])
        );
    };

    writeParams(1.0 / 90.0, 0.998, 0.995, 150);

    const initPipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "init_main" },
    });

    const advectVelPipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "advect_vel_main" },
    });

    const diffusePipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "diffuse_main" },
    });

    const advectDyePipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "advect_dye_main" },
    });

    const renderPipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module: shaderModule, entryPoint: "vs_main" },
        fragment: {
            module: shaderModule,
            entryPoint: "fs_main",
            targets: [{ format: canvasFormat }],
        },
        primitive: { topology: "triangle-list" },
    });

    // Group 0: Shared params uniform
    const makeParamsBG = (pipeline) =>
        device.createBindGroup({
            layout: pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: paramsBuffer } }],
        });

    const initParamsBG = makeParamsBG(initPipeline);
    const advectVelParamsBG = makeParamsBG(advectVelPipeline);
    const diffuseParamsBG = makeParamsBG(diffusePipeline);
    const advectDyeParamsBG = makeParamsBG(advectDyePipeline);

    // Init Group 1
    const initBindGroup = device.createBindGroup({
        layout: initPipeline.getBindGroupLayout(1),
        entries: [
            { binding: 0, resource: dye0.createView() },
            { binding: 1, resource: vel0.createView() },
        ],
    });

    // Advect Velocity Group 1
    const makeAdvectVelBG = (readTex) =>
        device.createBindGroup({
            layout: advectVelPipeline.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: readTex.createView() },
                { binding: 1, resource: sampler },
                { binding: 2, resource: velRHS.createView() },
            ],
        });

    const advectVelFrom0 = makeAdvectVelBG(vel0);
    const advectVelFrom1 = makeAdvectVelBG(vel1);

    // Jacobi Diffusion Group 1
    const makeDiffuseBG = (xIn, bIn, xOut) =>
        device.createBindGroup({
            layout: diffusePipeline.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: xIn.createView() },
                { binding: 1, resource: bIn.createView() },
                { binding: 2, resource: xOut.createView() },
            ],
        });

    const diffuseRHSto0 = makeDiffuseBG(velRHS, velRHS, vel0);
    const diffuse0to1 = makeDiffuseBG(vel0, velRHS, vel1);
    const diffuse1to0 = makeDiffuseBG(vel1, velRHS, vel0);

    // Advect Dye Group 1
    const makeAdvectDyeBG = (velTex, dyeRead, dyeWrite) =>
        device.createBindGroup({
            layout: advectDyePipeline.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: velTex.createView() },
                { binding: 1, resource: sampler },
                { binding: 2, resource: dyeRead.createView() },
                { binding: 3, resource: dyeWrite.createView() },
            ],
        });

    const advectDyeVel0_0to1 = makeAdvectDyeBG(vel0, dye0, dye1);
    const advectDyeVel0_1to0 = makeAdvectDyeBG(vel0, dye1, dye0);
    const advectDyeVel1_0to1 = makeAdvectDyeBG(vel1, dye0, dye1);
    const advectDyeVel1_1to0 = makeAdvectDyeBG(vel1, dye1, dye0);

    // Render Group 1
    const makeRenderBG = (tex) =>
        device.createBindGroup({
            layout: renderPipeline.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: tex.createView() },
                { binding: 1, resource: sampler },
            ],
        });

    const renderFrom0 = makeRenderBG(dye0);
    const renderFrom1 = makeRenderBG(dye1);

    const wgX = Math.ceil(width / 8);
    const wgY = Math.ceil(height / 8);

    // ---------- Seed dye and velocity fields (runs once) ----------
    const initEncoder = device.createCommandEncoder();
    const initPass = initEncoder.beginComputePass();
    initPass.setPipeline(initPipeline);
    initPass.setBindGroup(0, initParamsBG);
    initPass.setBindGroup(1, initBindGroup);
    initPass.dispatchWorkgroups(wgX, wgY);
    initPass.end();
    device.queue.submit([initEncoder.finish()]);

    // ---------- Main loop ----------
    let dyeIs0 = true;
    let velIs0 = true;

    function frame() {
        const encoder = device.createCommandEncoder();

        // 1. Self-advect velocity into velRHS
        const advectVelPass = encoder.beginComputePass();
        advectVelPass.setPipeline(advectVelPipeline);
        advectVelPass.setBindGroup(0, advectVelParamsBG);
        advectVelPass.setBindGroup(1, velIs0 ? advectVelFrom0 : advectVelFrom1);
        advectVelPass.dispatchWorkgroups(wgX, wgY);
        advectVelPass.end();

        // 2. Diffuse velocity via Jacobi iterations (velRHS -> vel0 <-> vel1)
        const diffusePass = encoder.beginComputePass();
        diffusePass.setPipeline(diffusePipeline);
        diffusePass.setBindGroup(0, diffuseParamsBG);

        diffusePass.setBindGroup(1, diffuseRHSto0);
        diffusePass.dispatchWorkgroups(wgX, wgY);
        velIs0 = true;

        for (let i = 1; i < DIFFUSE_ITERATIONS; i++) {
            diffusePass.setBindGroup(1, velIs0 ? diffuse0to1 : diffuse1to0);
            diffusePass.dispatchWorkgroups(wgX, wgY);
            velIs0 = !velIs0;
        }
        diffusePass.end();

        // 3. Advect dye along diffused velocity field
        const advectDyePass = encoder.beginComputePass();
        advectDyePass.setPipeline(advectDyePipeline);
        advectDyePass.setBindGroup(0, advectDyeParamsBG);

        const dyeBG = velIs0
            ? dyeIs0 ? advectDyeVel0_0to1 : advectDyeVel0_1to0
            : dyeIs0 ? advectDyeVel1_0to1 : advectDyeVel1_1to0;

        advectDyePass.setBindGroup(1, dyeBG);
        advectDyePass.dispatchWorkgroups(wgX, wgY);
        advectDyePass.end();

        dyeIs0 = !dyeIs0;

        // 4. Render current dye texture
        const renderPass = encoder.beginRenderPass({
            colorAttachments: [
                {
                    view: context.getCurrentTexture().createView(),
                    clearValue: { r: 0, g: 0, b: 0, a: 1 },
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
        });
        renderPass.setPipeline(renderPipeline);
        renderPass.setBindGroup(1, dyeIs0 ? renderFrom0 : renderFrom1);
        renderPass.draw(3);
        renderPass.end();

        device.queue.submit([encoder.finish()]);
        requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
}