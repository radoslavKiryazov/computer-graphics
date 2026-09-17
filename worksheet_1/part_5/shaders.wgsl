struct Uniforms {
    offsetY: f32,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

@vertex
fn main_vs(@location(0) inPos: vec2f) -> @builtin(position) vec4f {
    let moved = vec2f(inPos.x, inPos.y + uniforms.offsetY);
    return vec4f(moved, 0.0, 1.0);
}

@fragment
fn main_fs() -> @location(0) vec4f {
    return vec4f(1.0, 1.0, 1.0, 1.0);
}