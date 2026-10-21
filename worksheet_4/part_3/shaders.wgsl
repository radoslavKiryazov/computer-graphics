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
    let n = normalize(inPos);
    // unit sphere: normal = position
    let l_e = vec3f(0.0, 0.0, - 1.0);
    // direction the light travels
    let w_i = - l_e;
    // direction toward the light
    let L_e = vec3f(1.0, 1.0, 1.0);
    // white light
    let k_d = vec3f(0.9, 0.3, 0.3);
    // material colour (diffuse coefficient)

    let L_rd = k_d * L_e * max(dot(n, w_i), 0.0);

    var out: VSOut;
    out.position = uniforms.mvp * vec4f(inPos, 1.0);
    out.color = L_rd;
    return out;
}

@fragment
fn main_fs(@location(0) color: vec3f) -> @location(0) vec4f {
    return vec4f(color, 1.0);
}