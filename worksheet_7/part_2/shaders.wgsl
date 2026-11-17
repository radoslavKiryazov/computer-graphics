struct Uniforms {
    mvp: mat4x4f,
    mTex: mat4x4f,
    isBg: u32,
}

;

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;
@group(0) @binding(1)
var cubeSampler: sampler;
@group(0) @binding(2)
var cubeMap: texture_cube<f32>;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) texCoord: vec3f,
}

;

@vertex
fn main_vs(@location(0) position: vec3f, @location(1) normal: vec3f) -> VertexOutput {
    var out: VertexOutput;
    if (uniforms.isBg == 1u) {
        // Quad position is in clip space; mTex maps it to world-space ray direction[cite: 9, 22]
        out.position = vec4f(position, 1.0);
        out.texCoord = (uniforms.mTex * vec4f(position, 1.0)).xyz;
    }
    else {
        // Sphere position transformed by MVP; mTex (identity) passes world normal[cite: 22]
        out.position = uniforms.mvp * vec4f(position, 1.0);
        out.texCoord = (uniforms.mTex * vec4f(normal, 0.0)).xyz;
    }
    return out;
}

@fragment
fn main_fs(in: VertexOutput) -> @location(0) vec4f {
    let dir = normalize(in.texCoord);
    return textureSample(cubeMap, cubeSampler, dir);
}