struct Uniforms {
    mvp: mat4x4f,
}

;
@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

struct VSOut {
    @builtin(position) position: vec4f,
    @location(0) color: vec3f,
}

;

@vertex
fn main_vs(@location(0) inPos: vec3f) -> VSOut {
    var out: VSOut;
    out.position = uniforms.mvp * vec4f(inPos, 1.0);
    out.color = 0.5 * inPos + 0.5;
    // only so the mesh is visible for now
    return out;
}

@fragment
fn main_fs(@location(0) color: vec3f) -> @location(0) vec4f {
    return vec4f(color, 1.0);
}