struct Resolution {
    canvasSize: vec2f,
}

@group(0) @binding(0)
var<uniform> uniforms: Resolution;

struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) splatCenter: vec2f,
    @location(1) color: vec4f,
    @location(2) opacity: f32,
    @location(3) invCovUpper: vec3f,
}

@vertex
fn main_vs(@builtin(vertex_index) vertexIndex: u32, @location(0) pos: vec3f, @location(1) halfLengths: vec2f, @location(2) dir1: vec2f, @location(3) dir2: vec2f, @location(4) color: vec4f, @location(5) opacity: f32) -> VertexOutput {
    const quadCorners = array<vec2f, 4>(vec2f(- 1.0, - 1.0), vec2f(1.0, - 1.0), vec2f(- 1.0, 1.0), vec2f(1.0, 1.0));
    let corner = quadCorners[vertexIndex];

    // Expand vertex position in screen space pixels[cite: 26]
    let offsetScreen = dir1 * (corner.x * halfLengths.x * 3.0) + dir2 * (corner.y * halfLengths.y * 3.0);
    let vertexScreenPos = pos.xy + offsetScreen;

    // Inverse covariance matrix upper triangle (xx, xy, yy)[cite: 26]
    let s1_sq = max(halfLengths.x * halfLengths.x, 0.000001);
    let s2_sq = max(halfLengths.y * halfLengths.y, 0.000001);
    let xx = (dir1.x * dir1.x) / s1_sq + (dir2.x * dir2.x) / s2_sq;
    let xy = (dir1.x * dir1.y) / s1_sq + (dir2.x * dir2.y) / s2_sq;
    let yy = (dir1.y * dir1.y) / s1_sq + (dir2.y * dir2.y) / s2_sq;

    // Convert screen pixel coordinates to WebGPU NDC [-1, 1][cite: 26]
    let ndcX = (2.0 * vertexScreenPos.x / uniforms.canvasSize.x) - 1.0;
    let ndcY = 1.0 - (2.0 * vertexScreenPos.y / uniforms.canvasSize.y);

    var out: VertexOutput;
    // Fix: Set Z to 0.5 to prevent WebGPU from clipping coordinates outside [0, 1]
    out.position = vec4f(ndcX, ndcY, 0.5, 1.0);
    out.splatCenter = pos.xy;
    out.color = color;
    out.opacity = opacity;
    out.invCovUpper = vec3f(xx, xy, yy);
    return out;
}

@fragment
fn main_fs(in: VertexOutput) -> @location(0) vec4f {
    let d = in.position.xy - in.splatCenter;

    let xx = in.invCovUpper.x;
    let xy = in.invCovUpper.y;
    let yy = in.invCovUpper.z;
    let power = - 0.5 * (xx * d.x * d.x + 2.0 * xy * d.x * d.y + yy * d.y * d.y);

    if (power > 0.0) {
        discard;
    }

    let alpha = in.opacity * exp(power);
    return vec4f(in.color.rgb, alpha);
}