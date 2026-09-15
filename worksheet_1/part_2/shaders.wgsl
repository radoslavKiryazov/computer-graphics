@vertex
fn main_vs(@location(0) inPos: vec2f) -> @builtin(position) vec4f {
    return vec4f(inPos, 0.0, 1.0);
}

@fragment
fn main_fs() -> @location(0) vec4f {
    return vec4f(0.0, 0.0, 0.0, 1.0);
}