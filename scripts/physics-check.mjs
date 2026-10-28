import * as THREE from 'three';
import { Physics } from '../src/physics.js';
const P = new Physics(); await P.init();
function test(name, pos, euler, v, w) {
  const mesh = new THREE.Object3D(); mesh.position.set(...pos); mesh.quaternion.setFromEuler(new THREE.Euler(...euler));
  const e = {}; P.addCard(e, mesh, new THREE.Vector3(...v), new THREE.Vector3(...w));
  let t=0, land=null, maxy=0;
  for (let i=0;i<600;i++){ P.step(1/60); t+=1/60; if(!land && mesh.position.y<0.5) land=[t.toFixed(2), mesh.position.x.toFixed(1), mesh.position.z.toFixed(1)]; }
  const n = new THREE.Vector3(0,0,1).applyQuaternion(mesh.quaternion);
  console.log(name, 'land', land, 'final', mesh.position.toArray().map(x=>x.toFixed(2)), 'normalY', n.y.toFixed(2), 'resting', P.isResting(e));
}
test('drop flat', [0,40,0], [-Math.PI/2,0,0], [0,0,0],[0,0,0]);
test('drop vertical', [10,40,0], [0,0,0], [0,0,0],[0,0,0]);
test('drop 30deg', [20,40,0], [-Math.PI/2+0.5,0,0], [0,0,0],[0,0,0]);
test('toss flat spin', [0,30,30], [-Math.PI/2,0,0], [0,120,-250],[0,8,0]);
test('fling upright', [0,30,30], [-0.3,0,0], [0,150,-300],[-6,0,0]);
