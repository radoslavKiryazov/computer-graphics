struct Uniforms {
    ballY: f32,
    scaleX: f32,
    scaleY: f32,
    flatness: f32,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;

// match the radius used to build the ball mesh in JS.
const RADIUS: f32 = 0.15;

@vertex
fn main_vs(@location(0) inPos: vec2f) -> @builtin(position) vec4f {
    var scaleYEff = uniforms.scaleY;

    if (uniforms.scaleX > 1.0) {
        // squashin -  flatten more the closer a vertex sits to the bottom of
        // the ball. belowTop is 0 at the very top (inPos.y = RADIUS) and 1
        // at the very bottom (inPos.y = -RADIUS) -- i.e. "distance below
        // y = top, relative to the diameter".
        let belowTop = clamp((RADIUS - inPos.y) / (2.0 * RADIUS), 0.0, 1.0);
        let amplify = 1.0 + uniforms.flatness * belowTop;
        scaleYEff = 1.0 + (uniforms.scaleY - 1.0) * amplify;
    }

    let scaled = vec2f(inPos.x * uniforms.scaleX, inPos.y * scaleYEff);
    let moved = vec2f(scaled.x, scaled.y + uniforms.ballY);
    return vec4f(moved, 0.0, 1.0);
}

@fragment
fn main_fs() -> @location(0) vec4f {
    return vec4f(1.0, 1.0, 1.0, 1.0);
}

// floor
@vertex
fn floor_vs(@location(0) inPos: vec2f) -> @builtin(position) vec4f {
    return vec4f(inPos, 0.0, 1.0);
}

@fragment
fn floor_fs() -> @location(0) vec4f {
    return vec4f(0.15, 0.15, 0.18, 1.0);
}