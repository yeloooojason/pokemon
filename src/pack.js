import * as THREE from 'three';
import { PACK_W, PACK_H } from './config.js';
import { loadImage } from './card/faceTextures.js';

// A sealed booster: a pillow of metallised film with crimped, serrated seals. The tear strip
// below the top seal is a separate surface that peels away following the user's finger.

const W = PACK_W, H = PACK_H;
const CRIMP = 1.1;
const BULGE = 0.42;
const NX = 96;
const NY_BODY = 84, NY_STRIP = 10;
const ARTWORK = dex => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${dex}.png`;

const smooth = ( a, b, x ) => { const t = Math.min( 1, Math.max( 0, ( x - a ) / ( b - a ) ) ); return t * t * ( 3 - 2 * t ); };
const tri = x => { const f = x - Math.floor( x ); return 1 - Math.abs( f * 2 - 1 ); };
function hash1( n ) { const s = Math.sin( n * 127.1 ) * 43758.5453; return s - Math.floor( s ); }
function noise1( x ) { const i = Math.floor( x ), f = x - i; const u = f * f * ( 3 - 2 * f ); return hash1( i ) * ( 1 - u ) + hash1( i + 1 ) * u; }

const yTop = x => H / 2 - 0.1 * tri( x / 0.26 + 0.5 );
const yBot = x => -H / 2 + 0.1 * tri( x / 0.26 + 0.5 );
const yTear = x => H / 2 - CRIMP - 0.42 + ( noise1( x * 3.1 + 4 ) - 0.5 ) * 0.12 + ( noise1( x * 17.3 ) - 0.5 ) * 0.05;

function bulge( x, y ) {
	const px = Math.pow( Math.max( 0, 1 - Math.pow( Math.abs( 2 * x / W ), 2.6 ) ), 0.6 );
	const dt = ( H / 2 - CRIMP ) - y, db = y - ( -H / 2 + CRIMP );
	const py = smooth( 0, 1.7, Math.min( dt, db ) );
	const wob = ( noise1( x * 1.3 + y * 0.7 ) - 0.5 ) * 0.05;
	return ( BULGE + wob ) * px * py;
}

function buildSurface( rowsFn, ny, withBack = true ) {
	const pos = [], uv = [], idx = [];
	for ( const side of withBack ? [ 1, -1 ] : [ 1 ] ) {
		const base = pos.length / 3;
		for ( let j = 0; j <= ny; j ++ ) for ( let i = 0; i <= NX; i ++ ) {
			const x = -W / 2 + W * i / NX;
			const [ y0, y1 ] = rowsFn( x );
			const y = y0 + ( y1 - y0 ) * j / ny;
			pos.push( x, y, side * bulge( x, y ) );
			const u = x / W + 0.5;
			uv.push( side > 0 ? u * 0.5 : 0.5 + ( 1 - u ) * 0.5, y / H + 0.5 );
		}
		for ( let j = 0; j < ny; j ++ ) for ( let i = 0; i < NX; i ++ ) {
			const a = base + j * ( NX + 1 ) + i, b = a + 1, c = a + NX + 1, d = c + 1;
			if ( side > 0 ) idx.push( a, b, d, a, d, c ); else idx.push( a, d, b, a, c, d );
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.Float32BufferAttribute( pos, 3 ) );
	g.setAttribute( 'uv', new THREE.Float32BufferAttribute( uv, 2 ) );
	g.setIndex( idx );
	g.computeVertexNormals();
	return g;
}

// ------------------------------------------------------------------ print

function strokeText( ctx, text, x, y, fill, stroke, lw ) {
	ctx.lineJoin = 'round';
	ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.strokeText( text, x, y );
	ctx.fillStyle = fill; ctx.fillText( text, x, y );
}

async function paintPack( meta, setData ) {
	const PW = 1024, PH = Math.round( 1024 * H / W );
	const c = document.createElement( 'canvas' ); c.width = PW * 2; c.height = PH;
	const ctx = c.getContext( '2d' );
	const orm = document.createElement( 'canvas' ); orm.width = PW * 2; orm.height = PH;
	const ox = orm.getContext( '2d' );
	const crimpPx = CRIMP / H * PH;

	const arts = await Promise.all( meta.mascot.map( d => loadImage( ARTWORK( d ), 8000 ).catch( () => null ) ) );
	let logo = null;
	try { logo = await loadImage( setData.logo, 5000 ); const t = document.createElement( 'canvas' ).getContext( '2d' ); t.drawImage( logo, 0, 0 ); t.getImageData( 0, 0, 1, 1 ); } catch ( e ) { logo = null; }

	// ---- front (left half)
	const bg = ctx.createLinearGradient( 0, 0, PW * 0.4, PH );
	bg.addColorStop( 0, meta.color2 ); bg.addColorStop( 0.45, meta.color ); bg.addColorStop( 1, meta.color2 );
	ctx.fillStyle = bg; ctx.fillRect( 0, 0, PW, PH );
	ctx.save();
	ctx.translate( PW / 2, PH * 0.48 );
	ctx.globalCompositeOperation = 'lighter';
	for ( let i = 0; i < 36; i ++ ) {
		ctx.rotate( Math.PI * 2 / 36 );
		ctx.fillStyle = `rgba(255,255,255,${i % 2 ? 0.05 : 0.11})`;
		ctx.beginPath(); ctx.moveTo( 0, 0 ); ctx.lineTo( PH, -60 ); ctx.lineTo( PH, 60 ); ctx.closePath(); ctx.fill();
	}
	const glow = ctx.createRadialGradient( 0, 0, 0, 0, 0, PW * 0.55 );
	glow.addColorStop( 0, 'rgba(255,255,255,0.7)' ); glow.addColorStop( 1, 'rgba(255,255,255,0)' );
	ctx.fillStyle = glow; ctx.beginPath(); ctx.arc( 0, 0, PW * 0.6, 0, 7 ); ctx.fill();
	ctx.restore();
	ctx.globalCompositeOperation = 'source-over';
	// metallic streaks
	ctx.globalAlpha = 0.12;
	ctx.strokeStyle = '#fff';
	for ( let i = -PH; i < PW; i += 46 ) { ctx.lineWidth = 6 + ( i % 3 ) * 6; ctx.beginPath(); ctx.moveTo( i, PH ); ctx.lineTo( i + PH * 0.6, 0 ); ctx.stroke(); }
	ctx.globalAlpha = 1;
	// mascots
	const draw = ( img, x, y, s, a ) => { if ( ! img ) return; ctx.globalAlpha = a; ctx.drawImage( img, x - s / 2, y - s / 2, s, s ); ctx.globalAlpha = 1; };
	ctx.shadowColor = 'rgba(0,0,0,0.45)'; ctx.shadowBlur = 40;
	draw( arts[ 1 ], PW * 0.2, PH * 0.38, PW * 0.55, 0.9 );
	draw( arts[ 2 ], PW * 0.82, PH * 0.4, PW * 0.5, 0.9 );
	draw( arts[ 0 ], PW * 0.5, PH * 0.5, PW * 0.92, 1 );
	ctx.shadowBlur = 0;
	// header
	ctx.textAlign = 'center';
	ctx.font = 'italic 900 92px "Barlow", sans-serif';
	strokeText( ctx, 'Pokémon', PW / 2, crimpPx + 160, '#ffd93b', '#1d3c8f', 16 );
	ctx.font = '700 34px "Barlow Condensed", sans-serif';
	strokeText( ctx, 'TRADING CARD GAME', PW / 2, crimpPx + 206, '#ffffff', '#0b1430', 7 );
	ctx.font = '700 30px "Barlow Condensed", sans-serif';
	strokeText( ctx, setData.series.toUpperCase(), PW / 2, crimpPx + 250, '#e8ecff', '#0b1430', 6 );
	// set logo / name
	const ly = PH * 0.74;
	if ( logo ) {
		const s = Math.min( PW * 0.8 / logo.width, 260 / logo.height );
		ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 18;
		ctx.drawImage( logo, PW / 2 - logo.width * s / 2, ly - logo.height * s / 2, logo.width * s, logo.height * s );
		ctx.shadowBlur = 0;
	} else {
		ctx.font = 'italic 900 112px "Barlow", sans-serif';
		const g = ctx.createLinearGradient( 0, ly - 90, 0, ly + 10 );
		g.addColorStop( 0, '#ffffff' ); g.addColorStop( 0.5, '#ffe7a0' ); g.addColorStop( 1, '#e0a420' );
		let size = 112;
		while ( ctx.measureText( setData.name ).width > PW * 0.86 && size > 50 ) { size -= 6; ctx.font = `italic 900 ${size}px "Barlow", sans-serif`; }
		strokeText( ctx, setData.name, PW / 2, ly, g, '#101a3a', 18 );
	}
	ctx.font = '700 54px "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
	strokeText( ctx, meta.zh, PW / 2, ly + 92, '#ffffff', '#101a3a', 10 );
	ctx.font = '700 30px "Barlow Condensed", sans-serif';
	strokeText( ctx, 'BOOSTER PACK  ·  10 ADDITIONAL GAME CARDS', PW / 2, PH - crimpPx - 70, '#ffffff', '#101a3a', 6 );

	// ---- back (right half)
	ctx.save();
	ctx.translate( PW, 0 );
	const bg2 = ctx.createLinearGradient( 0, 0, 0, PH );
	bg2.addColorStop( 0, meta.color2 ); bg2.addColorStop( 0.5, '#20263a' ); bg2.addColorStop( 1, meta.color2 );
	ctx.fillStyle = bg2; ctx.fillRect( 0, 0, PW, PH );
	ctx.globalAlpha = 0.1; ctx.strokeStyle = '#fff';
	for ( let i = 0; i < 12; i ++ ) { ctx.beginPath(); ctx.arc( PW / 2, PH * 0.42, 60 + i * 34, 0, 7 ); ctx.stroke(); }
	ctx.globalAlpha = 1;
	draw( arts[ 0 ], PW / 2, PH * 0.42, PW * 0.5, 0.25 );
	ctx.fillStyle = 'rgba(255,255,255,0.88)';
	ctx.textAlign = 'left';
	ctx.font = '600 30px "Barlow", sans-serif';
	const lines = [ `${setData.name} — ${setData.total} cards in this expansion`, 'Each booster pack contains 10 cards', 'including at least 1 rare card and', '1 reverse holofoil card.', '', 'WARNING: CHOKING HAZARD — Small parts.', 'Not for children under 3 years.' ];
	lines.forEach( ( l, i ) => ctx.fillText( l, 80, PH * 0.62 + i * 40 ) );
	// barcode
	ctx.fillStyle = '#fff'; ctx.fillRect( PW - 330, PH - crimpPx - 230, 250, 150 );
	ctx.fillStyle = '#111';
	let bx = PW - 315;
	const r = ( seed => () => ( seed = ( seed * 16807 ) % 2147483647 ) / 2147483647 )( 7 );
	while ( bx < PW - 95 ) { const w = 2 + ( r() * 5 | 0 ); ctx.fillRect( bx, PH - crimpPx - 215, w, 105 ); bx += w + 2 + ( r() * 4 | 0 ); }
	ctx.font = '600 22px monospace'; ctx.fillText( '8 20650 85' + ( setData.total % 10 ) + '12 7', PW - 312, PH - crimpPx - 88 );
	// fin seal shading down the middle
	const fin = ctx.createLinearGradient( PW / 2 - 50, 0, PW / 2 + 50, 0 );
	fin.addColorStop( 0, 'rgba(0,0,0,0)' ); fin.addColorStop( 0.5, 'rgba(255,255,255,0.12)' ); fin.addColorStop( 1, 'rgba(0,0,0,0)' );
	ctx.fillStyle = fin; ctx.fillRect( PW / 2 - 50, 0, 100, PH );
	ctx.restore();

	// ---- crimps (both halves) + ORM
	ox.fillStyle = 'rgb(0, 95, 215)'; // G roughness · B metalness
	ox.fillRect( 0, 0, PW * 2, PH );
	ox.fillStyle = 'rgb(0, 120, 110)';
	ox.fillRect( PW * 0.04, PH * 0.27, PW * 0.92, PH * 0.48 );
	ox.fillRect( PW * 1.1, PH * 0.58, PW * 0.8, PH * 0.25 );
	for ( const half of [ 0, PW ] ) {
		for ( const top of [ true, false ] ) {
			const y0 = top ? 0 : PH - crimpPx;
			const g = ctx.createLinearGradient( 0, y0, 0, y0 + crimpPx );
			g.addColorStop( 0, '#9ca3af' ); g.addColorStop( 0.5, '#f3f4f6' ); g.addColorStop( 1, '#8b93a1' );
			ctx.fillStyle = g; ctx.fillRect( half, y0, PW, crimpPx );
			ctx.fillStyle = meta.color;
			ctx.fillRect( half, top ? crimpPx - 18 : y0 + 4, PW, 14 );
			ox.fillStyle = 'rgb(0, 70, 255)';
			ox.fillRect( half, y0, PW, crimpPx );
		}
	}
	// tear notch guide
	ctx.fillStyle = 'rgba(255,255,255,0.85)';
	ctx.font = '700 22px "Barlow Condensed", sans-serif';
	ctx.textAlign = 'left';
	ctx.fillText( '◀ TEAR HERE', 18, crimpPx + 46 );

	// ---- normal map: crimp ridges + film wrinkles + fin seal
	const NW = 512, NH = Math.round( 512 * H / W );
	const hgt = new Float32Array( NW * 2 * NH );
	const crimpN = CRIMP / H * NH;
	const rnd = ( s => () => ( s = ( s * 16807 ) % 2147483647 ) / 2147483647 )( 11 );
	const creases = Array.from( { length: 46 }, () => ( { x: rnd() * NW * 2, y: rnd() * NH, a: rnd() * Math.PI, l: 20 + rnd() * 120, d: 0.4 + rnd() * 0.8 } ) );
	for ( let y = 0; y < NH; y ++ ) for ( let x = 0; x < NW * 2; x ++ ) {
		let h = 0;
		const lx = x % NW;
		if ( y < crimpN || y > NH - crimpN ) h += 0.5 + 0.5 * Math.sin( lx / NW * W / 0.16 * Math.PI * 2 );
		else {
			h += ( noise1( x * 0.05 + y * 0.013 ) + noise1( y * 0.04 - x * 0.02 + 9 ) ) * 0.25;
			if ( x >= NW ) h += Math.exp( - Math.pow( ( lx - NW / 2 ) / 22, 2 ) ) * 1.2;
		}
		hgt[ y * NW * 2 + x ] = h;
	}
	for ( const k of creases ) {
		const ca = Math.cos( k.a ), sa = Math.sin( k.a );
		for ( let t = -k.l; t < k.l; t ++ ) for ( let w = -3; w <= 3; w ++ ) {
			const px = Math.round( k.x + ca * t - sa * w ), py = Math.round( k.y + sa * t + ca * w );
			if ( px < 0 || py < 0 || px >= NW * 2 || py >= NH ) continue;
			hgt[ py * NW * 2 + px ] += k.d * Math.exp( - w * w / 3 ) * ( 1 - Math.abs( t ) / k.l ) * 0.6;
		}
	}
	const nc = document.createElement( 'canvas' ); nc.width = NW * 2; nc.height = NH;
	const nctx = nc.getContext( '2d' );
	const id = nctx.createImageData( NW * 2, NH );
	for ( let y = 0; y < NH; y ++ ) for ( let x = 0; x < NW * 2; x ++ ) {
		const i = y * NW * 2 + x;
		const dx = hgt[ i + ( x < NW * 2 - 1 ? 1 : 0 ) ] - hgt[ i - ( x > 0 ? 1 : 0 ) ];
		const dy = hgt[ i + ( y < NH - 1 ? NW * 2 : 0 ) ] - hgt[ i - ( y > 0 ? NW * 2 : 0 ) ];
		const nx = -dx * 1.6, ny = dy * 1.6, l = Math.hypot( nx, ny, 1 );
		id.data[ i * 4 ] = ( nx / l * 0.5 + 0.5 ) * 255;
		id.data[ i * 4 + 1 ] = ( ny / l * 0.5 + 0.5 ) * 255;
		id.data[ i * 4 + 2 ] = ( 1 / l * 0.5 + 0.5 ) * 255;
		id.data[ i * 4 + 3 ] = 255;
	}
	nctx.putImageData( id, 0, 0 );
	return { color: c, orm, normal: nc };
}

// ------------------------------------------------------------------ pack entity

export class BoosterPack {
	constructor( meta, setData ) {
		this.meta = meta;
		this.setData = setData;
		this.group = new THREE.Group();
		this.tearProgress = 0;
		this.detached = false;
		this.vel = new THREE.Vector3();
		this.angVel = new THREE.Vector3();
		this.body = null;
	}

	async build( renderer ) {
		const p = await paintPack( this.meta, this.setData );
		const anis = renderer.capabilities.getMaxAnisotropy();
		const tex = ( cv, srgb ) => {
			const t = new THREE.CanvasTexture( cv );
			t.anisotropy = anis;
			if ( srgb ) t.colorSpace = THREE.SRGBColorSpace;
			return t;
		};
		this.textures = [ tex( p.color, true ), tex( p.orm ), tex( p.normal ) ];
		this.outerMat = new THREE.MeshPhysicalMaterial( {
			map: this.textures[ 0 ], roughnessMap: this.textures[ 1 ], metalnessMap: this.textures[ 1 ],
			roughness: 1, metalness: 1, normalMap: this.textures[ 2 ], normalScale: new THREE.Vector2( 0.7, 0.7 ),
			clearcoat: 0.55, clearcoatRoughness: 0.12, iridescence: 0.22, iridescenceIOR: 1.45, iridescenceThicknessRange: [ 250, 520 ],
			side: THREE.FrontSide,
		} );
		this.innerMat = new THREE.MeshStandardMaterial( {
			color: 0xd9dde3, metalness: 1, roughness: 0.32, normalMap: this.textures[ 2 ], side: THREE.BackSide,
		} );

		const bodyGeo = buildSurface( x => [ yBot( x ), yTear( x ) ], NY_BODY );
		this.stripGeo = buildSurface( x => [ yTear( x ), yTop( x ) ], NY_STRIP );
		this.stripRest = this.stripGeo.attributes.position.array.slice();
		const mk = ( g, m ) => { const o = new THREE.Mesh( g, m ); o.castShadow = true; o.receiveShadow = true; return o; };
		this.body = null;
		this.bodyMesh = new THREE.Group();
		this.bodyMesh.add( mk( bodyGeo, this.outerMat ), mk( bodyGeo, this.innerMat ) );
		this.strip = new THREE.Group();
		this.strip.add( mk( this.stripGeo, this.outerMat ), mk( this.stripGeo, this.innerMat ) );
		this.group.add( this.bodyMesh, this.strip );
		this.group.traverse( o => { o.userData.pack = this; } );
		return this;
	}

	// progress 0..1 of the tear running from left to right; returns how much was newly torn
	setTear( progress ) {
		progress = Math.min( 1, Math.max( this.tearProgress, progress ) );
		const delta = progress - this.tearProgress;
		this.tearProgress = progress;
		const pos = this.stripGeo.attributes.position;
		const a = pos.array, r = this.stripRest;
		const front = -W / 2 + W * progress * 1.04;
		for ( let k = 0; k < a.length; k += 3 ) {
			const x = r[ k ], y = r[ k + 1 ], z = r[ k + 2 ];
			const yt = yTear( x );
			const lag = front - x;
			const th = lag > 0 ? 1.25 * smooth( 0, 2.6, lag ) + 0.25 * smooth( 0, 0.4, lag ) : 0;
			// lift the torn part forward around the tear line, the film also stretches a bit
			const dy = y - yt, dz = z;
			const c = Math.cos( th ), s = Math.sin( th );
			a[ k ] = x;
			a[ k + 1 ] = yt + dy * c - dz * s + ( lag > 0 ? 0.08 * smooth( 0, 1, lag ) : 0 );
			a[ k + 2 ] = dy * s + dz * c + ( lag > 0 ? 0.15 * smooth( 0, 2, lag ) : 0 );
		}
		pos.needsUpdate = true;
		this.stripGeo.computeVertexNormals();
		return delta;
	}

	// re-centre the strip geometry so it can become an independent rigid body
	detachStrip( scene ) {
		this.detached = true;
		this.stripGeo.computeBoundingBox();
		const bb = this.stripGeo.boundingBox;
		const center = bb.getCenter( new THREE.Vector3() );
		this.stripGeo.translate( -center.x, -center.y, -center.z );
		this.stripHalf = bb.getSize( new THREE.Vector3() ).multiplyScalar( 0.5 ).max( new THREE.Vector3( 0.05, 0.05, 0.05 ) );
		this.group.updateMatrixWorld( true );
		const wp = center.applyMatrix4( this.group.matrixWorld );
		const wq = this.group.getWorldQuaternion( new THREE.Quaternion() );
		this.group.remove( this.strip );
		scene.add( this.strip );
		this.strip.position.copy( wp );
		this.strip.quaternion.copy( wq );
		this.stripEntity = { kind: 'strip' };
		return this.strip;
	}

	dispose() {
		this.textures?.forEach( t => t.dispose() );
		this.outerMat?.dispose(); this.innerMat?.dispose();
		this.group.traverse( o => o.geometry?.dispose() );
		this.strip?.traverse( o => o.geometry?.dispose() );
	}
}

export const PACK_TEAR_Y = H / 2 - CRIMP - 0.42;
