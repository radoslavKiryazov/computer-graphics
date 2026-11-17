struct VertexOutput {
    @builtin(position) position: vec4f,
    @location(0) color: vec4f,
}

;

@vertex
fn main_vs(@builtin(vertex_index) vertexIndex: u32, @location(0) instancePos: vec3f, @location(1) instanceColor: vec4f) -> VertexOutput {
    // Generate a quad of width 0.5 (half-extent = 0.25) using a triangle strip[cite: 26]
    var offsets = array<vec2f, 4>(vec2f(- 0.25, - 0.25), vec2f(0.25, - 0.25), vec2f(- 0.25, 0.25), vec2f(0.25, 0.25));

    var out: VertexOutput;
    let pos2D = instancePos.xy + offsets[vertexIndex];
    out.position = vec4f(pos2D, instancePos.z, 1.0);
    out.color = instanceColor;
    return out;
}

@fragment
fn main_fs(in: VertexOutput) -> @location(0) vec4f {
    return in.color;
}