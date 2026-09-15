struct Uniforms {
    angle: f32,
}

;
@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

@vertex
fn main_vs(@location(0) inPos: vec2f) -> @builtin(position) vec4f {
    let c = cos(uniforms.angle);
    let s = sin(uniforms.angle);
    let rotated = vec2f(inPos.x * c - inPos.y * s, inPos.x * s + inPos.y * c);
    return vec4f(rotated, 0.0, 1.0);
}

@fragment
fn main_fs() -> @location(0) vec4f {
    return vec4f(1.0, 1.0, 1.0, 1.0);
}