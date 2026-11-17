struct Uniforms {
    projection: mat4x4f,
    view: mat4x4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var cubeSampler: sampler;
@group(0) @binding(2) var cubeMap: texture_cube<f32>; //[cite: 5]

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) normal: vec3f,
};

@vertex
fn main_vs(@location(0) position: vec3f, @location(1) normal: vec3f) -> VertexOutput {
    var out: VertexOutput;
    out.position = uniforms.projection * uniforms.view * vec4f(position, 1.0);
    out.normal = normal;
    return out;
}

@fragment
fn main_fs(in: VertexOutput) -> @location(0) vec4f {
    // Sample cube map directly using surface normal vector[cite: 5, 6, 22]
    let dir = normalize(in.normal);
    return textureSample(cubeMap, cubeSampler, dir); //[cite: 5]
}