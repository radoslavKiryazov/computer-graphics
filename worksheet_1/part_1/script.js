const statusEl = document.getElementById('status');

const GRID_W = 256;
const GRID_H = 256;

async function main() {
  if (!navigator.gpu) {
    statusEl.textContent = 'WebGPU not supported in this browser.';
    return;
  }

  const [adapter, shaderResponse] = await Promise.all([
    navigator.gpu.requestAdapter(),
    fetch('./shaders.wgsl'),
  ]);

  if (!shaderResponse.ok) {
    throw new Error(`Failed to load shaders.wgsl: ${shaderResponse.statusText}`);
  }

  const shaderCode = await shaderResponse.text();
  const device = await adapter.requestDevice();

  const canvas = document.getElementById('canvas');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;

  const context = canvas.getContext('webgpu');
  const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format: presentationFormat,
    alphaMode: 'opaque',
  });

  // ---------- Dye textures (ping-pong) ----------
  const dyeFormat = 'rgba16float';
  function makeDyeTexture() {
    return device.createTexture({
      size: [GRID_W, GRID_H],
      format: dyeFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });
  }
  const dyeA = makeDyeTexture();
  const dyeB = makeDyeTexture();

  const sampler = device.createSampler({
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  });

  // ---------- Uniform params ----------
  const paramsBuffer = device.createBuffer({
    size: 16, // dt, gridWidth, gridHeight, dissipation (4 x f32)
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  function writeParams(dt, dissipation) {
    device.queue.writeBuffer(
      paramsBuffer,
      0,
      new Float32Array([dt, GRID_W, GRID_H, dissipation])
    );
  }
  writeParams(1.0 / 60.0, 0.997);

  // ---------- Shader Module & Pipelines ----------
  const shaderModule = device.createShaderModule({ code: shaderCode });

  const initPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'init_main' },
  });

  const advectPipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'advect_main' },
  });

  const renderPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module: shaderModule, entryPoint: 'vs_main' },
    fragment: {
      module: shaderModule,
      entryPoint: 'fs_main',
      targets: [{ format: presentationFormat }],
    },
    primitive: { topology: 'triangle-list' },
  });

  // ---------- Bind groups ----------
  const initBindGroup = device.createBindGroup({
    layout: initPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: dyeA.createView() }],
  });

  function makeAdvectBindGroup(readTex, writeTex) {
    return device.createBindGroup({
      layout: advectPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: readTex.createView() },
        { binding: 1, resource: sampler },
        { binding: 2, resource: writeTex.createView() },
        { binding: 3, resource: { buffer: paramsBuffer } },
      ],
    });
  }
  const advectAtoB = makeAdvectBindGroup(dyeA, dyeB);
  const advectBtoA = makeAdvectBindGroup(dyeB, dyeA);

  function makeRenderBindGroup(tex) {
    return device.createBindGroup({
      layout: renderPipeline.getBindGroupLayout(1),
      entries: [
        { binding: 0, resource: tex.createView() },
        { binding: 1, resource: sampler },
      ],
    });
  }
  const renderFromA = makeRenderBindGroup(dyeA);
  const renderFromB = makeRenderBindGroup(dyeB);

  // ---------- Seed dye field with random colors (runs once) ----------
  {
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(initPipeline);
    pass.setBindGroup(0, initBindGroup);
    pass.dispatchWorkgroups(Math.ceil(GRID_W / 8), Math.ceil(GRID_H / 8));
    pass.end();
    device.queue.submit([encoder.finish()]);
  }

  // ---------- Main loop ----------
  let currentIsA = true; // true: dyeA holds the latest data
  statusEl.textContent = 'running (iteration 1: advection only, random seed colors)';

  function frame() {
    const encoder = device.createCommandEncoder();

    const computePass = encoder.beginComputePass();
    computePass.setPipeline(advectPipeline);
    computePass.setBindGroup(0, currentIsA ? advectAtoB : advectBtoA);
    computePass.dispatchWorkgroups(Math.ceil(GRID_W / 8), Math.ceil(GRID_H / 8));
    computePass.end();

    currentIsA = !currentIsA; // the texture we just wrote into is now "current"

    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0, g: 0, b: 0, a: 1 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    });
    renderPass.setPipeline(renderPipeline);
    renderPass.setBindGroup(1, currentIsA ? renderFromA : renderFromB);
    renderPass.draw(3);
    renderPass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

main().catch((err) => {
  statusEl.textContent = 'Error: ' + err.message;
  console.error(err);
});
