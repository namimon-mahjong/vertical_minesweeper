"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";

type Cell = { mine: boolean; revealed: boolean; flagged: boolean; number: number };
type Pos = { x: number; y: number; z: number };
const SIZE = 7, HEIGHT = 3;
const dirs: Pos[] = [{ x: 0, y: 0, z: -1 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }];
const k = (x: number, y: number, z: number) => `${x},${y},${z}`;
const inBounds = (x: number, y: number, z: number) => x >= 0 && x < SIZE && z >= 0 && z < SIZE && y >= 0 && y < HEIGHT;

function makeBoard() {
  const b: Record<string, Cell> = {};
  for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) b[k(x,y,z)] = { mine: Math.random() < .16 && !(x === 3 && z === 3 && y === 0), revealed: false, flagged: false, number: 0 };
  for (let y = 0; y < HEIGHT; y++) for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) {
    let n = 0; for (let dy=-1; dy<=1; dy++) for (let dz=-1; dz<=1; dz++) for (let dx=-1; dx<=1; dx++) if ((dx||dy||dz) && inBounds(x+dx,y+dy,z+dz) && b[k(x+dx,y+dy,z+dz)].mine) n++;
    b[k(x,y,z)].number = n;
  } return b;
}

export default function Home() {
  const host = useRef<HTMLDivElement>(null); const sceneRef = useRef<THREE.Scene | null>(null);
  const game = useRef({ board: makeBoard(), player: { x:3,y:0,z:3 }, facing:0, over:false });
  const [ui, setUi] = useState({ mines: 0, flags: 0, message: "SECTOR ACTIVE" });
  const renderGame = useCallback(() => {
    const scene = sceneRef.current; if (!scene) return;
    scene.children.filter(o => o.userData.game).forEach(o => scene.remove(o));
    const { board, player, facing } = game.current; const group = new THREE.Group(); group.userData.game = true; scene.add(group);
    const target = new Set< string >(); const f = dirs[facing];
    [[player.x+f.x, player.y, player.z+f.z],[player.x,player.y-1,player.z],[player.x+f.x,player.y-1,player.z+f.z]].forEach(([x,y,z]) => { if(inBounds(x,y,z)) target.add(k(x,y,z)); });
    let flags=0, mines=0;
    Object.entries(board).forEach(([id, cell]) => { const [x,y,z]=id.split(",").map(Number); if(cell.mine) mines++; if(cell.flagged) flags++;
      const material = new THREE.MeshStandardMaterial({ color: cell.revealed ? (cell.mine ? 0xef4444 : 0x213044) : target.has(id) ? 0xf6c453 : 0x55708a, roughness:.72, emissive: target.has(id) ? 0x6a4700 : 0x000000, emissiveIntensity:.45 });
      const cube = new THREE.Mesh(new THREE.BoxGeometry(.92,.92,.92), material); cube.position.set(x-(SIZE-1)/2,y,z-(SIZE-1)/2); cube.userData={game:true, cell:id}; group.add(cube);
      if (cell.flagged) { const pole = new THREE.Mesh(new THREE.BoxGeometry(.05,.55,.05),new THREE.MeshStandardMaterial({color:0xf8fafc})); pole.position.copy(cube.position).add(new THREE.Vector3(0,.65,0)); pole.userData.game=true; group.add(pole); const flag=new THREE.Mesh(new THREE.BoxGeometry(.3,.18,.03),new THREE.MeshStandardMaterial({color:0xf43f5e})); flag.position.copy(cube.position).add(new THREE.Vector3(.17,.83,0)); flag.userData.game=true; group.add(flag); }
      if (cell.revealed && !cell.mine && cell.number && y < HEIGHT-1) { const sp = document.createElement('canvas'); sp.width=64;sp.height=64;const c=sp.getContext('2d')!;c.fillStyle='#e8f1ff';c.font='bold 48px Arial';c.textAlign='center';c.fillText(String(cell.number),32,51);const s=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(sp),transparent:true}));s.position.copy(cube.position).add(new THREE.Vector3(0,.52,0));s.scale.set(.44,.44,1);s.userData.game=true;group.add(s); }
    });
    const dummy = new THREE.Group(); dummy.userData.game=true; const body = new THREE.Mesh(new THREE.CapsuleGeometry(.24,.5,4,8),new THREE.MeshStandardMaterial({color:0x75e4d4,emissive:0x164e63})); body.position.y=.75; dummy.add(body); const eye=new THREE.Mesh(new THREE.BoxGeometry(.18,.12,.04),new THREE.MeshStandardMaterial({color:0x102235})); eye.position.set(0,.88,-.24); dummy.add(eye); dummy.position.set(player.x-(SIZE-1)/2,player.y,player.z-(SIZE-1)/2); dummy.rotation.y=facing*Math.PI/2; group.add(dummy);
    setUi(s=>({ ...s, flags, mines }));
  }, []);
  useEffect(() => { if(!host.current) return; const scene=new THREE.Scene();scene.background=new THREE.Color(0x07111f);sceneRef.current=scene; const cam=new THREE.PerspectiveCamera(42,1,.1,100);cam.position.set(8,10,10);cam.lookAt(0,1,0); const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));host.current.appendChild(renderer.domElement);const light=new THREE.DirectionalLight(0xeaf6ff,2.5);light.position.set(4,9,3);scene.add(light,new THREE.AmbientLight(0x48667c,1.4),new THREE.GridHelper(10,10,0x365169,0x162537)); const ray=new THREE.Raycaster(), mouse=new THREE.Vector2();
    const resize=()=>{const w=host.current!.clientWidth,h=host.current!.clientHeight;renderer.setSize(w,h);cam.aspect=w/h;cam.updateProjectionMatrix()};resize();addEventListener('resize',resize);let frame=0;const loop=()=>{frame=requestAnimationFrame(loop);renderer.render(scene,cam)};loop();
    const act=(flag=false)=>{ const g=game.current, f=dirs[g.facing], id=k(g.player.x+f.x,g.player.y,g.player.z+f.z), c=g.board[id];if(!c||g.over)return;if(flag){c.flagged=!c.flagged}else{c.revealed=true;if(c.mine){g.over=true;setUi(s=>({...s,message:'MINE DETONATED'}))}else if(c.number===0) Object.entries(g.board).forEach(([key,v])=>{const [x,y,z]=key.split(',').map(Number);if(Math.abs(x-g.player.x-f.x)<=1&&Math.abs(y-g.player.y)<=1&&Math.abs(z-g.player.z-f.z)<=1)v.revealed=true});}renderGame();};
    const click=(e:MouseEvent)=>{const r=renderer.domElement.getBoundingClientRect();mouse.set(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);ray.setFromCamera(mouse,cam);const hit=ray.intersectObjects(scene.children,true).find(v=>v.object.userData.cell);if(hit){const c=game.current.board[hit.object.userData.cell];if(e.button===2)c.flagged=!c.flagged;else {c.revealed=true;if(c.mine){game.current.over=true;setUi(s=>({...s,message:'MINE DETONATED'}))}}renderGame()}else act(e.button===2)}; renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());renderer.domElement.addEventListener('mousedown',click);
    const key=(e:KeyboardEvent)=>{const g=game.current;const key=e.key.toLowerCase();if(key===' '){e.preventDefault();act(false);return}if(key==='shift'){act(true);return}let d=-1;if(key==='w'||key==='arrowup')d=0;if(key==='d'||key==='arrowright')d=1;if(key==='s'||key==='arrowdown')d=2;if(key==='a'||key==='arrowleft')d=3;if(d<0)return;g.facing=d;const v=dirs[d], nx=g.player.x+v.x,nz=g.player.z+v.z;if(inBounds(nx,g.player.y,nz)){if(g.player.y<HEIGHT-1&&g.board[k(nx,g.player.y+1,nz)].revealed)g.player.y++;g.player.x=nx;g.player.z=nz}renderGame()};addEventListener('keydown',key);renderGame();return()=>{cancelAnimationFrame(frame);removeEventListener('resize',resize);removeEventListener('keydown',key);renderer.dispose();host.current?.replaceChildren()}; },[renderGame]);
  const restart=()=>{game.current={board:makeBoard(),player:{x:3,y:0,z:3},facing:0,over:false};setUi(s=>({...s,message:'SECTOR ACTIVE'}));renderGame()};
  return <main><section className="hud"><div><p className="eyebrow">VERTICAL MINESWEEPER / 03 LAYERS</p><h1>DEEP <span>FIELD</span></h1></div><div className="stat"><b>{ui.mines}</b><small>MINES</small></div><div className="stat"><b>{ui.flags}</b><small>FLAGS</small></div><button onClick={restart}>NEW FIELD</button></section><section className="game"><div ref={host} className="canvas"/><aside><div className="status"><i/> {ui.message}</div><h2>COMMANDS</h2><p><kbd>W A S D</kbd> / <kbd>↑ ↓ ← →</kbd><br/>Move + face direction</p><p><kbd>SPACE</kbd> / <kbd>LEFT CLICK</kbd><br/>Excavate highlighted block</p><p><kbd>SHIFT</kbd> / <kbd>RIGHT CLICK</kbd><br/>Place marker flag</p><div className="rule"><strong>FIELD RULE</strong><br/>You can ascend only one layer. Mine counts appear on all exposed block tops, except the highest layer.</div></aside></section></main>;
}
