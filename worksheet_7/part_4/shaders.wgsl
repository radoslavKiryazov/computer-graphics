struct Uniforms {
    mvp: mat4x4f,
    mTex: mat4x4f,
    eyePosition: vec3f,
    reflective: u32,
}

;

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;
@group(0) @binding(1)
var mySampler: sampler;
@group(0) @binding(2)
var cubeMap: texture_cube<f32>;
@group(0) @binding(3)
var normalMap: texture_2d<f32>;
//[cite: 23]

// Orthonormal basis rotation from tangent space to world space[cite: 12, 23]
fn rotate_to_normal(n: vec3f, v: vec3f) -> vec3f {
    let sgn_nz = sign(n.z + 1.8e-16);
    let a = - 1.0 / (1.0 + abs(n.z));
    let b = n.x * n.y * a;
    return vec3f(1.0 + n.x * n.x * a, b, sgn_nz * n.x) * v.x + vec3f(sgn_nz * b, sgn_nz * (1.0 + n.y * n.y * a), - n.y) * v.y + n * v.z;
}

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
        out.position = vec4f(position, 1.0);
        out.texCoord = (uniforms.mTex * vec4f(position, 1.0)).xyz;
        out.worldPos = vec3f(0.0);
        out.worldNormal = vec3f(0.0);
    }
    else {
        out.position = uniforms.mvp * vec4f(position, 1.0);
        out.worldPos = position;
        out.worldNormal = normal;
        out.texCoord = vec3f(0.0);
    }
    return out;
}

@fragment
fn main_fs(in: VertexOutput) -> @location(0) vec4f {
    let n_w = normalize(in.worldNormal);

    // 1. Calculate spherical UV texture coordinates from sphere surface normal[cite: 11]
    let pi = 3.14159265359;
    let u = 0.5 - atan2(n_w.z, n_w.x) / (2.0 * pi);
    //[cite: 11]
    let v = acos(clamp(n_w.y, - 1.0, 1.0)) / pi;
    //[cite: 11]

    // 2. Fetch tangent-space normal from normal map and transform [0,1] -> [-1,1][cite: 12, 23]
    let texColor = textureSample(normalMap, mySampler, vec2f(u, v)).rgb;
    let n_tangent = texColor * 2.0 - vec3f(1.0);
    //[cite: 12, 23]

    // 3. Transform tangent-space normal to world space[cite: 12, 23]
    let n_bump = rotate_to_normal(n_w, n_tangent);
    //[cite: 12, 23]

    // 4. Compute reflection direction using bumped normal[cite: 10, 12, 23]
    let incident = normalize(in.worldPos - uniforms.eyePosition);
    let reflectionDir = reflect(incident, normalize(n_bump));
    //[cite: 10, 12, 23]

    // Select between background direction and bumped mirror reflection[cite: 23]
    let dir = select(in.texCoord, reflectionDir, uniforms.reflective == 1u);
    //[cite: 23]

    return textureSample(cubeMap, mySampler, normalize(dir));
}