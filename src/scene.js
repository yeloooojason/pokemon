import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { setCardEnvironment } from './card/Card.js';

const BASE = './';

export const ENVIRONMENTS = [
	{ id: 'studio', zh: '摄影棚', file: null, intensity: 0.4, bg: 0.0, exposure: 1.0 },
	{ id: 'sunset', zh: '威尼斯日落', file: 'hdr/venice_sunset_1k.hdr', intensity: 0.5, bg: 0.32, exposure: 1.0 },
	{ id: 'quarry', zh: '采石场正午', file: 'hdr/quarry_01_1k.hdr', intensity: 0.42, bg: 0.28, exposure: 0.95 },
	{ id: 'night', zh: '月夜球场', file: 'hdr/moonless_golf_1k.hdr', intensity: 1.3, bg: 0.6, exposure: 1.1 },
];

// colour temperature (Kelvin) → linear RGB (Tanner Helland approximation)
export function kelvinToRGB( k, target = new THREE.Color() ) {
	const t = k / 100;
	let r, g, b;
	if ( t <= 66 ) { r = 255; g = 99.4708025861 * Math.log( t ) - 161.1195681661; }
	else { r = 329.698727446 * Math.pow( t - 60, -0.1332047592 ); g = 288.1221695283 * Math.pow( t - 60, -0.0755148492 ); }
	if ( t >= 66 ) b = 255; else if ( t <= 19 ) b = 0; else b = 138.5177312231 * Math.log( t - 10 ) - 305.0447927307;
	const c = ( v ) => Math.min( 255, Math.max( 0, v ) ) / 255;
	return target.setRGB( c( r ), c( g ), c( b ), THREE.SRGBColorSpace );
}

const LensShader = {
	uniforms: {
		tDiffuse: { value: null }, vignette: { value: 0.32 }, aberration: { value: 0.0015 },
		flash: { value: 0 }, flashColor: { value: new THREE.Color( 1, 1, 1 ) },
	},
	vertexShader: /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`,
	fragmentShader: /* glsl */`
		uniform sampler2D tDiffuse; uniform float vignette; uniform float aberration; uniform float flash; uniform vec3 flashColor;
		varying vec2 vUv;
		void main(){
			vec2 d = vUv - 0.5;
			float r2 = dot( d, d );
			vec2 off = d * aberration * ( 1.0 + r2 * 4.0 );
			vec3 c;
			c.r = texture2D( tDiffuse, vUv + off ).r;
			c.g = texture2D( tDiffuse, vUv ).g;
			c.b = texture2D( tDiffuse, vUv - off ).b;
			c *= mix( 1.0, smoothstep( 0.85, 0.15, r2 * 2.2 ), vignette );
			c += flashColor * flash;
			gl_FragColor = vec4( c, 1.0 );
		}`,
};

const GrainShader = {
	uniforms: { tDiffuse: { value: null }, time: { value: 0 }, amount: { value: 0.035 } },
	vertexShader: LensShader.vertexShader,
	fragmentShader: /* glsl */`
		uniform sampler2D tDiffuse; uniform float time; uniform float amount; varying vec2 vUv;
		float h( vec2 p ){ return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }
		void main(){
			vec4 c = texture2D( tDiffuse, vUv );
			float n = h( vUv * vec2( 1920.0, 1080.0 ) + fract( time ) * 100.0 ) - 0.5;
			float l = dot( c.rgb, vec3( 0.299, 0.587, 0.114 ) );
			c.rgb += n * amount * ( 1.0 - l * 0.7 );
			gl_FragColor = c;
		}`,
};

export class Stage {
	constructor( canvas ) {
		const renderer = this.renderer = new THREE.WebGLRenderer( { canvas, antialias: false, powerPreference: 'high-performance', stencil: false } );
		renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) );
		renderer.setSize( window.innerWidth, window.innerHeight );
		renderer.toneMapping = THREE.NeutralToneMapping;
		renderer.toneMappingExposure = 1.0;
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.type = THREE.PCFShadowMap;

		const scene = this.scene = new THREE.Scene();
		scene.background = new THREE.Color( 0x07080c );

		const camera = this.camera = new THREE.PerspectiveCamera( 38, window.innerWidth / window.innerHeight, 4, 1500 );
		this.cameraBase = new THREE.Vector3( 0, 44, 42 );
		this.cameraTarget = new THREE.Vector3( 0, 3, -3 );
		camera.position.copy( this.cameraBase );
		camera.lookAt( this.cameraTarget );
		this.shake = 0;
		this.push = 0;

		this.pmrem = new THREE.PMREMGenerator( renderer );
		this.envCache = new Map();

		this.buildLights();
		this.buildTable();
		this.buildPost();

		window.addEventListener( 'resize', () => this.resize() );
	}

	buildLights() {
		const s = this.scene;
		// key light: a soft desk lamp, the only shadow caster
		const key = this.key = new THREE.SpotLight( 0xffffff, 9000, 0, 0.62, 0.85, 2 );
		key.position.set( -24, 58, 20 );
		key.target.position.set( 0, 0, -2 );
		key.castShadow = true;
		key.shadow.mapSize.set( 2048, 2048 );
		key.shadow.camera.near = 20;
		key.shadow.camera.far = 160;
		key.shadow.bias = -0.00025;
		key.shadow.normalBias = 0.02;
		key.shadow.radius = 5;
		s.add( key, key.target );
		this.keyTemp = 4300;
		kelvinToRGB( this.keyTemp, key.color );

		// visible bulb so the light source has a physical presence (and blooms)
		const bulb = this.bulb = new THREE.Mesh(
			new THREE.SphereGeometry( 0.9, 24, 16 ),
			new THREE.MeshBasicMaterial( { color: new THREE.Color( 1, 1, 1 ).multiplyScalar( 30 ), toneMapped: true } ),
		);
		bulb.material.color.copy( key.color ).multiplyScalar( 30 );
		bulb.position.copy( key.position );
		s.add( bulb );

		const rim = this.rim = new THREE.PointLight( 0x9fc4ff, 2600, 0, 2 );
		rim.position.set( 30, 34, -46 );
		s.add( rim );

		// pooled lights for reveal effects (kept in the scene so shaders never recompile)
		this.fxLights = [ 0, 1 ].map( () => {
			const l = new THREE.PointLight( 0xffffff, 0, 0, 2 );
			s.add( l );
			return l;
		} );
	}

	buildTable() {
		const loader = new THREE.TextureLoader();
		const anis = this.renderer.capabilities.getMaxAnisotropy();
		const wrap = ( t, srgb ) => {
			t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set( 5, 5 ); t.anisotropy = anis;
			if ( srgb ) t.colorSpace = THREE.SRGBColorSpace;
			return t;
		};
		const diff = wrap( loader.load( BASE + 'tex/hardwood2_diffuse.jpg' ), true );
		const bump = wrap( loader.load( BASE + 'tex/hardwood2_bump.jpg' ) );
		const rough = wrap( loader.load( BASE + 'tex/hardwood2_roughness.jpg' ) );
		const wood = new THREE.MeshPhysicalMaterial( {
			map: diff, bumpMap: bump, bumpScale: 0.6, roughnessMap: rough, roughness: 0.9,
			clearcoat: 0.35, clearcoatRoughness: 0.35, color: 0x8a7a6a,
		} );
		const table = new THREE.Mesh( new THREE.PlaneGeometry( 360, 360 ), wood );
		table.rotation.x = -Math.PI / 2;
		table.position.y = -0.25;
		table.receiveShadow = true;
		this.scene.add( table );

		// cloth playmat
		const matTex = this.playmatTexture();
		const mat = new THREE.Mesh(
			new THREE.BoxGeometry( 61, 0.25, 35.5 ),
			new THREE.MeshPhysicalMaterial( { map: matTex.map, normalMap: matTex.normal, normalScale: new THREE.Vector2( 0.6, 0.6 ),
				roughness: 0.95, sheen: 1, sheenRoughness: 0.6, sheenColor: new THREE.Color( 0x6b7fd6 ) } ),
		);
		mat.position.set( 0, -0.125, -4 );
		mat.receiveShadow = true;
		this.scene.add( mat );
		this.playmat = mat;
	}

	playmatTexture() {
		const w = 2048, h = 1192;
		const c = document.createElement( 'canvas' ); c.width = w; c.height = h;
		const x = c.getContext( '2d' );
		const g = x.createRadialGradient( w / 2, h / 2, 50, w / 2, h / 2, w * 0.65 );
		g.addColorStop( 0, '#1b2350' ); g.addColorStop( 1, '#080b1d' );
		x.fillStyle = g; x.fillRect( 0, 0, w, h );
		x.strokeStyle = 'rgba(140,160,255,0.16)';
		x.lineWidth = 3;
		for ( let i = 0; i < 9; i ++ ) { x.beginPath(); x.arc( w / 2, h / 2, 120 + i * 70, 0, Math.PI * 2 ); x.stroke(); }
		x.strokeStyle = 'rgba(200,210,255,0.22)';
		x.lineWidth = 6;
		x.setLineDash( [ 14, 10 ] );
		x.strokeRect( 26, 26, w - 52, h - 52 );
		x.setLineDash( [] );
		x.font = '700 64px "Barlow Condensed", sans-serif';
		x.fillStyle = 'rgba(200,210,255,0.18)';
		x.textAlign = 'center';
		x.fillText( 'BOOSTER  BREAK', w / 2, h - 90 );
		const map = new THREE.CanvasTexture( c );
		map.colorSpace = THREE.SRGBColorSpace;
		map.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
		// woven fabric normal map
		const n = document.createElement( 'canvas' ); n.width = n.height = 256;
		const nx = n.getContext( '2d' );
		const id = nx.createImageData( 256, 256 );
		for ( let j = 0; j < 256; j ++ ) for ( let i = 0; i < 256; i ++ ) {
			const a = Math.sin( i * Math.PI / 4 ), b = Math.sin( j * Math.PI / 4 );
			const over = ( ( i >> 3 ) + ( j >> 3 ) ) & 1;
			const dx = over ? Math.cos( i * Math.PI / 4 ) : 0, dy = over ? 0 : Math.cos( j * Math.PI / 4 );
			const k = ( j * 256 + i ) * 4;
			id.data[ k ] = 128 + dx * 70 + ( Math.random() - 0.5 ) * 30;
			id.data[ k + 1 ] = 128 + dy * 70 + ( Math.random() - 0.5 ) * 30;
			id.data[ k + 2 ] = 255; id.data[ k + 3 ] = 255;
			void a; void b;
		}
		nx.putImageData( id, 0, 0 );
		const normal = new THREE.CanvasTexture( n );
		normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
		normal.repeat.set( 60, 35 );
		return { map, normal };
	}

	buildPost() {
		const r = this.renderer;
		const size = r.getDrawingBufferSize( new THREE.Vector2() );
		const rt = new THREE.WebGLRenderTarget( size.x, size.y, { type: THREE.HalfFloatType, samples: 4 } );
		const composer = this.composer = new EffectComposer( r, rt );
		composer.setPixelRatio( r.getPixelRatio() );
		composer.addPass( new RenderPass( this.scene, this.camera ) );
		this.bloom = new UnrealBloomPass( new THREE.Vector2( window.innerWidth, window.innerHeight ), 0.26, 0.42, 3.0 );
		composer.addPass( this.bloom );
		this.lens = new ShaderPass( LensShader );
		composer.addPass( this.lens );
		composer.addPass( new OutputPass() );
		this.grain = new ShaderPass( GrainShader );
		composer.addPass( this.grain );
	}

	async setEnvironment( id ) {
		const def = ENVIRONMENTS.find( e => e.id === id ) || ENVIRONMENTS[ 0 ];
		let entry = this.envCache.get( def.id );
		if ( ! entry ) {
			if ( ! def.file ) {
				const rt = this.pmrem.fromScene( new RoomEnvironment(), 0.03 );
				entry = { env: rt.texture, bg: null };
			} else {
				const hdr = await new RGBELoader().loadAsync( BASE + def.file );
				hdr.mapping = THREE.EquirectangularReflectionMapping;
				const rt = this.pmrem.fromEquirectangular( hdr );
				entry = { env: rt.texture, bg: hdr };
			}
			this.envCache.set( def.id, entry );
		}
		this.scene.environment = entry.env;
		this.scene.environmentIntensity = def.intensity;
		if ( entry.bg ) {
			this.scene.background = entry.bg;
			this.scene.backgroundBlurriness = 0.42;
			this.scene.backgroundIntensity = def.bg;
		} else {
			this.scene.background = new THREE.Color( 0x07080c );
		}
		this.renderer.toneMappingExposure = def.exposure;
		setCardEnvironment( entry.env, def.intensity );
		this.envDef = def;
	}

	setKeyTemperature( k ) {
		this.keyTemp = k;
		kelvinToRGB( k, this.key.color );
		this.bulb.material.color.copy( this.key.color ).multiplyScalar( 30 * this.key.intensity / 9000 );
	}
	setKeyIntensity( v ) {
		this.key.intensity = v;
		this.bulb.visible = v > 0;
		this.bulb.material.color.copy( this.key.color ).multiplyScalar( 30 * v / 9000 );
	}
	setKeyPosition( p ) {
		this.key.position.copy( p );
		this.bulb.position.copy( p );
	}

	resize() {
		const w = window.innerWidth, h = window.innerHeight;
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize( w, h );
		this.composer.setPixelRatio( this.renderer.getPixelRatio() );
		this.composer.setSize( w, h );
		this.onResize?.();
	}

	setPixelRatio( pr ) {
		this.renderer.setPixelRatio( pr );
		this.resize();
	}

	render( t, dt ) {
		const cam = this.camera;
		// camera: subtle breathing + effect push + shake
		const shake = this.shake;
		this.shake = Math.max( 0, this.shake - dt * 1.8 );
		const push = this.push;
		const dir = this.cameraTarget.clone().sub( this.cameraBase ).normalize();
		cam.position.copy( this.cameraBase ).addScaledVector( dir, push );
		cam.position.x += Math.sin( t * 0.31 ) * 0.25 + ( Math.random() - 0.5 ) * shake * 0.9;
		cam.position.y += Math.sin( t * 0.23 ) * 0.18 + ( Math.random() - 0.5 ) * shake * 0.9;
		cam.lookAt( this.cameraTarget );
		this.grain.uniforms.time.value = t;
		this.composer.render( dt );
	}
}
