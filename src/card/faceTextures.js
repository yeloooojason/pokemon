import * as THREE from 'three';
import { ART_BOX, TYPE_COLORS } from '../config.js';

// Card faces: the official scan is used when the browser can load it with CORS; otherwise a
// complete card is painted procedurally from the card data + the official Pokémon artwork.

const FW = 800, FH = 1117;
const ARTWORK = ( dex, shiny ) =>
	`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${shiny ? 'shiny/' : ''}${dex}.png`;

let renderer = null;
let scanStatus = 'unknown'; // 'ok' | 'blocked' | 'unknown'
const imageCache = new Map();

export function initFaceTextures( r ) { renderer = r; }
export function scanAvailability() { return scanStatus; }

export function loadImage( url, timeout = 9000 ) {
	if ( imageCache.has( url ) ) return imageCache.get( url );
	const p = new Promise( ( resolve, reject ) => {
		const img = new Image();
		img.crossOrigin = 'anonymous';
		img.decoding = 'async';
		const t = setTimeout( () => { img.src = ''; reject( new Error( 'timeout' ) ); }, timeout );
		img.onload = () => { clearTimeout( t ); resolve( img ); };
		img.onerror = () => { clearTimeout( t ); reject( new Error( 'load failed' ) ); };
		img.src = url;
	} );
	p.catch( () => imageCache.delete( url ) );
	imageCache.set( url, p );
	return p;
}

function makeTexture( source ) {
	const tex = source.isTexture ? source : new THREE.Texture( source );
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.generateMipmaps = true;
	tex.needsUpdate = true;
	return tex;
}

// Returns { texture, source: 'scan' | 'painted', thumb }
export async function cardFaceTexture( card, era ) {
	if ( scanStatus !== 'blocked' && card.img ) {
		try {
			const img = await loadImage( card.img, scanStatus === 'ok' ? 15000 : 7000 );
			// verify that the pixels are readable (CORS) before handing them to WebGL
			const c = document.createElement( 'canvas' );
			c.width = c.height = 2;
			const cx = c.getContext( '2d' );
			cx.drawImage( img, 0, 0, 2, 2 );
			cx.getImageData( 0, 0, 1, 1 );
			scanStatus = 'ok';
			return { texture: makeTexture( img ), source: 'scan', thumb: card.img };
		} catch ( e ) {
			if ( scanStatus === 'unknown' ) scanStatus = 'blocked';
		}
	}
	const canvas = await paintCard( card, era );
	return { texture: makeTexture( canvas ), source: 'painted', thumb: null, canvas };
}

// ------------------------------------------------------------------ procedural painter

const FONT = '"Barlow", "Segoe UI", "Helvetica Neue", Arial, sans-serif';
const FONT_C = '"Barlow Condensed", "Arial Narrow", "Barlow", Arial, sans-serif';

function rr( ctx, x, y, w, h, r ) {
	ctx.beginPath();
	ctx.moveTo( x + r, y );
	ctx.arcTo( x + w, y, x + w, y + h, r );
	ctx.arcTo( x + w, y + h, x, y + h, r );
	ctx.arcTo( x, y + h, x, y, r );
	ctx.arcTo( x, y, x + w, y, r );
	ctx.closePath();
}

function mulberry( seed ) {
	let a = seed >>> 0;
	return () => {
		a |= 0; a = a + 0x6D2B79F5 | 0;
		let t = Math.imul( a ^ a >>> 15, 1 | a );
		t = t + Math.imul( t ^ t >>> 7, 61 | t ) ^ t;
		return ( ( t ^ t >>> 14 ) >>> 0 ) / 4294967296;
	};
}
function strSeed( s ) { let h = 2166136261; for ( const ch of s ) h = Math.imul( h ^ ch.charCodeAt( 0 ), 16777619 ); return h >>> 0; }

export function drawEnergy( ctx, type, x, y, r ) {
	const [ c1, c2 ] = TYPE_COLORS[ type ] || TYPE_COLORS.Colorless;
	ctx.save();
	ctx.translate( x, y );
	const g = ctx.createRadialGradient( -r * 0.3, -r * 0.3, r * 0.1, 0, 0, r );
	g.addColorStop( 0, '#ffffff' );
	g.addColorStop( 0.25, c1 );
	g.addColorStop( 1, c2 );
	ctx.fillStyle = g;
	ctx.beginPath(); ctx.arc( 0, 0, r, 0, Math.PI * 2 ); ctx.fill();
	ctx.lineWidth = r * 0.12; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke();
	ctx.fillStyle = type === 'Lightning' || type === 'Colorless' ? 'rgba(40,30,10,0.85)' : 'rgba(255,255,255,0.92)';
	ctx.strokeStyle = ctx.fillStyle;
	const s = r * 0.55;
	ctx.beginPath();
	switch ( type ) {
		case 'Grass': ctx.ellipse( 0, 0, s * 0.45, s, 0.6, 0, Math.PI * 2 ); ctx.fill(); break;
		case 'Fire':
			ctx.moveTo( 0, -s ); ctx.bezierCurveTo( s * 0.9, -s * 0.2, s * 0.8, s, 0, s ); ctx.bezierCurveTo( -s * 0.8, s, -s * 0.9, -s * 0.2, 0, -s ); ctx.fill(); break;
		case 'Water':
			ctx.moveTo( 0, -s ); ctx.quadraticCurveTo( s * 0.9, s * 0.2, 0, s ); ctx.quadraticCurveTo( -s * 0.9, s * 0.2, 0, -s ); ctx.fill(); break;
		case 'Lightning':
			ctx.moveTo( s * 0.2, -s ); ctx.lineTo( -s * 0.5, s * 0.1 ); ctx.lineTo( 0, s * 0.1 ); ctx.lineTo( -s * 0.2, s ); ctx.lineTo( s * 0.5, -s * 0.15 ); ctx.lineTo( 0, -s * 0.15 ); ctx.closePath(); ctx.fill(); break;
		case 'Psychic':
			ctx.ellipse( 0, 0, s, s * 0.55, 0, 0, Math.PI * 2 ); ctx.fill();
			ctx.fillStyle = c2; ctx.beginPath(); ctx.arc( 0, 0, s * 0.32, 0, Math.PI * 2 ); ctx.fill(); break;
		case 'Fighting': rr( ctx, -s * 0.7, -s * 0.6, s * 1.4, s * 1.2, s * 0.35 ); ctx.fill(); break;
		case 'Darkness':
			ctx.arc( 0, 0, s, 0, Math.PI * 2 ); ctx.fill();
			ctx.fillStyle = c1; ctx.beginPath(); ctx.arc( s * 0.4, -s * 0.2, s * 0.8, 0, Math.PI * 2 ); ctx.fill(); break;
		case 'Metal':
			ctx.moveTo( 0, -s ); ctx.lineTo( s * 0.95, s * 0.7 ); ctx.lineTo( -s * 0.95, s * 0.7 ); ctx.closePath(); ctx.fill(); break;
		case 'Dragon':
			ctx.lineWidth = s * 0.35; ctx.arc( 0, 0, s * 0.65, 0.3, Math.PI * 1.6 ); ctx.stroke(); break;
		case 'Fairy':
			for ( let i = 0; i < 4; i ++ ) { const a = i * Math.PI / 2; ctx.moveTo( 0, 0 ); ctx.ellipse( Math.cos( a ) * s * 0.5, Math.sin( a ) * s * 0.5, s * 0.5, s * 0.22, a, 0, Math.PI * 2 ); }
			ctx.fill(); break;
		default:
			for ( let i = 0; i < 8; i ++ ) {
				const a = i * Math.PI / 4 - Math.PI / 2, rad = i % 2 ? s * 0.35 : s;
				i ? ctx.lineTo( Math.cos( a ) * rad, Math.sin( a ) * rad ) : ctx.moveTo( Math.cos( a ) * rad, Math.sin( a ) * rad );
			}
			ctx.closePath(); ctx.fill();
	}
	ctx.restore();
}

function wrapText( ctx, text, x, y, maxW, lh, maxLines = 6 ) {
	const words = text.split( /\s+/ );
	let line = '';
	let lines = 0;
	for ( const w of words ) {
		const test = line ? line + ' ' + w : w;
		if ( ctx.measureText( test ).width > maxW && line ) {
			ctx.fillText( line, x, y );
			y += lh; line = w;
			if ( ++ lines >= maxLines ) return y;
		} else line = test;
	}
	if ( line ) { ctx.fillText( line, x, y ); y += lh; }
	return y;
}

function rarityGlyph( ctx, rarity, x, y, s ) {
	ctx.save();
	ctx.translate( x, y );
	const star = ( cx, col ) => {
		ctx.beginPath();
		for ( let i = 0; i < 10; i ++ ) {
			const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? s * 0.42 : s;
			ctx.lineTo( cx + Math.cos( a ) * r, Math.sin( a ) * r );
		}
		ctx.closePath(); ctx.fillStyle = col; ctx.fill();
	};
	const map = {
		'Common': () => { ctx.beginPath(); ctx.arc( 0, 0, s * 0.6, 0, 7 ); ctx.fillStyle = '#111'; ctx.fill(); },
		'Uncommon': () => { ctx.beginPath(); ctx.moveTo( 0, -s * 0.8 ); ctx.lineTo( s * 0.7, 0 ); ctx.lineTo( 0, s * 0.8 ); ctx.lineTo( -s * 0.7, 0 ); ctx.closePath(); ctx.fillStyle = '#111'; ctx.fill(); },
		'Rare': () => star( 0, '#111' ),
		'Rare Holo': () => star( 0, '#111' ),
		'Double Rare': () => { star( -s * 0.9, '#111' ); star( s * 0.9, '#111' ); },
		'Ultra Rare': () => { star( -s * 0.9, '#c9ced6' ); star( s * 0.9, '#c9ced6' ); },
		'Illustration Rare': () => star( 0, '#d4a017' ),
		'Special Illustration Rare': () => { star( -s * 0.9, '#d4a017' ); star( s * 0.9, '#d4a017' ); },
		'Hyper Rare': () => { star( -s * 1.8, '#d4a017' ); star( 0, '#d4a017' ); star( s * 1.8, '#d4a017' ); },
		'Mega Hyper Rare': () => { star( -s * 1.8, '#d4a017' ); star( 0, '#d4a017' ); star( s * 1.8, '#d4a017' ); },
	};
	( map[ rarity ] || map[ 'Rare' ] )();
	ctx.restore();
}

function paintBackdrop( ctx, x, y, w, h, type, rnd, full ) {
	const [ c1, c2 ] = TYPE_COLORS[ type ] || TYPE_COLORS.Colorless;
	const g = ctx.createLinearGradient( x, y, x + w * 0.3, y + h );
	g.addColorStop( 0, '#fefcf4' );
	g.addColorStop( 0.35, c1 );
	g.addColorStop( 1, c2 );
	ctx.fillStyle = g;
	ctx.fillRect( x, y, w, h );
	ctx.save();
	ctx.beginPath(); ctx.rect( x, y, w, h ); ctx.clip();
	// painterly strokes
	ctx.globalAlpha = full ? 0.22 : 0.16;
	for ( let i = 0; i < ( full ? 120 : 50 ); i ++ ) {
		ctx.strokeStyle = rnd() < 0.5 ? '#ffffff' : c2;
		ctx.lineWidth = 4 + rnd() * 26;
		ctx.lineCap = 'round';
		ctx.beginPath();
		const sx = x + rnd() * w, sy = y + rnd() * h;
		ctx.moveTo( sx, sy );
		ctx.quadraticCurveTo( sx + ( rnd() - 0.5 ) * 300, sy + ( rnd() - 0.5 ) * 120, sx + ( rnd() - 0.5 ) * 400, sy + ( rnd() - 0.5 ) * 160 );
		ctx.stroke();
	}
	// bokeh
	ctx.globalCompositeOperation = 'lighter';
	for ( let i = 0; i < ( full ? 40 : 16 ); i ++ ) {
		const r = 6 + rnd() * ( full ? 60 : 30 );
		const bx = x + rnd() * w, by = y + rnd() * h;
		const rg = ctx.createRadialGradient( bx, by, 0, bx, by, r );
		rg.addColorStop( 0, 'rgba(255,255,240,0.35)' );
		rg.addColorStop( 1, 'rgba(255,255,240,0)' );
		ctx.fillStyle = rg;
		ctx.globalAlpha = 0.8;
		ctx.beginPath(); ctx.arc( bx, by, r, 0, 7 ); ctx.fill();
	}
	ctx.globalCompositeOperation = 'source-over';
	// ground
	ctx.globalAlpha = 0.35;
	ctx.fillStyle = c2;
	ctx.beginPath();
	ctx.moveTo( x, y + h * 0.78 );
	for ( let i = 0; i <= 10; i ++ ) ctx.lineTo( x + w * i / 10, y + h * ( 0.72 + rnd() * 0.08 ) );
	ctx.lineTo( x + w, y + h ); ctx.lineTo( x, y + h ); ctx.closePath(); ctx.fill();
	ctx.restore();
}

function goldify( ctx, w, h ) {
	const id = ctx.getImageData( 0, 0, w, h );
	const d = id.data;
	for ( let i = 0; i < d.length; i += 4 ) {
		const l = ( d[ i ] * 0.3 + d[ i + 1 ] * 0.59 + d[ i + 2 ] * 0.11 ) / 255;
		const t = Math.pow( l, 0.8 );
		d[ i ] = Math.min( 255, 60 + 215 * t );
		d[ i + 1 ] = Math.min( 255, 38 + 180 * t );
		d[ i + 2 ] = Math.min( 255, 8 + 90 * t * t );
	}
	ctx.putImageData( id, 0, 0 );
}

function rainbowify( ctx, w, h ) {
	ctx.save();
	ctx.globalCompositeOperation = 'color';
	const g = ctx.createLinearGradient( 0, 0, w, h );
	[ '#ff6b9a', '#ffd36b', '#8dff8a', '#6bd8ff', '#b28dff', '#ff6bd8' ].forEach( ( c, i, a ) => g.addColorStop( i / ( a.length - 1 ), c ) );
	ctx.fillStyle = g;
	ctx.globalAlpha = 0.55;
	ctx.fillRect( 0, 0, w, h );
	ctx.restore();
}

export async function paintCard( card, era ) {
	await document.fonts?.ready;
	const canvas = document.createElement( 'canvas' );
	canvas.width = FW; canvas.height = FH;
	const ctx = canvas.getContext( '2d' );
	const rnd = mulberry( strSeed( card.id ) );
	const type = card.t?.[ 0 ] || ( card.st === 'Trainer' ? 'Colorless' : 'Colorless' );
	const [ c1, c2 ] = TYPE_COLORS[ type ] || TYPE_COLORS.Colorless;
	const r = card.rarity;
	const fullArt = [ 'Ultra Rare', 'Illustration Rare', 'Special Illustration Rare', 'Hyper Rare', 'Mega Hyper Rare',
		'Rare Ultra', 'Rare Rainbow', 'Rare Secret', 'Shiny Ultra Rare' ].includes( r );
	const gold = [ 'Hyper Rare', 'Mega Hyper Rare', 'Rare Secret' ].includes( r );
	const isPokemon = card.st === 'Pokémon';
	const isEnergy = card.st === 'Energy';
	const box = ( ART_BOX[ era ] || ART_BOX.sv )[ isPokemon ? 'pokemon' : 'trainer' ];
	const B = FW * 0.036;

	let art = null;
	if ( isPokemon && card.dex ) {
		try { art = await loadImage( ARTWORK( card.dex, r.startsWith( 'Shiny' ) ), 8000 ); } catch ( e ) { art = null; }
	}

	// border
	const borderG = ctx.createLinearGradient( 0, 0, FW, FH );
	if ( era === 'swsh' ) { borderG.addColorStop( 0, '#f7d64a' ); borderG.addColorStop( 0.5, '#fff1a0' ); borderG.addColorStop( 1, '#d9ad1c' ); }
	else { borderG.addColorStop( 0, '#b9bec6' ); borderG.addColorStop( 0.45, '#eef0f3' ); borderG.addColorStop( 1, '#9aa1ab' ); }
	ctx.fillStyle = gold ? '#c99a2e' : borderG;
	ctx.fillRect( 0, 0, FW, FH );

	const ix = B, iy = B, iw = FW - B * 2, ih = FH - B * 2;
	ctx.save();
	rr( ctx, ix, iy, iw, ih, 18 ); ctx.clip();

	if ( fullArt ) {
		paintBackdrop( ctx, ix, iy, iw, ih, type, rnd, true );
		if ( art ) {
			const s = ih * 0.78;
			ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 30;
			ctx.drawImage( art, FW / 2 - s / 2 + ( rnd() - 0.5 ) * 60, FH * 0.16, s, s );
			ctx.shadowBlur = 0;
		} else if ( ! isPokemon ) paintTrainerArt( ctx, ix, iy, iw, ih * 0.75, rnd, c1, c2 );
	} else {
		const ig = ctx.createLinearGradient( 0, iy, 0, iy + ih );
		ig.addColorStop( 0, isPokemon ? c1 : '#dfe3e8' );
		ig.addColorStop( 0.5, isPokemon ? '#f4f1e8' : '#f2f4f6' );
		ig.addColorStop( 1, isPokemon ? c1 : '#d8dde3' );
		ctx.fillStyle = ig;
		ctx.fillRect( ix, iy, iw, ih );
		// subtle print texture
		ctx.globalAlpha = 0.06;
		ctx.strokeStyle = '#000';
		for ( let i = -FH; i < FW; i += 9 ) { ctx.beginPath(); ctx.moveTo( i, 0 ); ctx.lineTo( i + FH, FH ); ctx.stroke(); }
		ctx.globalAlpha = 1;

		// art window
		const ax = box[ 0 ] * FW, ay = box[ 1 ] * FH, aw = ( box[ 2 ] - box[ 0 ] ) * FW, ah = ( box[ 3 ] - box[ 1 ] ) * FH;
		ctx.save();
		ctx.beginPath(); ctx.rect( ax, ay, aw, ah ); ctx.clip();
		if ( isPokemon ) {
			paintBackdrop( ctx, ax, ay, aw, ah, type, rnd, false );
			if ( art ) {
				const s = ah * 1.02;
				ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = 18; ctx.shadowOffsetY = 8;
				ctx.drawImage( art, ax + aw / 2 - s / 2, ay + ah * 0.02, s, s );
				ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
			}
		} else if ( isEnergy ) {
			paintBackdrop( ctx, ax, ay, aw, ah, type, rnd, false );
		} else paintTrainerArt( ctx, ax, ay, aw, ah, rnd, '#8fb3d9', '#3b5b86' );
		ctx.restore();
		ctx.lineWidth = 6;
		const fg = ctx.createLinearGradient( ax, ay, ax + aw, ay + ah );
		fg.addColorStop( 0, '#fff8d0' ); fg.addColorStop( 0.5, '#b8902c' ); fg.addColorStop( 1, '#fff2b0' );
		ctx.strokeStyle = fg;
		ctx.strokeRect( ax, ay, aw, ah );
	}

	const ink = fullArt ? '#ffffff' : '#141414';
	const inkSoft = fullArt ? 'rgba(255,255,255,0.85)' : 'rgba(20,20,20,0.85)';
	const textShadow = () => { if ( fullArt ) { ctx.shadowColor = 'rgba(0,0,0,0.65)'; ctx.shadowBlur = 6; } };

	// header
	if ( isEnergy ) {
		ctx.fillStyle = ink; textShadow();
		ctx.font = `700 44px ${FONT}`;
		ctx.fillText( card.n, ix + 26, iy + 64 );
		drawEnergy( ctx, type, FW / 2, FH * 0.62, FW * 0.2 );
	} else if ( isPokemon ) {
		const stage = ( card.sub || [] ).find( s => /Basic|Stage/.test( s ) ) || 'Basic';
		ctx.fillStyle = fullArt ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.65)';
		rr( ctx, ix + 16, iy + 18, 120, 34, 17 ); ctx.fill();
		ctx.fillStyle = ink; textShadow();
		ctx.font = `700 22px ${FONT_C}`;
		ctx.fillText( stage.toUpperCase(), ix + 32, iy + 43 );
		ctx.font = `800 52px ${FONT}`;
		let name = card.n;
		const isEx = / ex$/.test( name );
		if ( isEx ) name = name.replace( / ex$/, '' );
		ctx.fillText( name, ix + 26, iy + 105 );
		if ( isEx ) {
			const w = ctx.measureText( name + ' ' ).width;
			ctx.font = `italic 800 54px ${FONT}`;
			const eg = ctx.createLinearGradient( 0, iy + 60, 0, iy + 110 );
			eg.addColorStop( 0, '#f5f7fa' ); eg.addColorStop( 1, '#8a96a8' );
			ctx.fillStyle = eg; ctx.strokeStyle = '#1b2230'; ctx.lineWidth = 3;
			ctx.strokeText( 'ex', ix + 26 + w, iy + 105 ); ctx.fillText( 'ex', ix + 26 + w, iy + 105 );
			ctx.fillStyle = ink;
		}
		ctx.font = `700 24px ${FONT_C}`;
		ctx.textAlign = 'right';
		ctx.fillText( 'HP', FW - B - 128, iy + 102 );
		ctx.font = `800 54px ${FONT}`;
		ctx.fillText( card.hp || '', FW - B - 78, iy + 105 );
		ctx.textAlign = 'left';
		ctx.shadowBlur = 0;
		drawEnergy( ctx, type, FW - B - 44, iy + 86, 26 );
	} else {
		const sub = ( card.sub || [ 'Item' ] )[ 0 ];
		ctx.fillStyle = '#2b4c7e';
		rr( ctx, ix + 16, iy + 18, 160, 36, 8 ); ctx.fill();
		ctx.fillStyle = '#fff';
		ctx.font = `700 24px ${FONT_C}`;
		ctx.fillText( 'TRAINER', ix + 34, iy + 45 );
		ctx.fillStyle = ink; textShadow();
		ctx.font = `700 26px ${FONT_C}`;
		ctx.textAlign = 'right';
		ctx.fillText( sub.toUpperCase(), FW - B - 30, iy + 45 );
		ctx.textAlign = 'left';
		ctx.font = `800 50px ${FONT}`;
		ctx.fillText( card.n, ix + 26, iy + 108 );
		ctx.shadowBlur = 0;
	}

	// body text
	const textTop = fullArt ? FH * 0.64 : box[ 3 ] * FH + 84;
	if ( fullArt ) {
		const tg = ctx.createLinearGradient( 0, textTop - 60, 0, FH );
		tg.addColorStop( 0, 'rgba(0,0,0,0)' ); tg.addColorStop( 0.3, 'rgba(0,0,0,0.35)' ); tg.addColorStop( 1, 'rgba(0,0,0,0.55)' );
		ctx.fillStyle = tg;
		ctx.fillRect( ix, textTop - 60, iw, FH - textTop + 60 );
	}
	let y = textTop;
	if ( isPokemon ) {
		if ( ! fullArt ) {
			ctx.fillStyle = 'rgba(255,255,255,0.55)';
			rr( ctx, box[ 0 ] * FW + 40, box[ 3 ] * FH + 6, ( box[ 2 ] - box[ 0 ] ) * FW - 80, 26, 13 ); ctx.fill();
			ctx.fillStyle = '#333';
			ctx.font = `italic 600 17px ${FONT_C}`;
			ctx.textAlign = 'center';
			ctx.fillText( `NO. ${String( card.dex || 0 ).padStart( 4, '0' )}   ${( card.sub || [] ).join( ' · ' )}   Illus. ${card.art || ''}`, FW / 2, box[ 3 ] * FH + 25 );
			ctx.textAlign = 'left';
		}
		textShadow();
		for ( const ab of card.ab || [] ) {
			ctx.fillStyle = '#c0392b';
			rr( ctx, ix + 24, y - 26, 118, 34, 8 ); ctx.fill();
			ctx.fillStyle = '#fff'; ctx.font = `800 22px ${FONT_C}`;
			ctx.fillText( 'Ability', ix + 44, y - 1 );
			ctx.fillStyle = fullArt ? '#ffffff' : '#b3261e';
			ctx.font = `700 34px ${FONT}`;
			ctx.fillText( ab.n, ix + 158, y );
			ctx.fillStyle = inkSoft; ctx.font = `500 21px ${FONT}`;
			y = wrapText( ctx, ab.x, ix + 30, y + 34, iw - 60, 25, 4 ) + 12;
		}
		for ( const a of ( card.atk || [] ).slice( 0, 3 ) ) {
			( a.c || [] ).forEach( ( t, i ) => drawEnergy( ctx, t, ix + 44 + i * 40, y - 12, 17 ) );
			ctx.fillStyle = ink;
			ctx.font = `700 36px ${FONT}`;
			ctx.fillText( a.n, ix + 44 + Math.max( 1, ( a.c || [] ).length ) * 40 + 12, y );
			ctx.textAlign = 'right';
			ctx.font = `800 40px ${FONT}`;
			ctx.fillText( a.d || '', FW - B - 30, y + 2 );
			ctx.textAlign = 'left';
			if ( a.x ) {
				ctx.fillStyle = inkSoft; ctx.font = `500 21px ${FONT}`;
				y = wrapText( ctx, a.x, ix + 30, y + 32, iw - 60, 25, 3 ) + 18;
			} else y += 62;
		}
		ctx.shadowBlur = 0;
		// weakness / retreat bar
		const by = FH * 0.865;
		ctx.fillStyle = fullArt ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.08)';
		ctx.fillRect( ix + 20, by - 30, iw - 40, 44 );
		ctx.fillStyle = ink; ctx.font = `600 19px ${FONT_C}`;
		ctx.fillText( 'weakness', ix + 36, by );
		if ( card.wk ) { drawEnergy( ctx, card.wk, ix + 140, by - 7, 14 ); ctx.fillText( '×2', ix + 160, by ); }
		ctx.fillText( 'resistance', ix + 250, by );
		ctx.fillText( 'retreat', ix + 470, by );
		for ( let i = 0; i < ( card.rc || 0 ); i ++ ) drawEnergy( ctx, 'Colorless', ix + 548 + i * 32, by - 7, 13 );
		if ( card.rules?.length && fullArt === false ) {
			ctx.fillStyle = inkSoft; ctx.font = `italic 500 16px ${FONT}`;
			wrapText( ctx, card.rules[ 0 ], ix + 30, FH * 0.905, iw - 60, 19, 2 );
		}
	} else if ( ! isEnergy ) {
		ctx.fillStyle = inkSoft; ctx.font = `500 25px ${FONT}`; textShadow();
		for ( const t of card.rules || [] ) y = wrapText( ctx, t, ix + 36, y + 6, iw - 72, 30, 6 ) + 14;
		ctx.shadowBlur = 0;
	}

	// footer
	ctx.fillStyle = fullArt ? 'rgba(255,255,255,0.9)' : '#222';
	ctx.font = `600 16px ${FONT_C}`;
	ctx.fillText( `Illus. ${card.art || 'Unknown'}`, ix + 22, FH - B - 40 );
	ctx.fillStyle = '#fff';
	rr( ctx, ix + 22, FH - B - 30, 22, 22, 4 ); ctx.fill();
	ctx.fillStyle = '#111'; ctx.font = `800 16px ${FONT_C}`;
	ctx.fillText( era === 'swsh' ? 'E' : era === 'me' ? 'I' : 'G', ix + 28, FH - B - 13 );
	ctx.fillStyle = fullArt ? '#fff' : '#222';
	ctx.font = `700 18px ${FONT_C}`;
	ctx.fillText( `${card.id.split( '-' )[ 0 ].toUpperCase()}  ${String( card.no ).padStart( 3, '0' )}`, ix + 54, FH - B - 12 );
	rarityGlyph( ctx, r, ix + 240, FH - B - 18, 10 );
	ctx.font = `500 13px ${FONT_C}`;
	ctx.textAlign = 'right';
	ctx.fillText( '©Pokémon/Nintendo/Creatures/GAME FREAK · fan simulator', FW - B - 20, FH - B - 12 );
	ctx.textAlign = 'left';
	ctx.restore();

	if ( gold ) goldify( ctx, FW, FH );
	if ( r === 'Rare Rainbow' ) rainbowify( ctx, FW, FH );
	return canvas;
}

function paintTrainerArt( ctx, x, y, w, h, rnd, c1, c2 ) {
	const g = ctx.createRadialGradient( x + w / 2, y + h / 2, 10, x + w / 2, y + h / 2, w * 0.7 );
	g.addColorStop( 0, '#ffffff' ); g.addColorStop( 0.4, c1 ); g.addColorStop( 1, c2 );
	ctx.fillStyle = g;
	ctx.fillRect( x, y, w, h );
	ctx.save();
	ctx.translate( x + w / 2, y + h / 2 );
	ctx.globalAlpha = 0.25;
	for ( let i = 0; i < 24; i ++ ) {
		ctx.rotate( Math.PI / 12 );
		ctx.fillStyle = i % 2 ? '#ffffff' : c2;
		ctx.beginPath(); ctx.moveTo( 0, 0 ); ctx.lineTo( w, -20 ); ctx.lineTo( w, 20 ); ctx.closePath(); ctx.fill();
	}
	ctx.globalAlpha = 1;
	// Poké Ball emblem
	const r = Math.min( w, h ) * 0.28;
	ctx.rotate( rnd() * 0.6 - 0.3 );
	ctx.fillStyle = '#e53935'; ctx.beginPath(); ctx.arc( 0, 0, r, Math.PI, 0 ); ctx.fill();
	ctx.fillStyle = '#fafafa'; ctx.beginPath(); ctx.arc( 0, 0, r, 0, Math.PI ); ctx.fill();
	ctx.fillStyle = '#222'; ctx.fillRect( -r, -r * 0.08, r * 2, r * 0.16 );
	ctx.beginPath(); ctx.arc( 0, 0, r * 0.3, 0, 7 ); ctx.fill();
	ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc( 0, 0, r * 0.18, 0, 7 ); ctx.fill();
	ctx.lineWidth = r * 0.06; ctx.strokeStyle = '#222'; ctx.beginPath(); ctx.arc( 0, 0, r, 0, 7 ); ctx.stroke();
	ctx.restore();
}

// ------------------------------------------------------------------ card back

let backTex = null;
export function cardBackTexture() {
	if ( backTex ) return backTex;
	const c = document.createElement( 'canvas' );
	c.width = FW; c.height = FH;
	const ctx = c.getContext( '2d' );
	const rnd = mulberry( 42 );
	ctx.fillStyle = '#163f8f';
	ctx.fillRect( 0, 0, FW, FH );
	const B = FW * 0.05;
	ctx.save();
	rr( ctx, B, B, FW - 2 * B, FH - 2 * B, 26 ); ctx.clip();
	const g = ctx.createRadialGradient( FW * 0.45, FH * 0.5, 40, FW * 0.5, FH * 0.5, FH * 0.7 );
	g.addColorStop( 0, '#5aa2ff' ); g.addColorStop( 0.35, '#2563d6' ); g.addColorStop( 1, '#0a245e' );
	ctx.fillStyle = g;
	ctx.fillRect( 0, 0, FW, FH );
	// energy swirl
	ctx.translate( FW * 0.47, FH * 0.52 );
	ctx.globalCompositeOperation = 'lighter';
	for ( let i = 0; i < 160; i ++ ) {
		const a0 = rnd() * Math.PI * 2;
		const r0 = 40 + rnd() * 520;
		ctx.strokeStyle = `rgba(${120 + rnd() * 80 | 0},${170 + rnd() * 60 | 0},255,${0.03 + rnd() * 0.07})`;
		ctx.lineWidth = 2 + rnd() * 18;
		ctx.beginPath();
		ctx.arc( 0, 0, r0, a0, a0 + 0.6 + rnd() * 1.6 );
		ctx.stroke();
	}
	ctx.globalCompositeOperation = 'source-over';
	// ball
	ctx.rotate( -0.32 );
	const r = FW * 0.3;
	ctx.shadowColor = 'rgba(0,0,40,0.6)'; ctx.shadowBlur = 40;
	const red = ctx.createLinearGradient( 0, -r, 0, 0 );
	red.addColorStop( 0, '#ff5b4d' ); red.addColorStop( 1, '#c0161b' );
	ctx.fillStyle = red; ctx.beginPath(); ctx.arc( 0, 0, r, Math.PI, 0 ); ctx.fill();
	const wh = ctx.createLinearGradient( 0, 0, 0, r );
	wh.addColorStop( 0, '#ffffff' ); wh.addColorStop( 1, '#b9c2cf' );
	ctx.fillStyle = wh; ctx.beginPath(); ctx.arc( 0, 0, r, 0, Math.PI ); ctx.fill();
	ctx.shadowBlur = 0;
	ctx.fillStyle = '#141414';
	ctx.fillRect( -r, -r * 0.07, r * 2, r * 0.14 );
	ctx.beginPath(); ctx.arc( 0, 0, r * 0.3, 0, 7 ); ctx.fill();
	ctx.fillStyle = '#f4f4f4'; ctx.beginPath(); ctx.arc( 0, 0, r * 0.19, 0, 7 ); ctx.fill();
	ctx.lineWidth = r * 0.05; ctx.strokeStyle = '#141414'; ctx.beginPath(); ctx.arc( 0, 0, r, 0, 7 ); ctx.stroke();
	ctx.rotate( 0.32 );
	// wordmark
	ctx.font = `italic 900 118px ${FONT}`;
	ctx.textAlign = 'center';
	ctx.lineJoin = 'round';
	ctx.lineWidth = 18; ctx.strokeStyle = '#1c3d8f';
	ctx.strokeText( 'Pokémon', 0, -r - 36 );
	const yg = ctx.createLinearGradient( 0, -r - 130, 0, -r - 30 );
	yg.addColorStop( 0, '#fff27a' ); yg.addColorStop( 1, '#f6b800' );
	ctx.fillStyle = yg;
	ctx.fillText( 'Pokémon', 0, -r - 36 );
	ctx.font = `700 30px ${FONT_C}`;
	ctx.fillStyle = '#dbe8ff';
	ctx.fillText( 'TRADING  CARD  GAME', 0, r + 80 );
	ctx.restore();
	backTex = makeTexture( c );
	return backTex;
}
