import * as THREE from 'three';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/barlow/800.css';
import '@fontsource/barlow/900.css';
import '@fontsource/barlow/800-italic.css';
import '@fontsource/barlow/900-italic.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './style.css';

import { Stage, ENVIRONMENTS } from './scene.js';
import { Physics } from './physics.js';
import { Card, updateCardTime, setCardQuality } from './card/Card.js';
import { initFaceTextures, cardFaceTexture, scanAvailability } from './card/faceTextures.js';
import { BoosterPack, PACK_TEAR_Y } from './pack.js';
import { Effects } from './fx.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { SETS, TIER_COLORS, TYPE_COLORS, CARD_W, CARD_H, PACK_W, PACK_H } from './config.js';
import { loadSet, generatePack } from './packGen.js';

const V3 = THREE.Vector3, Q4 = THREE.Quaternion;
const _v = new V3(), _v2 = new V3(), _q = new Q4(), _q2 = new Q4(), _e = new THREE.Euler();
const Y_AXIS = new V3( 0, 1, 0 );
const params = new URLSearchParams( location.search );
const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow( -2 * t + 2, 3 ) / 2;
const clamp = ( x, a, b ) => Math.min( b, Math.max( a, x ) );
const DT_MAX = +( params.get( 'dtmax' ) || 0.05 );

// ------------------------------------------------------------------ spring dynamics

// damped 6-DOF spring that drags an object toward a target pose; gives held objects mass and inertia
class Spring {
	constructor( k = 240, zeta = 0.72 ) { this.k = k; this.zeta = zeta; this.vel = new V3(); this.ang = new V3(); }
	reset() { this.vel.set( 0, 0, 0 ); this.ang.set( 0, 0, 0 ); return this; }
	step( obj, tp, tq, dt ) {
		const k = this.k, c = 2 * Math.sqrt( k ) * this.zeta;
		const n = Math.max( 1, Math.ceil( dt / ( 1 / 240 ) ) ), h = dt / n;
		for ( let i = 0; i < n; i ++ ) {
			_v.subVectors( tp, obj.position ).multiplyScalar( k ).addScaledVector( this.vel, -c );
			this.vel.addScaledVector( _v, h );
			obj.position.addScaledVector( this.vel, h );
			_q.copy( obj.quaternion ).invert().premultiply( tq );
			if ( _q.w < 0 ) _q.set( -_q.x, -_q.y, -_q.z, -_q.w );
			const w = clamp( _q.w, -1, 1 ), s = Math.sqrt( 1 - w * w ), ang = 2 * Math.acos( w );
			if ( s > 1e-5 ) _v2.set( _q.x / s, _q.y / s, _q.z / s ).multiplyScalar( ang ); else _v2.set( 0, 0, 0 );
			_v2.multiplyScalar( k ).addScaledVector( this.ang, -c );
			this.ang.addScaledVector( _v2, h );
			const a = this.ang.length() * h;
			if ( a > 1e-7 ) {
				_q2.setFromAxisAngle( _v.copy( this.ang ).normalize(), a );
				obj.quaternion.premultiply( _q2 ).normalize();
			}
		}
	}
}

// ------------------------------------------------------------------ persistence

const STORE = 'pkm-pack-sim-v1';
function loadStore() {
	try { return Object.assign( { packs: 0, hits: 0, collection: {}, settings: {} }, JSON.parse( localStorage.getItem( STORE ) || '{}' ) ); }
	catch ( e ) { return { packs: 0, hits: 0, collection: {}, settings: {} }; }
}
function saveStore( s ) { try { localStorage.setItem( STORE, JSON.stringify( s ) ); } catch ( e ) { /* private mode */ } }

const QUALITY = {
	low: { pr: 1, samples: 3, orders: 1, shadow: 1024 },
	medium: { pr: Math.min( window.devicePixelRatio, 1.5 ), samples: 5, orders: 2, shadow: 2048 },
	high: { pr: Math.min( window.devicePixelRatio, 2 ), samples: 8, orders: 2, shadow: 4096 },
};

// ------------------------------------------------------------------ app

class App {
	async init() {
		this.ui = new UI();
		this.store = loadStore();
		this.canvas = document.getElementById( 'gl' );
		this.stage = new Stage( this.canvas );
		initFaceTextures( this.stage.renderer );
		this.audio = new Audio();
		this.fx = new Effects( this.stage, this.audio );
		this.physics = new Physics();
		this.ui.loadingText( '初始化物理引擎…' );
		await this.physics.init();
		this.physics.onImpact = ( e, f ) => { if ( e.isCard || e.kind ) this.audio.slap( f ); };

		const st = this.store.settings;
		this.ui.loadingText( '载入环境光照…' );
		await this.stage.setEnvironment( st.env || 'studio' );
		this.applyQuality( st.quality || ( matchMedia( '(max-width: 720px)' ).matches ? 'low' : 'medium' ) );

		this.setId = st.set && SETS.some( s => s.id === st.set ) ? st.set : SETS[ 0 ].id;
		this.setDatas = {};
		this.ui.loadingText( '载入卡牌数据…' );
		await Promise.all( SETS.map( async m => { this.setDatas[ m.id ] = await loadSet( m.id ); } ) );

		this.state = 'menu';
		this.tableCards = [];
		this.debris = [];
		this.slot = 0;
		this.raycaster = new THREE.Raycaster();
		this.pointer = { ndc: new THREE.Vector2( 0, 0 ), x: 0, y: 0, down: false, startX: 0, startY: 0, startT: 0, moved: 0, history: [] };
		this.lightFollow = false;
		this.hoverTilt = new THREE.Vector2();
		this.gyro = null;
		this.time = 0;
		this.computeFrames();
		this.stage.onResize = () => this.computeFrames();

		this.bindUI();
		this.bindInput();
		this.ui.buildSetList( this.setDatas, this.setId, id => { this.setId = id; this.saveSettings(); } );
		this.updateStats();
		this.enterMenu();

		this.last = performance.now();
		this.paused = !! params.get( 'paused' );
		this.stage.renderer.setAnimationLoop( () => this.frame() );
		this.ui.doneLoading();
		if ( params.get( 'auto' ) ) setTimeout( () => this.openPack(), 300 );
	}

	// camera-relative frames in which held objects are presented
	computeFrames() {
		// a camera (not a plain Object3D) so that lookAt aims −Z at the target
		const o = new THREE.PerspectiveCamera();
		o.position.copy( this.stage.cameraBase );
		o.lookAt( this.stage.cameraTarget );
		this.camQ = o.quaternion.clone();
		this.fwd = new V3( 0, 0, -1 ).applyQuaternion( this.camQ );
		this.up = new V3( 0, 1, 0 ).applyQuaternion( this.camQ );
		this.right = new V3( 1, 0, 0 ).applyQuaternion( this.camQ );
		const aspect = window.innerWidth / window.innerHeight;
		const dist = aspect < 0.75 ? 26 / Math.max( aspect, 0.42 ) * 0.62 + 18 : 30;
		this.handDist = dist;
		this.anchor = this.stage.cameraBase.clone().addScaledVector( this.fwd, dist ).addScaledVector( this.up, -0.6 );
		this.inspectAnchor = this.stage.cameraBase.clone().addScaledVector( this.fwd, dist * 0.72 );
		this.handPlane = new THREE.Plane().setFromNormalAndCoplanarPoint( this.fwd.clone().negate(), this.anchor );
	}

	saveSettings() {
		const s = this.store.settings;
		s.set = this.setId;
		saveStore( this.store );
	}

	updateStats() {
		const unique = Object.keys( this.store.collection ).length;
		this.ui.stats( { packs: this.store.packs, unique, hits: this.store.hits } );
	}

	applyQuality( q ) {
		const p = QUALITY[ q ] || QUALITY.medium;
		this.quality = q;
		this.stage.setPixelRatio( p.pr );
		setCardQuality( p.samples, p.orders );
		const sh = this.stage.key.shadow;
		if ( sh.mapSize.x !== p.shadow ) {
			sh.mapSize.set( p.shadow, p.shadow );
			sh.map?.dispose(); sh.map = null;
		}
		this.store.settings.quality = q;
		saveStore( this.store );
	}

	// ------------------------------------------------------------------ UI wiring

	bindUI() {
		const e = this.ui.el, st = this.store.settings;
		e.openBtn.onclick = () => this.openPack();
		e.againBtn.onclick = () => this.openPack();
		e.backBtn.onclick = () => this.enterMenu();
		e.clearBtn.onclick = () => this.clearTable();
		e.collectionBtn.onclick = () => this.ui.openCollection( this.setDatas, this.store.collection, this.setId );
		e.tearBtn.onclick = () => this.autoTear();
		e.autoBtn.onclick = () => { this.auto = ! this.auto; e.autoBtn.classList.toggle( 'on', this.auto ); this.autoTimer = 0.3; };
		e.dropBtn.onclick = () => this.dropInspected();

		for ( const env of ENVIRONMENTS ) {
			const o = document.createElement( 'option' ); o.value = env.id; o.textContent = env.zh; e.envSel.appendChild( o );
		}
		e.envSel.value = st.env || 'studio';
		e.envSel.onchange = async () => { await this.stage.setEnvironment( e.envSel.value ); st.env = e.envSel.value; saveStore( this.store ); };
		e.followLight.onchange = () => { this.lightFollow = e.followLight.checked; };
		e.tempSlider.value = st.temp || 4300;
		e.intSlider.value = st.intensity ?? 9000;
		const temp = () => { this.stage.setKeyTemperature( +e.tempSlider.value ); e.tempVal.textContent = e.tempSlider.value + 'K'; st.temp = +e.tempSlider.value; saveStore( this.store ); };
		const inten = () => { this.stage.setKeyIntensity( +e.intSlider.value ); st.intensity = +e.intSlider.value; saveStore( this.store ); };
		e.tempSlider.oninput = temp; e.intSlider.oninput = inten;
		temp(); inten();
		e.qualitySel.value = this.quality;
		e.qualitySel.onchange = () => this.applyQuality( e.qualitySel.value );
		e.bloomChk.checked = st.bloom ?? true;
		this.stage.bloom.enabled = e.bloomChk.checked;
		e.bloomChk.onchange = () => { this.stage.bloom.enabled = e.bloomChk.checked; st.bloom = e.bloomChk.checked; saveStore( this.store ); };
		e.soundChk.checked = st.sound ?? true;
		this.audio.setEnabled( e.soundChk.checked );
		e.soundChk.onchange = () => { this.audio.setEnabled( e.soundChk.checked ); st.sound = e.soundChk.checked; saveStore( this.store ); };
		e.gyroChk.onchange = () => this.toggleGyro( e.gyroChk.checked );
		e.forceSel.value = params.get( 'force' ) || '';
	}

	async toggleGyro( on ) {
		if ( ! on ) { window.removeEventListener( 'deviceorientation', this.onGyro ); this.gyro = null; return; }
		try { if ( typeof DeviceOrientationEvent?.requestPermission === 'function' ) await DeviceOrientationEvent.requestPermission(); } catch ( e ) { /* denied */ }
		this.gyroBase = null;
		this.onGyro = ev => {
			if ( ev.beta == null ) return;
			if ( ! this.gyroBase ) this.gyroBase = { b: ev.beta, g: ev.gamma };
			this.gyro = { x: clamp( ( ev.gamma - this.gyroBase.g ) / 35, -1, 1 ), y: clamp( -( ev.beta - this.gyroBase.b ) / 35, -1, 1 ) };
		};
		window.addEventListener( 'deviceorientation', this.onGyro );
	}

	bindInput() {
		const c = this.canvas;
		c.addEventListener( 'contextmenu', e => e.preventDefault() );
		c.addEventListener( 'pointerdown', e => this.onDown( e ) );
		window.addEventListener( 'pointermove', e => this.onMove( e ) );
		window.addEventListener( 'pointerup', e => this.onUp( e ) );
		window.addEventListener( 'pointercancel', e => this.onUp( e ) );
		c.addEventListener( 'wheel', e => {
			if ( this.state === 'inspect' ) { this.inspectZoom = clamp( ( this.inspectZoom || 0 ) + e.deltaY * 0.01, -6, 6 ); e.preventDefault(); }
		}, { passive: false } );
		window.addEventListener( 'keydown', e => {
			if ( e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' ) return;
			this.audio.unlock();
			if ( e.code === 'Space' || e.code === 'Enter' ) { e.preventDefault(); this.primaryAction(); }
			if ( e.code === 'KeyL' ) { this.lightFollow = ! this.lightFollow; this.ui.el.followLight.checked = this.lightFollow; this.ui.toast( this.lightFollow ? '光源跟随指针：开' : '光源跟随指针：关', 1500 ); }
			if ( e.code === 'KeyA' ) this.ui.el.autoBtn.click();
			if ( e.code === 'Escape' ) { if ( this.state === 'inspect' ) this.dropInspected(); this.ui.show( 'settings', false ); this.ui.show( 'collection', false ); }
		} );
	}

	setPointer( e ) {
		const p = this.pointer;
		p.x = e.clientX; p.y = e.clientY;
		p.ndc.set( e.clientX / window.innerWidth * 2 - 1, - ( e.clientY / window.innerHeight ) * 2 + 1 );
		this.raycaster.setFromCamera( p.ndc, this.stage.camera );
	}

	planePoint( plane, out = new V3() ) { return this.raycaster.ray.intersectPlane( plane, out ); }

	onDown( e ) {
		this.audio.unlock();
		this.setPointer( e );
		const p = this.pointer;
		p.down = true; p.id = e.pointerId; p.button = e.button; p.startX = e.clientX; p.startY = e.clientY; p.startT = performance.now(); p.moved = 0;
		p.history = [];
		this.canvas.setPointerCapture?.( e.pointerId );
		if ( e.button === 2 || ( e.pointerType === 'touch' && this.touches?.size >= 1 ) ) { this.lightDrag = true; this.moveLight(); return; }
		( this.touches ||= new Set() ).add( e.pointerId );

		if ( this.state === 'pack' && this.pack ) {
			const hit = this.raycaster.intersectObject( this.pack.group, true )[ 0 ];
			if ( hit ) {
				const local = this.pack.group.worldToLocal( hit.point.clone() );
				const front = -PACK_W / 2 + PACK_W * this.pack.tearProgress;
				if ( local.y > PACK_TEAR_Y - 1.4 && ( Math.abs( local.x - front ) < 2.4 || this.pack.tearProgress === 0 && local.x < 0 ) ) {
					this.tearing = { lastX: local.x, lastT: performance.now() };
					this.audio.crinkle( 0.5 );
					return;
				}
				this.packDrag = { x: e.clientX, y: e.clientY };
				this.audio.crinkle( 0.6 );
			}
		} else if ( this.state === 'extract' ) {
			this.extractDrag = { y: e.clientY, start: this.extractT };
		} else if ( this.state === 'reveal' ) {
			const top = this.cards[ this.topIdx ];
			if ( top && top.mode === 'display' ) {
				const hit = this.raycaster.intersectObject( top.mesh, false )[ 0 ];
				if ( hit ) {
					const pt = this.planePoint( this.handPlane );
					this.dragCard = { card: top, offset: pt ? top.mesh.position.clone().sub( pt ) : new V3() };
					top.mode = 'drag';
					this.canvas.classList.add( 'grabbing' );
				}
			}
		} else if ( this.state === 'inspect' ) {
			this.inspectDrag = { x: e.clientX, y: e.clientY };
		}
	}

	onMove( e ) {
		this.setPointer( e );
		const p = this.pointer;
		if ( p.down ) p.moved = Math.max( p.moved, Math.hypot( e.clientX - p.startX, e.clientY - p.startY ) );
		const now = performance.now();
		p.history.push( { t: now, x: e.clientX, y: e.clientY } );
		while ( p.history.length && now - p.history[ 0 ].t > 120 ) p.history.shift();

		if ( this.lightDrag || this.lightFollow ) this.moveLight();
		if ( this.lightDrag ) return;

		if ( this.tearing && this.pack ) {
			const plane = new THREE.Plane().setFromNormalAndCoplanarPoint( new V3( 0, 0, 1 ).applyQuaternion( this.pack.group.quaternion ), this.pack.group.position );
			const pt = this.planePoint( plane );
			if ( pt ) {
				const local = this.pack.group.worldToLocal( pt );
				const dt = Math.max( 1, now - this.tearing.lastT ) / 1000;
				const front = -PACK_W / 2 + PACK_W * this.pack.tearProgress;
				// the tear front follows the finger but cannot jump ahead of it
				const target = clamp( ( Math.min( local.x, front + 1.6 ) + PACK_W / 2 ) / PACK_W, 0, 1.02 );
				const d = this.pack.setTear( target );
				if ( d > 0 ) {
					const speed = d * PACK_W / dt;
					this.audio.tear( speed );
					this.packSpring.ang.z -= d * 18;
					this.packSpring.vel.addScaledVector( this.up, d * 30 );
				}
				this.tearing.lastX = local.x; this.tearing.lastT = now;
				if ( this.pack.tearProgress >= 1 ) this.completeTear();
			}
			return;
		}
		if ( this.packDrag ) {
			const dx = e.clientX - this.packDrag.x, dy = e.clientY - this.packDrag.y;
			this.packDrag.x = e.clientX; this.packDrag.y = e.clientY;
			this.packSpin += dx * 0.012;
			this.packSpinVel = dx * 0.012 / Math.max( 1 / 240, this.dtLast );
			this.packTiltX = clamp( this.packTiltX + dy * 0.006, -0.7, 0.7 );
			return;
		}
		if ( this.extractDrag ) {
			const k = ( this.extractDrag.y - e.clientY ) / ( window.innerHeight * 0.35 );
			this.extractT = clamp( Math.max( this.extractT, this.extractDrag.start + k ), 0, 1 );
			return;
		}
		if ( this.inspectDrag ) {
			const dx = e.clientX - this.inspectDrag.x, dy = e.clientY - this.inspectDrag.y;
			this.inspectDrag.x = e.clientX; this.inspectDrag.y = e.clientY;
			const r = 0.011;
			_q.setFromAxisAngle( Y_AXIS, dx * r );
			this.inspectRot.premultiply( _q );
			_q.setFromAxisAngle( new V3( 1, 0, 0 ), dy * r );
			this.inspectRot.premultiply( _q );
			this.inspectAngVel.set( dy * r, dx * r ).divideScalar( Math.max( 1 / 240, this.dtLast ) );
			return;
		}
		this.updateHover();
	}

	onUp( e ) {
		const p = this.pointer;
		if ( ! p.down ) return;
		p.down = false;
		this.touches?.delete( e.pointerId );
		this.canvas.classList.remove( 'grabbing' );
		const click = p.moved < 8 && performance.now() - p.startT < 450;
		if ( this.lightDrag ) { this.lightDrag = false; return; }
		if ( this.tearing ) { this.tearing = null; return; }
		if ( this.packDrag ) { this.packDrag = null; if ( click ) this.ui.toast( '从左向右拖动卡包顶部的撕口来撕开（或按空格）', 2600 ); return; }
		if ( this.extractDrag ) { this.extractDrag = null; if ( click || this.extractT > 0.55 ) this.extractAuto = true; return; }
		if ( this.inspectDrag ) { this.inspectDrag = null; if ( click ) this.inspectClick( e ); return; }

		if ( this.dragCard ) {
			const c = this.dragCard.card;
			this.dragCard = null;
			const v = this.releaseVelocity();
			if ( v.length() > 70 ) this.fling( c, v );
			else if ( click ) this.tossCard( c );
			else c.mode = 'display';
			return;
		}
		if ( ! click ) return;
		if ( this.state === 'reveal' ) this.primaryAction();
		else if ( this.state === 'menu' || this.state === 'summary' ) {
			const hit = this.raycaster.intersectObjects( this.tableCards.map( c => c.mesh ), false )[ 0 ];
			if ( hit ) this.inspect( hit.object.userData.card );
		}
	}

	// pointer velocity over the last ~100 ms, converted to world units on the hand plane
	releaseVelocity() {
		const h = this.pointer.history;
		if ( h.length < 2 ) return new V3();
		const a = h[ 0 ], b = h[ h.length - 1 ];
		const dt = Math.max( 0.016, ( b.t - a.t ) / 1000 );
		const cmPerPx = 2 * this.handDist * Math.tan( THREE.MathUtils.degToRad( this.stage.camera.fov / 2 ) ) / window.innerHeight;
		const vx = ( b.x - a.x ) / dt * cmPerPx, vy = - ( b.y - a.y ) / dt * cmPerPx;
		return this.right.clone().multiplyScalar( vx ).addScaledVector( this.up, vy );
	}

	moveLight() {
		// place the lamp on a sphere around the presented card, in the direction the pointer indicates
		const p = this.pointer.ndc;
		const dir = new V3( p.x * 1.1, p.y * 1.1 + 0.25, 1 ).normalize();
		dir.applyQuaternion( this.camQ );
		const pos = this.anchor.clone().addScaledVector( dir, 46 );
		pos.y = Math.max( pos.y, 8 );
		this.stage.setKeyPosition( pos );
		this.stage.key.target.position.copy( this.anchor );
	}

	updateHover() {
		const p = this.pointer.ndc;
		this.hoverTilt.set( clamp( p.x, -1, 1 ), clamp( p.y, -1, 1 ) );
		let cursor = '';
		if ( this.state === 'pack' && this.pack ) {
			const hit = this.raycaster.intersectObject( this.pack.group, true )[ 0 ];
			if ( hit ) {
				const l = this.pack.group.worldToLocal( hit.point.clone() );
				cursor = l.y > PACK_TEAR_Y - 1.4 ? 'tear' : '';
			}
		} else if ( this.state === 'reveal' ) {
			const top = this.cards[ this.topIdx ];
			if ( top ) {
				const hit = this.raycaster.intersectObject( top.mesh, false )[ 0 ];
				cursor = hit ? ( top.mode === 'display' ? '' : 'pointer' ) : '';
				// rising tension sound when hovering a glowing card
				if ( hit && ! top.flipped && top.info.tier >= 4 && ! this.chargeStop ) this.chargeStop = this.audio.charge( top.info.tier - 3 );
				if ( ( ! hit || top.flipped ) && this.chargeStop ) { this.chargeStop(); this.chargeStop = null; }
			}
		} else if ( this.state === 'menu' || this.state === 'summary' ) {
			const hit = this.raycaster.intersectObjects( this.tableCards.map( c => c.mesh ), false )[ 0 ];
			cursor = hit ? 'pointer' : '';
		}
		this.canvas.classList.toggle( 'pointer', cursor === 'pointer' );
		this.canvas.classList.toggle( 'tear', cursor === 'tear' );
	}

	primaryAction() {
		if ( this.state === 'menu' || this.state === 'summary' ) return this.openPack();
		if ( this.state === 'pack' ) return this.autoTear();
		if ( this.state === 'extract' ) { this.extractAuto = true; return; }
		if ( this.state === 'inspect' ) return this.dropInspected();
		if ( this.state === 'reveal' ) {
			const top = this.cards[ this.topIdx ];
			if ( ! top ) return;
			if ( top.mode === 'stack' && ! top.flipped ) this.flip( top );
			else if ( top.mode === 'display' && top.flipT >= 1 ) this.tossCard( top );
		}
	}

	// ------------------------------------------------------------------ states

	enterMenu() {
		this.state = 'menu';
		this.ui.show( 'menu' );
		this.ui.show( 'summary', false );
		this.ui.show( 'tearBtn', false );
		this.ui.show( 'autoBtn', false );
		this.ui.show( 'dropBtn', false );
		this.ui.hint( this.tableCards.length ? '点击桌上的卡牌拿起来查看 · 右键拖动移动台灯' : '选择一个扩展包，然后点击「开一包」' );
	}

	async openPack() {
		if ( this.busy ) return;
		this.busy = true;
		this.audio.unlock();
		this.ui.show( 'menu', false );
		this.ui.show( 'summary', false );
		this.ui.hideBanner();
		this.auto = false;
		this.ui.el.autoBtn.classList.remove( 'on' );
		this.cleanupDebris();

		const meta = SETS.find( s => s.id === this.setId );
		const data = this.setDatas[ this.setId ];
		const force = this.ui.el.forceSel.value || null;
		const list = generatePack( data, meta, Math.random, force );
		this.ui.hint( '正在包装卡包…' );
		const pack = await new BoosterPack( meta, data ).build( this.stage.renderer );
		this.pack = pack;
		this.packSpring = new Spring( 160, 0.62 );
		this.packSpin = 0; this.packSpinVel = 0; this.packTiltX = 0;
		pack.group.position.copy( this.anchor ).addScaledVector( this.up, 26 ).addScaledVector( this.fwd, 4 );
		pack.group.quaternion.copy( this.camQ ).multiply( _q.setFromEuler( _e.set( 0.6, 0.8, 0.3 ) ) );
		this.stage.scene.add( pack.group );
		this.audio.crinkle( 1.5 );
		this.state = 'pack';
		this.ui.show( 'tearBtn' );
		this.ui.hint( '拖动旋转卡包 · 沿顶部撕口从左向右拖动撕开 · 空格自动撕开' );

		// card faces load while the user plays with the pack
		this.cards = null;
		this.cardsReady = Promise.all( list.map( d => cardFaceTexture( d, meta.era ) ) ).then( faces => {
			const cards = list.map( ( d, i ) => {
				const c = new Card( d, meta.era, faces[ i ] );
				c.isCard = true;
				c.spring = new Spring( 260, 0.7 );
				c.packIndex = i;
				return c;
			} );
			// put the cards inside the pack, first card at the front
			cards.forEach( ( c, i ) => {
				c.mode = 'pack';
				c.mesh.position.set( 0, -0.5, 0.15 - i * 0.034 );
				c.mesh.quaternion.identity();
				c.mesh.visible = false;
				pack.group.add( c.mesh );
			} );
			this.cards = cards;
			if ( scanAvailability() === 'blocked' && ! this.warnedScan ) {
				this.warnedScan = true;
				this.ui.toast( '无法加载官方卡图（网络或跨域限制），已改用程序绘制的卡面与官方立绘', 5200 );
			}
			return cards;
		} );
		this.busy = false;
	}

	autoTear() {
		if ( this.state !== 'pack' || ! this.pack || this.autoTearing ) return;
		this.autoTearing = true;
	}

	async completeTear() {
		if ( this.state !== 'pack' ) return;
		this.state = 'tearing-done';
		this.tearing = null;
		this.autoTearing = false;
		this.ui.show( 'tearBtn', false );
		const pack = this.pack;
		const strip = pack.detachStrip( this.stage.scene );
		const ent = pack.stripEntity;
		const v = this.packSpring.vel.clone().add( new V3( 18, 55, 12 ) ).addScaledVector( this.right, 20 );
		this.physics.addBox( ent, strip, pack.stripHalf, { mass: 0.35, friction: 0.7, restitution: 0.05, linvel: v,
			angvel: new V3( ( Math.random() - 0.5 ) * 10, ( Math.random() - 0.5 ) * 8, -6 ), aero: true, area: PACK_W * 1.6 } );
		this.debris.push( { entity: ent, object: strip } );
		this.audio.tear( 30 );
		this.audio.crinkle( 1 );
		this.ui.hint( '卡牌准备中…' );
		await this.cardsReady;
		this.cards.forEach( c => { c.mesh.visible = true; } );
		this.extractT = 0;
		this.extractAuto = false;
		this.extractIdle = 0;
		this.state = 'extract';
		this.ui.hint( '向上拖动抽出卡牌（或点击）' );
	}

	finishExtract() {
		const pack = this.pack;
		this.state = 'reveal';
		this.audio.whoosh( 1.2 );
		// cards leave the pack and become independent, spring-driven objects
		for ( const c of this.cards ) {
			this.stage.scene.attach( c.mesh );
			c.mode = 'stack';
			c.spring.reset();
			c.jitter = new V3( ( Math.random() - 0.5 ) * 0.08, ( Math.random() - 0.5 ) * 0.08, ( Math.random() - 0.5 ) * 0.03 );
		}
		this.stackTurn = 0;
		this.topIdx = 0;
		// the empty wrapper is dropped onto the table
		const v = this.packSpring.vel.clone().add( new V3( -48, 22, -38 ) );
		this.physics.addBox( pack, pack.group, new V3( PACK_W / 2 - 0.2, PACK_H / 2 - 1.4, 0.35 ), {
			mass: 4, friction: 0.6, restitution: 0.1, linvel: v, angvel: new V3( 1.5, 2.5, 3 ), aero: true, area: PACK_W * PACK_H * 0.9,
		} );
		pack.kind = 'pack';
		this.debris.push( { entity: pack, object: pack.group, pack } );
		this.pack = null;
		this.ui.show( 'autoBtn' );
		this.ui.hint( '点击卡牌翻开 · 拖拽甩出 · 鼠标移动倾斜观察反光 · 右键拖动移动台灯' );
		this.prepareTop();
	}

	prepareTop() {
		const c = this.cards[ this.topIdx ];
		if ( ! c ) return;
		const t = c.info.tier;
		c.effectColor = t === 3 ? ( TYPE_COLORS[ c.data.t?.[ 0 ] ]?.[ 0 ] || TIER_COLORS[ 3 ] ) : TIER_COLORS[ t ];
		if ( t >= 3 ) {
			const col = new THREE.Color( TIER_COLORS[ t ] );
			c.uniforms.auraColor.value.copy( col ).multiplyScalar( 1.4 );
			c.uniforms.auraRainbow.value = t === 5 ? 1 : 0;
			c.auraTarget = t === 3 ? 0.35 : t === 4 ? 0.7 : 1.1;
			c.anticipating = true;
		}
	}

	flip( c ) {
		if ( c.flipT !== undefined ) return;
		c.flipT = 0;
		c.mode = 'flip';
		this.audio.cardFlip();
		this.chargeStop?.(); this.chargeStop = null;
	}

	onFlipped( c ) {
		c.flipped = true;
		c.anticipating = false;
		c.auraTarget = 0;
		this.fx.clearAnticipation();
		const pos = c.mesh.position.clone(), quat = this.camQ.clone();
		this.fx.reveal( c, pos, quat, this.stage.camera );
		this.ui.banner( c );
		this.recordPull( c );
	}

	recordPull( c ) {
		const col = this.store.collection;
		col[ c.data.id ] = ( col[ c.data.id ] || 0 ) + 1;
		if ( c.info.tier >= 4 ) this.store.hits ++;
		saveStore( this.store );
		this.updateStats();
	}

	// throw from the hand toward a free spot on the playmat
	tossCard( c ) {
		const s = this.slot ++;
		const col = s % 5, row = Math.floor( s / 5 ) % 2, layer = Math.floor( s / 10 );
		const target = new V3( -20 + col * 10 + ( Math.random() - 0.5 ) * 1.6 + ( layer % 3 ) * 0.9, 0.6, -15.5 + row * 10.5 + ( Math.random() - 0.5 ) * 1.4 );
		const T = 0.62;
		const p0 = c.mesh.position.clone();
		const v = target.clone().sub( p0 ).divideScalar( T );
		v.y += 0.5 * 981 * T;
		// rotate from the presented pose to lying face up, plus a little spin
		const flat = new Q4().setFromEuler( _e.set( -Math.PI / 2, ( Math.random() - 0.5 ) * 0.5, 0 ) );
		_q.copy( c.mesh.quaternion ).invert().premultiply( flat );
		if ( _q.w < 0 ) _q.set( -_q.x, -_q.y, -_q.z, -_q.w );
		const ang = 2 * Math.acos( clamp( _q.w, -1, 1 ) ), sn = Math.sqrt( 1 - _q.w * _q.w );
		const w = sn > 1e-4 ? new V3( _q.x / sn, _q.y / sn, _q.z / sn ).multiplyScalar( ang / T ) : new V3();
		w.y += ( Math.random() - 0.5 ) * 2.5;
		this.launch( c, v, w, 0.12 );
	}

	fling( c, vPlane ) {
		const speed = vPlane.length();
		const v = vPlane.clone().multiplyScalar( 1.1 ).addScaledVector( this.fwd, speed * 0.55 ).add( new V3( 0, speed * 0.12, 0 ) );
		const w = new V3().crossVectors( this.fwd.clone().negate(), vPlane ).multiplyScalar( 0.035 );
		w.addScaledVector( this.fwd, ( Math.random() - 0.5 ) * 6 );
		this.launch( c, v, w, 1 );
	}

	launch( c, v, w, aeroScale ) {
		c.mode = 'physics';
		c.bend = 0;
		c.uniforms.uBend.value = 0;
		const rec = this.physics.addCard( c, c.mesh, v, w );
		rec.aeroScale = aeroScale;
		this.tableCards.push( c );
		this.audio.whoosh( v.length() / 200 );
		this.ui.hideBanner();
		if ( this.tableCards.length > 80 ) {
			const old = this.tableCards.shift();
			this.physics.remove( old );
			this.stage.scene.remove( old.mesh );
			old.dispose();
		}
		if ( this.state === 'reveal' && this.cards[ this.topIdx ] === c ) {
			this.topIdx ++;
			if ( this.topIdx >= this.cards.length ) this.finishReveal();
			else this.prepareTop();
		}
	}

	finishReveal() {
		this.state = 'done';
		this.store.packs ++;
		saveStore( this.store );
		this.updateStats();
		this.ui.show( 'autoBtn', false );
		const cards = this.cards;
		setTimeout( () => {
			for ( const c of cards ) if ( ! c.thumb && c.canvas ) {
				const t = document.createElement( 'canvas' ); t.width = 96; t.height = 134;
				t.getContext( '2d' ).drawImage( c.canvas, 0, 0, 96, 134 );
				c.thumbData = t.toDataURL( 'image/jpeg', 0.8 );
			}
			this.ui.summary( cards );
			this.state = 'summary';
			this.ui.hint( '点击桌上的卡牌可以拿起来查看 · 空格再开一包' );
		}, 1100 );
	}

	inspect( c ) {
		this.physics.remove( c );
		this.tableCards = this.tableCards.filter( x => x !== c );
		c.mode = 'inspect';
		c.spring.reset();
		this.inspected = c;
		this.inspectRot = new Q4();
		this.inspectAngVel = new THREE.Vector2();
		this.inspectZoom = 0;
		// keep the side that was facing up toward the viewer
		const n = new V3( 0, 0, 1 ).applyQuaternion( c.mesh.quaternion );
		if ( n.y < 0 ) this.inspectRot.setFromAxisAngle( Y_AXIS, Math.PI );
		this.prevState = this.state;
		this.state = 'inspect';
		this.ui.show( 'menu', false );
		this.ui.show( 'summary', false );
		this.ui.show( 'dropBtn' );
		this.ui.hint( '拖动旋转 · 滚轮缩放 · 右键拖动移动台灯 · Esc / 点击空白处放下' );
		this.audio.whoosh( 0.6 );
		this.ui.banner( c );
	}

	inspectClick( e ) {
		const hit = this.raycaster.intersectObject( this.inspected.mesh, false )[ 0 ];
		if ( ! hit ) this.dropInspected();
	}

	dropInspected() {
		const c = this.inspected;
		if ( ! c ) return;
		this.inspected = null;
		const v = c.spring.vel.clone().add( new V3( ( Math.random() - 0.5 ) * 20, 30, -40 ) );
		this.launch( c, v, c.spring.ang.clone().add( new V3( -2, 0, 0 ) ), 1 );
		this.ui.show( 'dropBtn', false );
		this.ui.hideBanner();
		if ( this.prevState === 'summary' ) { this.state = 'summary'; this.ui.show( 'summary' ); this.ui.hint( '点击桌上的卡牌可以拿起来查看 · 空格再开一包' ); }
		else this.enterMenu();
	}

	clearTable() {
		for ( const c of this.tableCards ) {
			const b = c.body;
			if ( ! b ) continue;
			const p = b.translation();
			const dir = new V3( p.x, 0, p.z ).normalize();
			b.applyImpulse( { x: dir.x * 3 + ( Math.random() - 0.5 ), y: 1.2, z: dir.z * 3 - 1.5 }, true );
			b.applyTorqueImpulse( { x: ( Math.random() - 0.5 ) * 8, y: ( Math.random() - 0.5 ) * 8, z: ( Math.random() - 0.5 ) * 8 }, true );
		}
		const old = this.tableCards;
		this.tableCards = [];
		this.slot = 0;
		this.audio.whoosh( 3 );
		setTimeout( () => {
			for ( const c of old ) { this.physics.remove( c ); this.stage.scene.remove( c.mesh ); c.dispose(); }
		}, 1600 );
		this.cleanupDebris();
		this.ui.hint( '桌面已清理' );
	}

	cleanupDebris() {
		for ( const d of this.debris ) {
			this.physics.remove( d.entity );
			this.stage.scene.remove( d.object );
			d.pack?.dispose();
			d.object.traverse?.( o => o.geometry?.dispose() );
		}
		this.debris = [];
	}

	// ------------------------------------------------------------------ per-frame

	updatePack( dt ) {
		const pack = this.pack;
		if ( ! pack ) return;
		if ( this.autoTearing && this.state === 'pack' ) {
			const d = pack.setTear( pack.tearProgress + dt * 1.15 );
			this.audio.tear( d * PACK_W / dt );
			this.packSpring.ang.z -= d * 10;
			if ( pack.tearProgress >= 1 ) this.completeTear();
		}
		if ( ! this.packDrag ) {
			// spin inertia, then settle back toward the front
			this.packSpinVel *= Math.exp( - dt * 2.2 );
			this.packSpin += this.packSpinVel * dt;
			const rest = Math.round( this.packSpin / ( Math.PI * 2 ) ) * Math.PI * 2;
			if ( Math.abs( this.packSpinVel ) < 2 ) this.packSpin += ( rest - this.packSpin ) * Math.min( 1, dt * 3 );
			this.packTiltX *= Math.exp( - dt * 2 );
		}
		const tilt = this.gyro || this.hoverTilt;
		const tp = this.anchor.clone().addScaledVector( this.up, Math.sin( this.time * 1.3 ) * 0.15 + 0.6 );
		let extractLift = 0;
		if ( this.state === 'extract' ) {
			if ( this.extractAuto ) this.extractT = Math.min( 1, this.extractT + dt * 1.4 );
			extractLift = ease( this.extractT );
			tp.addScaledVector( this.up, - extractLift * 5 );
			for ( const c of this.cards ) c.mesh.position.y = -0.5 + extractLift * 8.4;
			if ( this.extractT >= 1 ) { this.finishExtract(); return; }
		}
		_q.setFromEuler( _e.set( -tilt.y * 0.22 + this.packTiltX, tilt.x * 0.3 + this.packSpin, -tilt.x * 0.05 ) );
		const tq = this.camQ.clone().multiply( _q );
		this.packSpring.step( pack.group, tp, tq, dt );
	}

	stackPose( i, out, outQ ) {
		const d = ( i - this.topIdx );
		const turn = ease( clamp( this.stackTurn, 0, 1 ) );
		const c = this.cards[ i ];
		out.copy( this.anchor ).addScaledVector( this.fwd, d * 0.04 + 0.3 ).addScaledVector( this.up, 0.3 );
		out.addScaledVector( this.right, c.jitter.x ).addScaledVector( this.up, c.jitter.y );
		outQ.copy( this.camQ ).multiply( _q.setFromEuler( _e.set( 0, Math.PI * turn, c.jitter.z ) ) );
	}

	updateCards( dt ) {
		if ( ! this.cards || this.state === 'extract' || this.state === 'pack' || this.state === 'tearing-done' ) return;
		this.stackTurn = Math.min( 1, ( this.stackTurn ?? 1 ) + dt * 1.7 );
		const tp = new V3(), tq = new Q4();
		const tilt = this.gyro || this.hoverTilt;
		for ( let i = 0; i < this.cards.length; i ++ ) {
			const c = this.cards[ i ];
			// anticipation aura
			if ( c.auraTarget !== undefined ) {
				const u = c.uniforms;
				u.aura.value += ( c.auraTarget - u.aura.value ) * Math.min( 1, dt * 3 );
			}
			if ( c.mode === 'stack' ) {
				this.stackPose( i, tp, tq );
				if ( i === this.topIdx && c.anticipating && c.info.tier >= 5 ) {
					// the card trembles with energy
					c.spring.ang.addScaledVector( new V3( Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5 ), 6 * dt * 60 * 0.05 );
				}
				c.spring.step( c.mesh, tp, tq, dt );
			} else if ( c.mode === 'flip' ) {
				const dur = c.info.tier >= 4 ? 0.85 : 0.5;
				c.flipT = Math.min( 1, c.flipT + dt / dur );
				const f = ease( c.flipT );
				const lift = Math.sin( f * Math.PI );
				tp.copy( this.anchor ).addScaledVector( this.fwd, -2.2 * f - lift * 1.5 ).addScaledVector( this.up, 0.4 + lift * 1.2 );
				tq.copy( this.camQ ).multiply( _q.setFromEuler( _e.set( -lift * 0.25, Math.PI * ( 1 - f ), lift * 0.08 ) ) );
				c.spring.step( c.mesh, tp, tq, dt );
				if ( ! c.flipped && c.flipT > 0.5 ) this.onFlipped( c );
				if ( c.flipT >= 1 ) c.mode = 'display';
			} else if ( c.mode === 'display' ) {
				tp.copy( this.anchor ).addScaledVector( this.fwd, -2.2 ).addScaledVector( this.up, 0.4 );
				tq.copy( this.camQ ).multiply( _q.setFromEuler( _e.set( -tilt.y * 0.45, tilt.x * 0.55, 0 ) ) );
				c.spring.step( c.mesh, tp, tq, dt );
			} else if ( c.mode === 'drag' ) {
				const pt = this.planePoint( this.handPlane, tp );
				if ( pt ) tp.add( this.dragCard?.offset || _v.set( 0, 0, 0 ) ).addScaledVector( this.fwd, -2.2 );
				else tp.copy( c.mesh.position );
				// the card leans into the motion like a light, stiff sheet
				const lv = c.spring.vel;
				const lx = lv.dot( this.right ), ly = lv.dot( this.up );
				tq.copy( this.camQ ).multiply( _q.setFromEuler( _e.set( clamp( ly * 0.004, -0.6, 0.6 ), clamp( -lx * 0.004, -0.6, 0.6 ), clamp( -lx * 0.0015, -0.3, 0.3 ) ) ) );
				c.spring.step( c.mesh, tp, tq, dt );
				// flex: a damped bending mode excited by sideways acceleration
				const target = clamp( -lx * 0.00012, -0.012, 0.012 );
				c.bendVel += ( ( target - c.bend ) * 300 - c.bendVel * 14 ) * dt;
				c.bend += c.bendVel * dt;
				c.uniforms.uBend.value = c.bend;
			}
		}
		// anticipation glow behind the stack
		const top = this.cards[ this.topIdx ];
		if ( top && top.anticipating && top.mode === 'stack' && this.stackTurn >= 1 ) {
			const t = top.info.tier;
			this.fx.anticipate( top.mesh.position.clone().addScaledVector( this.fwd, 0.6 ), this.camQ,
				new THREE.Color( TIER_COLORS[ t ] ), t === 3 ? 0.35 : t === 4 ? 0.6 : 1.0, t === 5 );
		}
	}

	updateInspect( dt ) {
		const c = this.inspected;
		if ( ! c ) return;
		if ( ! this.inspectDrag ) {
			const w = this.inspectAngVel;
			if ( w.lengthSq() > 1e-4 ) {
				_q.setFromAxisAngle( Y_AXIS, w.y * dt ); this.inspectRot.premultiply( _q );
				_q.setFromAxisAngle( new V3( 1, 0, 0 ), w.x * dt ); this.inspectRot.premultiply( _q );
				w.multiplyScalar( Math.exp( - dt * 2.5 ) );
			}
		}
		const tilt = this.gyro || ( this.inspectDrag ? { x: 0, y: 0 } : this.hoverTilt );
		const tp = this.inspectAnchor.clone().addScaledVector( this.fwd, this.inspectZoom || 0 );
		const tq = this.camQ.clone().multiply( this.inspectRot ).multiply( _q.setFromEuler( _e.set( -tilt.y * 0.3, tilt.x * 0.35, 0 ) ) );
		c.spring.step( c.mesh, tp, tq, dt );
	}

	updateAuto( dt ) {
		if ( ! this.auto || this.state !== 'reveal' ) return;
		this.autoTimer -= dt;
		if ( this.autoTimer > 0 ) return;
		const top = this.cards[ this.topIdx ];
		if ( ! top ) return;
		if ( top.mode === 'stack' && this.stackTurn >= 1 ) {
			this.flip( top );
			this.autoTimer = top.info.tier >= 5 ? 3.6 : top.info.tier >= 3 ? 2.6 : top.info.tier >= 1 ? 1.4 : 0.9;
		} else if ( top.mode === 'display' ) {
			this.tossCard( top );
			this.autoTimer = 0.35;
		}
	}

	// deterministic stepping for automated tests: __app.paused = true; __app.step( frames, dt )
	step( n = 1, dt = 1 / 60 ) {
		for ( let i = 0; i < n; i ++ ) this.frame( dt, i === n - 1 );
	}

	frame( fixedDt, render = true ) {
		const now = performance.now();
		if ( fixedDt === undefined && this.paused ) { this.last = now; return; }
		const dt = fixedDt ?? Math.min( DT_MAX, ( now - this.last ) / 1000 );
		this.last = now;
		this.dtLast = dt;
		this.time += dt;
		const ts = this.fx.timeScale;
		const sdt = dt * ts;

		this.physics.timeScale = ts;
		this.physics.step( dt );
		this.updatePack( sdt );
		this.updateCards( sdt );
		this.updateInspect( sdt );
		this.updateAuto( dt );
		const active = this.cards ? [ ...this.cards ] : [];
		if ( this.inspected && ! active.includes( this.inspected ) ) active.push( this.inspected );
		this.fx.update( sdt, active );
		updateCardTime( this.time );
		if ( render ) this.stage.render( this.time, dt );
	}
}

const app = new App();
window.__app = app;
app.init().catch( err => {
	console.error( err );
	const t = document.querySelector( '.loading-text' );
	if ( t ) t.textContent = '初始化失败：' + ( err?.message || err ) + '（需要支持 WebGL2 的浏览器）';
} );
