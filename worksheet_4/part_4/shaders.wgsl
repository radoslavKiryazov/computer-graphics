struct Uniforms {
    mvp: mat4x4f,
    eye: vec4f,
    // camera position in world space (xyz)
    params: vec4f,
    // x: L_e, y: L_a, z: k_d, w: k_s (scaling factors)
    shininess: f32,
    // Phong exponent s
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
    // Constants: colours and light direction
    let k_d_col = vec3f(1.0, 0.2, 0.2);
    // diffuse colour (red)
    let k_s_col = vec3f(1.0, 1.0, 1.0);
    // specular colour (white)
    let l_e = vec3f(0.0, 0.0, - 1.0);
    // direction the light travels

    // Parameters = colour (or white) * slider scale
    let L_e = vec3f(1.0) * uniforms.params.x;
    let L_a = vec3f(1.0) * uniforms.params.y;
    let k_d = k_d_col * uniforms.params.z;
    let k_s = k_s_col * uniforms.params.w;
    let k_a = k_d;
    // worksheet: k_a = k_d
    let s = uniforms.shininess;
    let L_i = L_e;
    // worksheet: L_i = L_e (no shadows)

    // Vectors (all in world space)
    let n = normalize(inPos);
    // unit sphere: normal = position
    let w_i = normalize(- l_e);
    // toward the light
    let w_o = normalize(uniforms.eye.xyz - inPos);
    // toward the observer
    let w_r = 2.0 * dot(w_i, n) * n - w_i;
    // perfect reflection direction

    let cos_theta = dot(n, w_i);

    // Phong terms
    let L_rd = k_d * L_i * max(cos_theta, 0.0);
    var L_rs = vec3f(0.0);
    if (cos_theta > 0.0) {
        // no highlight on the unlit side
        L_rs = k_s * L_i * pow(max(dot(w_r, w_o), 0.0), s);
    }
    let L_ra = k_a * L_a;

    var out: VSOut;
    out.position = uniforms.mvp * vec4f(inPos, 1.0);
    out.color = L_rd + L_rs + L_ra;
    return out;
}

@fragment
fn main_fs(@location(0) color: vec3f) -> @location(0) vec4f {
    return vec4f(color, 1.0);
}