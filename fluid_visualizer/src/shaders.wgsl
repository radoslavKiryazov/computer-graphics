struct Params {
    dt: f32,
    gridWidth: f32,
    gridHeight: f32,
    dyeDissipation: f32,
    velDissipation: f32,
    viscosity: f32,
    _pad0: f32,
    _pad1: f32,
}

;

@group(0) @binding(0)
var<uniform> params: Params;

fn rand(co: vec2<f32>) -> f32 {
    return fract(sin(dot(co, vec2<f32>(12.9898, 78.233))) * 43758.5453123);
}

// ---- 1. Init pass: seed dye AND an initial opposing vortex pair in velocity ----
@group(1) @binding(0)
var initDyeOut: texture_storage_2d<rgba16float, write>;
@group(1) @binding(1)
var initVelOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn init_main(@builtin(global_invocation_id) id: vec3<u32>) {
    let texSize = vec2<f32>(params.gridWidth, params.gridHeight);
    let coord = vec2<f32>(f32(id.x), f32(id.y));
    let uv = (coord + vec2<f32>(0.5, 0.5)) / texSize;

    // Seed dye with random RGB noise
    let r = rand(coord);
    let g = rand(coord + vec2<f32>(37.0, 17.0));
    let b = rand(coord + vec2<f32>(91.0, 53.0));
    textureStore(initDyeOut, vec2<i32>(id.xy), vec4<f32>(r, g, b, 1.0));

    // Seed velocity with two counter-rotating vortices so we can observe
    // self-advection + viscous smoothing in Stage 2
    let d1 = uv - vec2<f32>(0.35, 0.5);
    let d2 = uv - vec2<f32>(0.65, 0.5);
    let v1 = vec2<f32>(- d1.y, d1.x) * exp(- dot(d1, d1) * 18.0) * 180.0;
    let v2 = vec2<f32>(d2.y, - d2.x) * exp(- dot(d2, d2) * 18.0) * 180.0;
    let vel = v1 + v2;

    textureStore(initVelOut, vec2<i32>(id.xy), vec4<f32>(vel, 0.0, 1.0));
}

// ---- 2. Self-advect velocity: u* = advect(u, u) ----
@group(1) @binding(0)
var velIn: texture_2d<f32>;
@group(1) @binding(1)
var linearSampler: sampler;
@group(1) @binding(2)
var velOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn advect_vel_main(@builtin(global_invocation_id) id: vec3<u32>) {
    let texSize = vec2<f32>(params.gridWidth, params.gridHeight);
    let uv = (vec2<f32>(f32(id.x), f32(id.y)) + vec2<f32>(0.5, 0.5)) / texSize;

    let vel = textureSampleLevel(velIn, linearSampler, uv, 0.0).xy;
    let sourceUV = uv - (vel * params.dt) / texSize;

    var advectedVel = textureSampleLevel(velIn, linearSampler, sourceUV, 0.0).xy;
    advectedVel *= params.velDissipation;

    textureStore(velOut, vec2<i32>(id.xy), vec4<f32>(advectedVel, 0.0, 1.0));
}

// ---- 3. Jacobi diffusion solver: (I - nu * dt * Laplacian) u_new = u_old ----
// Uses textureLoad (exact integer texel reads) for the 5-point finite-difference stencil
@group(1) @binding(0)
var jacobiXIn: texture_2d<f32>;
// current iteration u^(k)
@group(1) @binding(1)
var jacobiBIn: texture_2d<f32>;
// original RHS b = u_old
@group(1) @binding(2)
var jacobiXOut: texture_storage_2d<rgba16float, write>;
// u^(k+1)

@compute @workgroup_size(8, 8, 1)
fn diffuse_main(@builtin(global_invocation_id) id: vec3<u32>) {
    let maxCoord = vec2<i32>(i32(params.gridWidth) - 1, i32(params.gridHeight) - 1);
    let c = vec2<i32>(id.xy);

    // Clamp neighbor lookups to grid boundaries
    let left = textureLoad(jacobiXIn, clamp(c + vec2<i32>(- 1, 0), vec2<i32>(0), maxCoord), 0).xy;
    let right = textureLoad(jacobiXIn, clamp(c + vec2<i32>(1, 0), vec2<i32>(0), maxCoord), 0).xy;
    let down = textureLoad(jacobiXIn, clamp(c + vec2<i32>(0, - 1), vec2<i32>(0), maxCoord), 0).xy;
    let up = textureLoad(jacobiXIn, clamp(c + vec2<i32>(0, 1), vec2<i32>(0), maxCoord), 0).xy;
    let bCenter = textureLoad(jacobiBIn, c, 0).xy;

    // beta = 1 / (viscosity * dt)
    let alpha = max(params.viscosity * params.dt, 1e-6);
    let beta = 1.0 / alpha;

    let nextVel = (left + right + down + up + beta * bCenter) / (4.0 + beta);
    textureStore(jacobiXOut, c, vec4<f32>(nextVel, 0.0, 1.0));
}

// ---- 4. Advect dye using the real velocity field ----
@group(1) @binding(0)
var currentVelTex: texture_2d<f32>;
@group(1) @binding(1)
var dyeSampler: sampler;
@group(1) @binding(2)
var dyeIn: texture_2d<f32>;
@group(1) @binding(3)
var dyeOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8, 1)
fn advect_dye_main(@builtin(global_invocation_id) id: vec3<u32>) {
    let texSize = vec2<f32>(params.gridWidth, params.gridHeight);
    let uv = (vec2<f32>(f32(id.x), f32(id.y)) + vec2<f32>(0.5, 0.5)) / texSize;

    let vel = textureSampleLevel(currentVelTex, dyeSampler, uv, 0.0).xy;
    let sourceUV = uv - (vel * params.dt) / texSize;

    var advectedDye = textureSampleLevel(dyeIn, dyeSampler, sourceUV, 0.0);
    advectedDye *= params.dyeDissipation;

    textureStore(dyeOut, vec2<i32>(id.xy), advectedDye);
}

// ---- 5. Render shader (fullscreen triangle) ----
struct VSOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
}

;

@vertex
fn vs_main(@builtin(vertex_index) idx: u32) -> VSOut {
    var positions = array<vec2<f32>, 3>(vec2<f32>(- 1.0, - 1.0), vec2<f32>(3.0, - 1.0), vec2<f32>(- 1.0, 3.0));
    var out: VSOut;
    let p = positions[idx];
    out.pos = vec4<f32>(p, 0.0, 1.0);
    out.uv = vec2<f32>((p.x + 1.0) * 0.5, 1.0 - (p.y + 1.0) * 0.5);
    return out;
}

@group(1) @binding(0)
var renderDyeTex: texture_2d<f32>;
@group(1) @binding(1)
var renderDyeSampler: sampler;

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
    let color = textureSampleLevel(renderDyeTex, renderDyeSampler, in.uv, 0.0);
    return vec4<f32>(color.rgb, 1.0);
}