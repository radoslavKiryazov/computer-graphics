struct Uniforms {
    projectionMatrix: mat4x4f,
    viewMatrix: mat4x4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var mySampler: sampler;
@group(0) @binding(2) var myTexture: texture_2d<f32>;

struct VSOutput {
    @builtin(position) position: vec4f,
    @location(0) texcoord: vec2f,
};

@vertex
fn main_vs(@location(0) position: vec3f, @location(1) texcoord: vec2f) -> VSOutput {
    var vsOut: VSOutput;
    vsOut.position = uniforms.projectionMatrix * uniforms.viewMatrix * vec4f(position, 1.0);
    vsOut.texcoord = texcoord;
    return vsOut;
}

@fragment
fn main_fs(@location(0) texcoord: vec2f) -> @location(0) vec4f {
    return textureSample(myTexture, mySampler, texcoord);
}