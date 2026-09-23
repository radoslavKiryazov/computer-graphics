struct Uniforms {
    ballY: f32,
    scaleX: f32,
    scaleY: f32,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

// Ball: mesh is built centered on the origin. We scale first (so squash/
// stretch happens about the ball's own center) and translate afterwards.
@vertex
fn main_vs(@location(0) inPos: vec2f) -> @builtin(position) vec4f {
    let scaled = vec2f(inPos.x * uniforms.scaleX, inPos.y * uniforms.scaleY);
    let moved = vec2f(scaled.x, scaled.y + uniforms.ballY);
    return vec4f(moved, 0.0, 1.0);
}

@fragment
fn main_fs() -> @location(0) vec4f {
    return vec4f(1.0, 1.0, 1.0, 1.0);
}

// Floor: static geometry already in clip space, no uniforms needed.
@vertex
fn floor_vs(@location(0) inPos: vec2f) -> @builtin(position) vec4f {
    return vec4f(inPos, 0.0, 1.0);
}

@fragment
fn floor_fs() -> @location(0) vec4f {
    return vec4f(0.15, 0.15, 0.18, 1.0);
}