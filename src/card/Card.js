import * as THREE from 'three';
import { CARD_W, CARD_H, CARD_T, CARD_R, ART_BOX, finishFor, rarityInfo } from '../config.js';
import { cardVertexShader, cardFragmentShader } from './cardShader.js';
import { cardBackTexture } from './faceTextures.js';

// ------------------------------------------------------------------ geometry

function buildCardGeometry() {
	const pos = [], nor = [], uv = [], face = [], idx = [];
	const hw = CARD_W / 2, hh = CARD_H / 2, ht = CARD_T / 2;
	const NX = 28, NY = 38;

	const grid = ( z, nz, f ) => {
		const base = pos.length / 3;
		for ( let j = 0; j <= NY; j ++ ) for ( let i = 0; i <= NX; i ++ ) {
			const x = -hw + CARD_W * i / NX, y = -hh + CARD_H * j / NY;
			pos.push( x, y, z ); nor.push( 0, 0, nz );
			uv.push( f === 0 ? i / NX : 1 - i / NX, j / NY );
			face.push( f );
		}
		for ( let j = 0; j < NY; j ++ ) for ( let i = 0; i < NX; i ++ ) {
			const a = base + j * ( NX + 1 ) + i, b = a + 1, c = a + NX + 1, d = c + 1;
			if ( nz > 0 ) idx.push( a, b, d, a, d, c ); else idx.push( a, d, b, a, c, d );
		}
	};
	grid( ht, 1, 0 );
	grid( -ht, -1, 1 );

	// die-cut edge following the rounded outline
	const outline = [];
	const corner = ( cx, cy, a0 ) => {
		for ( let k = 0; k <= 8; k ++ ) {
			const a = a0 + ( Math.PI / 2 ) * k / 8;
			outline.push( [ cx + Math.cos( a ) * CARD_R, cy + Math.sin( a ) * CARD_R, Math.cos( a ), Math.sin( a ) ] );
		}
	};
	const line = ( x0, y0, x1, y1, nx, ny, n ) => {
		for ( let k = 1; k < n; k ++ ) outline.push( [ x0 + ( x1 - x0 ) * k / n, y0 + ( y1 - y0 ) * k / n, nx, ny ] );
	};
	const ix = hw - CARD_R, iy = hh - CARD_R;
	corner( ix, -iy, -Math.PI / 2 );
	line( hw, -iy, hw, iy, 1, 0, 24 );
	corner( ix, iy, 0 );
	line( ix, hh, -ix, hh, 0, 1, 20 );
	corner( -ix, iy, Math.PI / 2 );
	line( -hw, iy, -hw, -iy, -1, 0, 24 );
	corner( -ix, -iy, Math.PI );
	line( -ix, -hh, ix, -hh, 0, -1, 20 );
	const base = pos.length / 3;
	let perim = 0;
	outline.forEach( ( p, k ) => {
		if ( k ) perim += Math.hypot( p[ 0 ] - outline[ k - 1 ][ 0 ], p[ 1 ] - outline[ k - 1 ][ 1 ] );
		for ( const s of [ -1, 1 ] ) {
			pos.push( p[ 0 ], p[ 1 ], s * ht ); nor.push( p[ 2 ], p[ 3 ], 0 );
			uv.push( perim, s < 0 ? 0 : 1 ); face.push( 2 );
		}
	} );
	const n = outline.length;
	for ( let k = 0; k < n; k ++ ) {
		const a = base + k * 2, b = base + ( ( k + 1 ) % n ) * 2;
		idx.push( a, b, a + 1, b, b + 1, a + 1 );
	}

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'normal', new THREE.Float32BufferAttribute( nor, 3 ) );
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( uv, 2 ) );
	g.setAttribute( 'face', new THREE.Float32BufferAttribute( face, 1 ) );
	g.setIndex( idx );
	g.computeBoundingSphere();
	return g;
}

let sharedGeometry = null;
export function cardGeometry() { return sharedGeometry ||= buildCardGeometry(); }

// ------------------------------------------------------------------ material

const allMaterials = new Set();
const envState = { texture: null, intensity: 1, samples: 6, orders: 2 };

function envDefines( tex ) {
	if ( ! tex ) return {};
	const h = tex.image.height;
	const maxMip = Math.log2( h ) - 2;
	return {
		ENVMAP_TYPE_CUBE_UV: '',
		CUBEUV_TEXEL_WIDTH: 1.0 / ( 3 * Math.max( Math.pow( 2, maxMip ), 7 * 16 ) ),
		CUBEUV_TEXEL_HEIGHT: 1.0 / h,
		CUBEUV_MAX_MIP: maxMip.toFixed( 1 ),
	};
}

export function setCardEnvironment( texture, intensity = envState.intensity ) {
	const changed = texture !== envState.texture;
	envState.texture = texture;
	envState.intensity = intensity;
	for ( const m of allMaterials ) applyEnv( m, changed );
}
export function setCardQuality( samples, orders ) {
	envState.samples = samples; envState.orders = orders;
	for ( const m of allMaterials ) { m.uniforms.envSamples.value = samples; m.uniforms.envOrders.value = orders; }
}

function applyEnv( m, rebuild ) {
	m.uniforms.envMap.value = envState.texture;
	m.uniforms.envIntensity.value = envState.intensity;
	m.uniforms.hasEnv.value = envState.texture ? 1 : 0;
	if ( rebuild ) {
		for ( const k of [ 'ENVMAP_TYPE_CUBE_UV', 'CUBEUV_TEXEL_WIDTH', 'CUBEUV_TEXEL_HEIGHT', 'CUBEUV_MAX_MIP' ] ) delete m.defines[ k ];
		Object.assign( m.defines, envDefines( envState.texture ) );
		m.needsUpdate = true;
	}
}

export function createCardMaterial( { map, finish, artBox, seed } ) {
	const m = new THREE.ShaderMaterial( {
		vertexShader: cardVertexShader,
		fragmentShader: cardFragmentShader,
		lights: true,
		defines: {},
		uniforms: THREE.UniformsUtils.merge( [
			THREE.UniformsLib.lights,
			{
				map: { value: null }, backMap: { value: null }, envMap: { value: null },
				envIntensity: { value: 1 }, hasEnv: { value: 0 },
				foilMode: { value: 0 }, pattern: { value: 0 }, foilStrength: { value: 0 }, emboss: { value: 0 },
				glitter: { value: 0 }, diffractAmp: { value: 0.55 }, gratingScale: { value: 1 },
				foilTint: { value: new THREE.Color( 1, 1, 1 ) }, artBox: { value: new THREE.Vector4( 0, 0, 1, 1 ) },
				coatRough: { value: 0.2 }, seed: { value: 0 }, time: { value: 0 },
				auraColor: { value: new THREE.Color( 1, 1, 1 ) }, aura: { value: 0 }, auraRainbow: { value: 0 },
				sweep: { value: 0 }, cardSize: { value: new THREE.Vector2( CARD_W, CARD_H ) }, cornerR: { value: CARD_R },
				envSamples: { value: 6 }, envOrders: { value: 2 }, exposureBoost: { value: 1 },
				uBend: { value: 0 },
			},
		] ),
	} );
	m.alphaToCoverage = true;
	const u = m.uniforms;
	u.map.value = map;
	u.backMap.value = cardBackTexture();
	u.foilMode.value = finish.foilMode;
	u.pattern.value = finish.pattern;
	u.foilStrength.value = finish.foilStrength;
	u.emboss.value = finish.emboss;
	u.glitter.value = finish.glitter;
	u.diffractAmp.value = finish.diffractAmp;
	u.gratingScale.value = finish.gratingScale;
	u.foilTint.value.setRGB( ...finish.tint );
	u.coatRough.value = finish.coatRough;
	u.artBox.value.set( ...artBox );
	u.seed.value = seed;
	u.envSamples.value = envState.samples;
	u.envOrders.value = envState.orders;
	applyEnv( m, true );
	allMaterials.add( m );
	return m;
}

export function updateCardTime( t ) {
	for ( const m of allMaterials ) m.uniforms.time.value = t;
}

// ------------------------------------------------------------------ card entity

let seedCounter = 1;

export class Card {
	constructor( data, era, faceTexture ) {
		this.data = data;
		this.era = era;
		this.info = rarityInfo( data.rarity, era, data.reverse );
		this.finish = finishFor( data, era );
		const box = ( ART_BOX[ era ] || ART_BOX.sv )[ data.st === 'Pokémon' ? 'pokemon' : 'trainer' ];
		this.material = createCardMaterial( {
			map: faceTexture.texture, finish: this.finish, artBox: box, seed: ( seedCounter ++ * 0.6180339 ) % 1 * 50,
		} );
		this.thumb = faceTexture.thumb;
		this.canvas = faceTexture.canvas;
		this.mesh = new THREE.Mesh( cardGeometry(), this.material );
		this.mesh.castShadow = true;
		this.mesh.receiveShadow = true;
		this.mesh.userData.card = this;
		this.mesh.frustumCulled = false;

		// kinematic state (used whenever the card is not simulated by the rigid body solver)
		this.vel = new THREE.Vector3();
		this.angVel = new THREE.Vector3();
		this.mode = 'stack';
		this.body = null;
		this.flipped = false;
		this.revealed = false;
		this.bend = 0;
		this.bendVel = 0;
	}

	get uniforms() { return this.material.uniforms; }

	dispose() {
		allMaterials.delete( this.material );
		this.material.dispose();
		if ( this.uniforms.map.value && this.uniforms.map.value !== this.uniforms.backMap.value ) this.uniforms.map.value.dispose();
	}
}
