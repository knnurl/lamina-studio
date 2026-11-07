// 3D stack preview (SPEC 10). Extrudes each layer at its real thickness, stacks them front (index
// 0, nearest the viewer, highest z) to back with their gaps, orbit and tilt with OrbitControls,
// and renders on demand.
// - Faces take the layer's finish; cut edges take the material's edge colour (charred ply and MDF,
//   a darker tone for acrylic). Translucent materials are drawn see-through.
// - Backlit: a glowing panel in the light colour, cut to the piece's silhouette, sits behind the
//   stack; translucent layers pick up the light, and the room light dims, so openings glow.
// - Exploded: spreads the layers apart along z for reading the stack; the design is unchanged.
// Assumptions: paths in micrometres, outer boundaries have positive area and holes negative.
import {
    WebGLRenderer,
    Scene,
    PerspectiveCamera,
    Shape,
    Path,
    Vector2,
    ExtrudeGeometry,
    ShapeGeometry,
    MeshStandardMaterial,
    MeshBasicMaterial,
    Mesh,
    Group,
    Color,
    AmbientLight,
    DirectionalLight,
    MathUtils,
} from '../vendor/three/three.module.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { kUmPerMm } from '../core/units.js';
import { layer_thickness_mm, material_of } from '../core/design.js';

const kCharColour = '#3a2516';
const kExplodeMm = 28; // extra spacing per layer at full explode

function signed_area(path) {
    let a = 0;
    for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
        a += (path[j].x - path[i].x) * (path[j].y + path[i].y);
    }
    return a / 2;
}

function point_in_path(p, path) {
    let inside = false;
    for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
        const a = path[i];
        const b = path[j];
        if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }
    return inside;
}

const to_mm = path => path.map(v => new Vector2(v.x / kUmPerMm, v.y / kUmPerMm));

// Groups flat Clipper output into three.js shapes: each hole goes to the smallest outer containing it.
function to_shapes(paths) {
    const outers = [];
    const holes = [];
    for (const path of paths) (signed_area(path) > 0 ? outers : holes).push(path);
    const shapes = outers
        .map(path => ({ path, area: signed_area(path), shape: new Shape(to_mm(path)) }))
        .sort((a, b) => a.area - b.area);
    for (const hole of holes) {
        const owner = shapes.find(s => point_in_path(hole[0], s.path));
        if (owner) owner.shape.holes.push(new Path(to_mm(hole)));
    }
    return shapes.map(s => s.shape);
}

function materials_for(design, layer) {
    const mat = material_of(design, layer);
    const finish = new Color(layer.finish.colour);
    const backlit = design.piece.lighting.mode === 'backlit';
    const light = new Color(design.piece.lighting.colour);
    const translucent = mat.look.translucent;
    const face = new MeshStandardMaterial({
        color: finish,
        roughness: translucent ? 0.35 : 0.8,
        metalness: 0,
        transparent: translucent,
        opacity: translucent ? 0.6 : 1,
        emissive: backlit && translucent ? light : new Color(0, 0, 0),
        emissiveIntensity: backlit && translucent ? 0.55 : 0,
    });
    const edge_colour = layer.material.startsWith('acr') ? finish.clone().multiplyScalar(0.7) : new Color(kCharColour);
    const side = new MeshStandardMaterial({
        color: edge_colour,
        roughness: 0.9,
        metalness: 0,
        transparent: translucent,
        opacity: translucent ? 0.75 : 1,
    });
    return [face, side];
}

export class StackPreview {
    constructor(container) {
        this.container_ = container;
        this.renderer_ = new WebGLRenderer({ antialias: true, alpha: true });
        this.renderer_.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        container.append(this.renderer_.domElement);

        this.scene_ = new Scene();
        this.camera_ = new PerspectiveCamera(32, 1, 1, 20000);
        this.ambient_ = new AmbientLight(0xffffff, 0.55);
        this.key_ = new DirectionalLight(0xffffff, 2.2);
        this.key_.position.set(-400, 500, 900);
        this.rim_ = new DirectionalLight(0x46b4ff, 0.8);
        this.rim_.position.set(500, -300, -200);
        this.scene_.add(this.ambient_, this.key_, this.rim_);
        this.stack_ = new Group();
        this.scene_.add(this.stack_);
        this.explode_ = 0;

        this.controls_ = new OrbitControls(this.camera_, this.renderer_.domElement);
        this.controls_.addEventListener('change', () => this.render());

        this.resize_observer_ = new ResizeObserver(() => this.resize_());
        this.resize_observer_.observe(container);
        this.resize_();
    }

    // built: [{ material: paths, material_key }] front first, as the worker returned them for
    // design. The back layer sits at z = 0 and each layer in front sits on the one behind plus its
    // gap. The camera is reframed only when the piece's size changes.
    // Extruded geometry is kept by material_key and thickness: triangulating a dense lattice layer
    // is the main cost of a redraw, and an edit usually changes one layer.
    show(design, built) {
        const old = this.geometries_ ?? new Map();
        const next = new Map();
        for (const mesh of this.stack_.children) {
            if (!mesh.userData.cached) mesh.geometry.dispose();
            for (const m of [mesh.material].flat()) m.dispose();
        }
        this.stack_.clear();
        let z = 0;
        let radius_mm = 1;
        for (let k = built.length - 1; k >= 0; k--) {
            const layer = design.layers[k];
            const thickness_mm = layer_thickness_mm(design, layer);
            const key = built[k].material_key ? `${built[k].material_key}|${thickness_mm}` : null;
            let geometry = key && (next.get(key) ?? old.get(key));
            if (!geometry) {
                geometry = new ExtrudeGeometry(to_shapes(built[k].material), { depth: thickness_mm, bevelEnabled: false });
                geometry.computeBoundingSphere();
            }
            if (key) next.set(key, geometry);
            radius_mm = Math.max(radius_mm, geometry.boundingSphere.radius);
            const mesh = new Mesh(geometry, materials_for(design, layer));
            mesh.userData = { base_z: z, from_back: built.length - 1 - k, cached: !!key };
            this.stack_.add(mesh);
            z += thickness_mm + (k > 0 ? design.layers[k - 1].gap_mm : 0);
        }

        for (const [key, g] of old) if (!next.has(key)) g.dispose();
        this.geometries_ = next;

        const backlit = design.piece.lighting.mode === 'backlit';
        this.ambient_.intensity = backlit ? 0.22 : 0.55;
        this.key_.intensity = backlit ? 0.9 : 2.2;
        if (backlit && built.length) {
            // The glow panel follows the back layer's silhouette, a few mm behind it.
            const back = built[built.length - 1].material;
            const outline = back.filter(p => signed_area(p) > 0).sort((a, b) => signed_area(b) - signed_area(a))[0];
            if (outline) {
                const glow = new Mesh(
                    new ShapeGeometry(to_shapes([outline])),
                    new MeshBasicMaterial({ color: new Color(design.piece.lighting.colour).multiplyScalar(1.6) }),
                );
                glow.userData = { base_z: -6, from_back: -1 };
                this.stack_.add(glow);
            }
        }

        this.place_();
        const o = design.piece.outline;
        const frame_key = `${o.kind}|${o.w_mm}|${o.h_mm}|${built.length}`;
        if (frame_key !== this.frame_key_) {
            this.frame_key_ = frame_key;
            this.depth_mm_ = z;
            this.frame_(radius_mm, z);
        }
        this.render();
    }

    // f in 0..1 spreads the layers apart along z.
    set_explode(f) {
        this.explode_ = f;
        this.place_();
        this.render();
    }

    place_() {
        for (const mesh of this.stack_.children) {
            const { base_z, from_back } = mesh.userData;
            mesh.position.z = base_z + this.explode_ * kExplodeMm * Math.max(0, from_back);
        }
    }

    render() {
        this.renderer_.render(this.scene_, this.camera_);
    }

    // A PNG of the current view, for the export zip. Rendered and read in the same task, so the
    // drawing buffer is still intact.
    capture_png() {
        this.render();
        return new Promise(resolve => {
            this.renderer_.domElement.toBlob(async blob => resolve(blob ? new Uint8Array(await blob.arrayBuffer()) : null), 'image/png');
        });
    }

    // three.js sets an inline display on its canvas, which beats the [hidden] attribute.
    set_visible(on) {
        this.renderer_.domElement.style.display = on ? 'block' : 'none';
        if (on) this.resize_();
    }

    frame_(radius_mm, depth_mm) {
        const fov = MathUtils.degToRad(this.camera_.fov);
        const distance = (radius_mm / Math.sin(fov / 2)) * 1.08;
        const target_z = depth_mm / 2;
        this.camera_.position.set(distance * 0.28, -distance * 0.22, target_z + distance * 0.93);
        this.controls_.target.set(0, 0, target_z);
        this.controls_.update();
    }

    resize_() {
        const w = Math.max(1, this.container_.clientWidth);
        const h = Math.max(1, this.container_.clientHeight);
        this.renderer_.setSize(w, h, false);
        this.camera_.aspect = w / h;
        this.camera_.updateProjectionMatrix();
        this.render();
    }
}
