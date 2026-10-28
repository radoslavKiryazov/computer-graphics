struct Uniforms {
    projectionMatrix: mat4x4f,
    viewMatrix: mat4x4f,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;
@group(0) @binding(1)
var mySampler: sampler;
@group(0) @binding(2)
var myTexture: texture_2d<f32>;

struct VSOutput {
    @builtin(position) position: vec4f,
    @location(0) normal: vec3f,
}

// Global constant definition
const PI: f32 = 3.14159265359;

@vertex
fn main_vs(@location(0) position: vec3f, @location(1) normal: vec3f) -> VSOutput {
    var vsOut: VSOutput;
    vsOut.position = uniforms.projectionMatrix * uniforms.viewMatrix * vec4f(position, 1.0);
    vsOut.normal = normal;
    return vsOut;
}

@fragment
fn main_fs(@location(0) normal: vec3f) -> @location(0) vec4f {
    let n = normalize(normal);

    // Inverse spherical mapping: (x, y, z) -> (u, v)
    let phi = atan2(n.z, n.x);
    let theta = acos(clamp(n.y, - 1.0, 1.0));

    let u = 0.5 - (phi / (2.0 * PI));
    let v = theta / PI;
    let uv = vec2f(u, v);

    // Compute explicit derivatives before any branching
    let dpdx = dpdx(uv);
    let dpdy = dpdy(uv);

    var texColor: vec4f;
    if (PI - abs(phi) < 0.1) {
        // Force base mip level near the seam to fix derivative spike artifacts
        texColor = textureSampleLevel(myTexture, mySampler, uv, 0.0);
    }
    else {
        // Explicit gradients avoid uniform control flow errors
        texColor = textureSampleGrad(myTexture, mySampler, uv, dpdx, dpdy);
    }

    // Directional light + Ambient lighting
    let lightDir = normalize(vec3f(1.0, 1.0, 1.0));
    let diffuse = max(dot(n, lightDir), 0.0);
    let ambient = 0.2;

    let kd = texColor.rgb;
    let finalColor = kd * (diffuse + ambient);

    return vec4f(finalColor, 1.0);
}