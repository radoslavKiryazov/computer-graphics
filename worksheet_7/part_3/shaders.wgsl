struct Uniforms {
    mvp: mat4x4f,
    mTex: mat4x4f,
    eyePosition: vec3f,
    // Uploaded eye position[cite: 10, 23]
    reflective: u32,
    // 1 for reflective sphere, 0 for background quad[cite: 23]
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
    @location(0) worldPos: vec3f,
    @location(1) worldNormal: vec3f,
    @location(2) texCoord: vec3f,
}

;

@vertex
fn main_vs(@location(0) position: vec3f, @location(1) normal: vec3f) -> VertexOutput {
    var out: VertexOutput;
    if (uniforms.reflective == 0u) {
        // Background Quad: position in clip space; mTex maps to world ray direction[cite: 9, 22]
        out.position = vec4f(position, 1.0);
        out.texCoord = (uniforms.mTex * vec4f(position, 1.0)).xyz;
        out.worldPos = vec3f(0.0);
        out.worldNormal = vec3f(0.0);
    }
    else {
        // Sphere: transformed by MVP; pass world position and normal[cite: 10, 22]
        out.position = uniforms.mvp * vec4f(position, 1.0);
        out.worldPos = position;
        // model matrix is identity
        out.worldNormal = normal;
        out.texCoord = vec3f(0.0);
    }
    return out;
}

@fragment
fn main_fs(in: VertexOutput) -> @location(0) vec4f {
    // Incident view direction v = position - eye[cite: 10, 23]
    let incident = normalize(in.worldPos - uniforms.eyePosition);
    let normal = normalize(in.worldNormal);
    let reflectionDir = reflect(incident, normal);
    //[cite: 10, 23]

    // Use select function to pick reflection direction for mirror ball vs. background ray[cite: 23]
    let dir = select(in.texCoord, reflectionDir, uniforms.reflective == 1u);
    //[cite: 23]

    return textureSample(cubeMap, cubeSampler, normalize(dir));
}