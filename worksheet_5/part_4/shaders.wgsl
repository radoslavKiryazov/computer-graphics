// Worksheet 5 – Part 4: Phong shading in the fragment shader
//
// Normals from the OBJ file:
//   - If the model was exported from Blender with "Shade Smooth", the OBJ
//     contains per-vertex normals that are averages of adjacent face normals.
//     The rasteriser interpolates them across each triangle, giving a smooth
//     appearance even though the underlying geometry is faceted.
//   - If flat (per-face) normals were used, each fragment in a triangle would
//     receive the same normal → visible hard shading edges (faceted look).
//   - We re-normalise the interpolated normal in the fragment shader because
//     linear interpolation does not preserve unit length.

struct Uniforms {
    mvp:       mat4x4f,   // model-view-projection  (offset   0, size 64)
    eye:       vec4f,     // camera world-space pos  (offset  64, size 16)
    params:    vec4f,     // x=L_e, y=L_a, z=k_d, w=k_s (offset 80, size 16)
    shininess: f32,       // Phong exponent s        (offset  96, size  4)
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

// ── Vertex shader ─────────────────────────────────────────────────────────────
struct VSOut {
    @builtin(position) position:    vec4f,
    @location(0)       worldPos:    vec3f,   // world-space position
    @location(1)       worldNormal: vec3f,   // world-space (interpolated) normal
};

@vertex
fn main_vs(
    @location(0) inPos:    vec4f,   // position (w = 1)
    @location(1) inNormal: vec4f,   // normal   (w = 0)
) -> VSOut {
    // NOTE: this worksheet uses no separate model matrix (object is at origin),
    // so world space == object space.  If you add a model matrix M, multiply
    // inNormal by the inverse-transpose of M instead of M itself.
    var out: VSOut;
    out.position    = uniforms.mvp * inPos;
    out.worldPos    = inPos.xyz;
    out.worldNormal = inNormal.xyz;
    return out;
}

// ── Fragment shader ───────────────────────────────────────────────────────────
@fragment
fn main_fs(
    @location(0) worldPos:    vec3f,
    @location(1) worldNormal: vec3f,
) -> @location(0) vec4f {

    // Material colours (could be loaded from the MTL file or passed as uniforms)
    let k_d_col = vec3f(0.9, 0.5, 0.1);   // warm orange diffuse
    let k_s_col = vec3f(1.0, 1.0, 1.0);   // white specular highlight
    let k_a_col = k_d_col;                 // ambient matches diffuse (standard)

    // Slider-controlled scale factors
    let L_e = vec3f(1.0) * uniforms.params.x;
    let L_a = vec3f(1.0) * uniforms.params.y;
    let k_d = k_d_col    * uniforms.params.z;
    let k_s = k_s_col    * uniforms.params.w;
    let k_a = k_a_col;
    let s   = uniforms.shininess;

    // Light is at a fixed world-space position (or direction).
    // Here we use a directional light coming from slightly above and to the side.
    let light_dir = normalize(vec3f(1.0, 2.0, 2.0));   // direction TOWARD the light

    // Re-normalise after rasteriser interpolation (crucial for smooth shading)
    let n   = normalize(worldNormal);
    let w_i = light_dir;                                          // toward light
    let w_o = normalize(uniforms.eye.xyz - worldPos);             // toward observer
    let w_r = reflect(-w_i, n);                                   // perfect reflection

    let cos_theta = dot(n, w_i);

    // Phong illumination model
    let L_rd = k_d * L_e * max(cos_theta, 0.0);

    var L_rs = vec3f(0.0);
    if (cos_theta > 0.0) {
        // Specular highlight only on the lit side
        L_rs = k_s * L_e * pow(max(dot(w_r, w_o), 0.0), s);
    }

    let L_ra = k_a * L_a;   // ambient term

    let color = L_rd + L_rs + L_ra;
    return vec4f(color, 1.0);
}
