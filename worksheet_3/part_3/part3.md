# Worksheet 3, Part 3: Transformation matrices

All matrices are 4x4 and act on homogeneous column vectors, so a product is applied right to left.

## Matrices used

**Depth remap (WebGPU).** WebGPU's NDC depth is [0, 1] instead of [-1, 1]:

    M_st = [ 1 0 0   0
             0 1 0   0
             0 0 0.5 0.5
             0 0 0   1 ]

**View matrix**, from `lookAt(e, a, u)` with eye point e, look-at point a and up vector u:

    b3 = (e - a) / |e - a|,   b1 = (u x b3) / |u x b3|,   b2 = b3 x b1

    V = R T,   T = [ I  -e ],   R = [ A 0 ],   A = [ b1  b2  b3 ]^T
                   [ 0   1 ]        [ 0 1 ]

**Orthographic projection (Part 1)**, from `ortho(l, r, b, t, n, f)`:

    P_ortho = [ 2/(r-l)  0        0         -(r+l)/(r-l)
                0        2/(t-b)  0         -(t+b)/(t-b)
                0        0       -2/(f-n)   -(f+n)/(f-n)
                0        0        0          1 ]

**Perspective projection (Part 2)**, from `perspective(alpha, A, n, f)` with alpha = 45 degrees and A = w/h:

    P_persp = [ cot(alpha/2)/A  0            0            0
                0               cot(alpha/2) 0            0
                0               0            (n+f)/(n-f)  2nf/(n-f)
                0               0           -1            0 ]

**Model matrices**, built from elementary transformations:

- Translation: `T(t) = [ I t; 0 1 ]`
- Rotation: `R_x(theta)`, `R_y(theta)`, each of the form `[ A 0; 0 1 ]` with A a 3x3 rotation matrix.
- Rotation about the cube center c = (0.5, 0.5, 0.5): `R_c(R) = T(c) R T(-c)`. The rotations are about the cube's center, not the origin, because the cube's corner sits at the origin.

## Composite matrices used in the vertex shader

The vertex shader computes `x_clip = MVP * x_model`, where the composite matrix is:

**Part 1: isometric cube** (model matrix is the identity):

    MVP = M_st * P_ortho * V

where V = lookAt(c + (2,2,2), c, (0,1,0)), so the view direction is along the cube diagonal.

**Part 2: common factor** (camera looks along -z, alpha = 45 degrees):

    PV = M_st * P_persp * V,   V = lookAt((0.5, 0.5, 8), c, (0,1,0))

**Part 2: one-point cube** (axis-aligned, only translated):

    MVP_1 = PV * T(t_1)

**Part 2: two-point cube** (rotated 45 degrees about y):

    MVP_2 = PV * T(c) * R_y(45) * T(-c)

**Part 2: three-point cube** (rotated about y, then x, then translated):

    MVP_3 = PV * T(t_3) * T(c) * R_x(35) * R_y(45) * T(-c)

The rightmost matrix acts first: the cube is moved so its center is at the origin, rotated, moved back, and translated to its place in the scene (model matrix). It is then transformed to eye space (V), projected (P) and remapped to WebGPU's depth range (M_st). The division by w afterwards gives NDC.

## Why the views look the way they do

- One-point: no rotation, so two principal axes are parallel to the image plane and the edges along z meet at one vanishing point.
- Two-point: rotating about y alone keeps the y axis parallel to the image plane, so there are two vanishing points.
- Three-point: adding a rotation about x leaves no axis parallel to the image plane, so there are three vanishing points.
- Isometric: an orthographic projection along (1,1,1) foreshortens all three principal directions equally, so the three edges at a corner have equal length in the image, with no vanishing points.