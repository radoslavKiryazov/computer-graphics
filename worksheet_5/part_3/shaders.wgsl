// Worksheet 5 – Part 3: Indexed face set rendering (no shading, colour from normals)

struct Uniforms {
    mvp: mat4x4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VSOut {
    @builtin(position) position: vec4f,
    @location(0)       color:    vec3f,
};

@vertex
fn main_vs(
    @location(0) inPos:    vec4f,   // position  (w = 1)
    @location(1) inNormal: vec4f,   // normal     (w = 0)
) -> VSOut {
    var out: VSOut;
    out.position = uniforms.mvp * inPos;
    // Map normal from [-1,1] to [0,1] so the mesh is clearly visible
    out.color    = 0.5 * inNormal.xyz + 0.5;
    return out;
}

@fragment
fn main_fs(@location(0) color: vec3f) -> @location(0) vec4f {
    return vec4f(color, 1.0);
}
