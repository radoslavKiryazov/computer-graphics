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
    const velScratch = makeSimTexture();

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

    const makeAdvectVelBG = (readTex) =>
        device.createBindGroup({
            layout: advectVelPipeline.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: readTex.createView() },
                { binding: 1, resource: sampler },
                { binding: 2, resource: vel0.createView() },
            ],
        });

    const advectVelFromVel1 = makeAdvectVelBG(vel1);
    const advectVelFromScratch = makeAdvectVelBG(velScratch);

    // Jacobi Diffusion Group 1
    // bIn is ALWAYS vel0 (the fixed RHS for the whole solve). xIn/xOut
    // ping-pong between vel1 and velScratch, never touching vel0.
    const makeDiffuseBG = (xIn, xOut) =>
        device.createBindGroup({
            layout: diffusePipeline.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: xIn.createView() },
                { binding: 1, resource: vel0.createView() },
                { binding: 2, resource: xOut.createView() },
            ],
        });

    const diffuseSeed = makeDiffuseBG(vel0, velScratch);        // x0 = b = vel0 -> velScratch
    const diffuseScratchToVel1 = makeDiffuseBG(velScratch, vel1);
    const diffuseVel1ToScratch = makeDiffuseBG(vel1, velScratch);

    // Advect Dye Group 1
    // Velocity field to sample is always vel0 now (current velocity lives
    // there after the advect-velocity step runs).
    const makeAdvectDyeBG = (dyeRead, dyeWrite) =>
        device.createBindGroup({
            layout: advectDyePipeline.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: vel0.createView() },
                { binding: 1, resource: sampler },
                { binding: 2, resource: dyeRead.createView() },
                { binding: 3, resource: dyeWrite.createView() },
            ],
        });

    const advectDye0to1 = makeAdvectDyeBG(dye0, dye1);
    const advectDye1to0 = makeAdvectDyeBG(dye1, dye0);

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

    function frame() {
        const encoder = device.createCommandEncoder();

        // 1. Diffuse velocity via Jacobi iterations.
        //    b is fixed at vel0 (last frame's final velocity) for every
        //    iteration; x ping-pongs between vel1 and velScratch.
        const diffusePass = encoder.beginComputePass();
        diffusePass.setPipeline(diffusePipeline);
        diffusePass.setBindGroup(0, diffuseParamsBG);

        diffusePass.setBindGroup(1, diffuseSeed);
        diffusePass.dispatchWorkgroups(wgX, wgY);
        let latestInScratch = true; // seed call wrote into velScratch

        for (let i = 1; i < DIFFUSE_ITERATIONS; i++) {
            diffusePass.setBindGroup(1, latestInScratch ? diffuseScratchToVel1 : diffuseVel1ToScratch);
            diffusePass.dispatchWorkgroups(wgX, wgY);
            latestInScratch = !latestInScratch;
        }
        diffusePass.end();

        // 2. Self-advect the DIFFUSED velocity: u_new = advect(u_diffused, u_diffused).
        //    Output always lands in vel0, making it "current" for this frame.
        const advectVelPass = encoder.beginComputePass();
        advectVelPass.setPipeline(advectVelPipeline);
        advectVelPass.setBindGroup(0, advectVelParamsBG);
        advectVelPass.setBindGroup(1, latestInScratch ? advectVelFromScratch : advectVelFromVel1);
        advectVelPass.dispatchWorkgroups(wgX, wgY);
        advectVelPass.end();

        // 3. Advect dye along the final velocity field (always vel0 now).
        const advectDyePass = encoder.beginComputePass();
        advectDyePass.setPipeline(advectDyePipeline);
        advectDyePass.setBindGroup(0, advectDyeParamsBG);
        advectDyePass.setBindGroup(1, dyeIs0 ? advectDye0to1 : advectDye1to0);
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