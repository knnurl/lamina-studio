# Vendored code

Third-party code, checked in at pinned versions so `index.html` builds and runs with no network and no npm install. Never edit these files except for the patches listed here. To upgrade, re-run the steps and update this table and SPEC section 14.

| Path | Package | Version | Licence | Source |
|---|---|---|---|---|
| `clipper2/clipper2.min.mjs` | clipper2-ts (countertype) | 2.0.1-18 | BSL-1.0 | `npm pack clipper2-ts@2.0.1-18`, `package/dist/clipper2.min.mjs` |
| `three/three.core.js`, `three/three.module.js` | three | 0.186.1 | MIT | `npm pack three@0.186.1`, `package/build/` |
| `three/OrbitControls.js` | three | 0.186.1 | MIT | `package/examples/jsm/controls/OrbitControls.js` |

## Local patches

- `three/OrbitControls.js` line 12: `} from 'three';` becomes `} from './three.module.js';`. The Lamina bundler resolves relative paths only.

## Steps

```
npm pack three@0.186.1 clipper2-ts@2.0.1-18
tar -xzf three-0.186.1.tgz -C three && tar -xzf clipper2-ts-2.0.1-18.tgz -C clip
cp clip/package/dist/clipper2.min.mjs clip/package/LICENSE src/vendor/clipper2/
cp three/package/build/three.core.js three/package/build/three.module.js three/package/LICENSE src/vendor/three/
sed "s#^} from 'three';#} from './three.module.js';#" \
    three/package/examples/jsm/controls/OrbitControls.js > src/vendor/three/OrbitControls.js
```
