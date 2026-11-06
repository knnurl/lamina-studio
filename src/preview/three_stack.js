// 3D stack preview (SPEC 10). Extrudes each layer's paths at its thickness, stacks them front
// (index 0, nearest the viewer, highest z) to back with their gaps, orbit and tilt with
// OrbitControls, and renders on demand. Lighting modes, material looks and the exploded view
// arrive in the previews slice.
// Assumptions: paths in micrometres, outer boundaries have positive area and holes negative.
import {
    WebGLRenderer,
    Scene,
    PerspectiveCamera,
    Shape,
    Path,
    Vector2,
    ExtrudeGeometry,
    MeshStandardMaterial,
    Mesh,
    Group,
    AmbientLight,
    DirectionalLight,
    MathUtils,
} from '../vendor/three/three.module.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { kUmPerMm } from '../core/units.js';
import { layer_thickness_mm } from '../core/design.js';

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

export class StackPreview {
    constructor(container) {
        this.container_ = container;
        this.renderer_ = new WebGLRenderer({ antialias: true, alpha: true });
        this.renderer_.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        container.append(this.renderer_.domElement);

        this.scene_ = new Scene();
        this.camera_ = new PerspectiveCamera(32, 1, 1, 20000);
        this.scene_.add(new AmbientLight(0xffffff, 0.55));
        const key = new DirectionalLight(0xffffff, 2.2);
        key.position.set(-400, 500, 900);
        this.scene_.add(key);
        const rim = new DirectionalLight(0x46b4ff, 0.8);
        rim.position.set(500, -300, -200);
        this.scene_.add(rim);
        this.stack_ = new Group();
        this.scene_.add(this.stack_);

        this.controls_ = new OrbitControls(this.camera_, this.renderer_.domElement);
        this.controls_.addEventListener('change', () => this.render());

        this.resize_observer_ = new ResizeObserver(() => this.resize_());
        this.resize_observer_.observe(container);
        this.resize_();
    }

    // built: [{ material: paths }] front first, as the worker returned them for design. Each layer
    // is extruded at its real thickness; the back layer sits at z = 0 and each layer in front sits
    // on the one behind plus its gap. The camera is reframed only when the piece's size changes.
    show(design, built) {
        for (const mesh of this.stack_.children) {
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
        this.stack_.clear();
        let z = 0;
        let radius_mm = 1;
        for (let k = built.length - 1; k >= 0; k--) {
            const layer = design.layers[k];
            const thickness_mm = layer_thickness_mm(design, layer);
            const geometry = new ExtrudeGeometry(to_shapes(built[k].material), { depth: thickness_mm, bevelEnabled: false });
            geometry.computeBoundingSphere();
            radius_mm = Math.max(radius_mm, geometry.boundingSphere.radius);
            const material = new MeshStandardMaterial({ color: layer.finish.colour, roughness: 0.8, metalness: 0 });
            const mesh = new Mesh(geometry, material);
            mesh.position.z = z;
            this.stack_.add(mesh);
            z += thickness_mm + (k > 0 ? design.layers[k - 1].gap_mm : 0);
        }
        const o = design.piece.outline;
        const frame_key = `${o.kind}|${o.w_mm}|${o.h_mm}|${built.length}`;
        if (frame_key !== this.frame_key_) {
            this.frame_key_ = frame_key;
            this.frame_(radius_mm, z);
        }
        this.render();
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
