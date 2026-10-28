import * as THREE from 'three';

// Reveal effects. Everything emits HDR light so the bloom pass and the real point lights
// in the scene carry the glow onto the cards and the table.

const MAX_P = 5000;

const particleVS = /* glsl */`
attribute vec3 color;
attribute float size;
attribute float alpha;
attribute float shape;
attribute float spin;
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
varying float vSpin;
uniform float pixelRatio;
void main() {
	vColor = color; vAlpha = alpha; vShape = shape; vSpin = spin;
	vec4 mv = modelViewMatrix * vec4( position, 1.0 );
	gl_Position = projectionMatrix * mv;
	gl_PointSize = size * pixelRatio * 300.0 / -mv.z;
}`;

const particleFS = /* glsl */`
varying vec3 vColor;
varying float vAlpha;
varying float vShape;
varying float vSpin;
void main() {
	vec2 p = gl_PointCoord * 2.0 - 1.0;
	float c = cos( vSpin ), s = sin( vSpin );
	p = mat2( c, -s, s, c ) * p;
	float r = length( p );
	float a;
	if ( vShape < 0.5 ) a = exp( - r * r * 4.0 );
	else if ( vShape < 1.5 ) {
		// four point sparkle
		float cross = exp( - abs( p.x ) * 22.0 ) * exp( - abs( p.y ) * 2.2 ) + exp( - abs( p.y ) * 22.0 ) * exp( - abs( p.x ) * 2.2 );
		a = cross + exp( - r * r * 30.0 ) * 1.5;
	} else {
		// tumbling flake: a thin quad whose brightness flickers as it turns
		float edge = step( abs( p.x ), 0.85 ) * step( abs( p.y ), 0.35 + 0.5 * abs( sin( vSpin * 1.7 ) ) );
		a = edge * ( 0.35 + 0.65 * pow( abs( sin( vSpin * 2.3 ) ), 6.0 ) * 3.0 );
	}
	a *= vAlpha;
	if ( a < 0.003 ) discard;
	gl_FragColor = vec4( vColor * a, 1.0 );
}`;

const raysFS = /* glsl */`
uniform float time; uniform float opacity; uniform vec3 color; uniform float rainbow; uniform float count; uniform float softness;
varying vec2 vUv;
vec3 hsv( float h ) { vec3 p = abs( fract( vec3( h ) + vec3( 0.0, 2.0 / 3.0, 1.0 / 3.0 ) ) * 6.0 - 3.0 ); return clamp( p - 1.0, 0.0, 1.0 ); }
void main() {
	vec2 p = vUv * 2.0 - 1.0;
	float r = length( p );
	float a = atan( p.y, p.x );
	float rays = pow( abs( sin( a * count + time * 0.6 ) ), 8.0 * softness ) * 0.7
	           + pow( abs( sin( a * count * 0.5 - time * 0.9 + 1.3 ) ), 14.0 * softness ) * 0.6;
	float fall = smoothstep( 1.0, 0.1, r ) * smoothstep( 0.0, 0.18, r );
	float core = exp( - r * r * 18.0 ) * 1.6;
	vec3 col = mix( color, mix( vec3( 1.0 ), hsv( a / 6.2831 + time * 0.08 ), 0.6 ) * 1.4, rainbow );
	gl_FragColor = vec4( col * ( rays * fall + core ) * opacity, 1.0 );
}`;

const ringFS = /* glsl */`
uniform float progress; uniform vec3 color; uniform float opacity;
varying vec2 vUv;
void main() {
	vec2 p = vUv * 2.0 - 1.0;
	float r = length( p );
	float w = 0.04 + progress * 0.08;
	float ring = exp( - pow( ( r - progress ) / w, 2.0 ) );
	gl_FragColor = vec4( color * ring * opacity * ( 1.0 - progress ), 1.0 );
}`;

const glowFS = /* glsl */`
uniform vec3 color; uniform float opacity; uniform float time; uniform float rainbow;
varying vec2 vUv;
vec3 hsv( float h ) { vec3 p = abs( fract( vec3( h ) + vec3( 0.0, 2.0 / 3.0, 1.0 / 3.0 ) ) * 6.0 - 3.0 ); return clamp( p - 1.0, 0.0, 1.0 ); }
void main() {
	vec2 p = vUv * 2.0 - 1.0;
	// rounded-rect glow hugging the card outline
	vec2 q = abs( p * vec2( 1.0, 1.0 ) ) - vec2( 0.42, 0.52 );
	float d = length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 );
	float g = exp( - max( d, 0.0 ) * 9.0 ) * smoothstep( 0.5, 0.0, d );
	vec3 col = mix( color, hsv( atan( p.y, p.x ) / 6.2831 + time * 0.3 ) * 1.5, rainbow );
	gl_FragColor = vec4( col * g * opacity, 1.0 );
}`;

const quadVS = /* glsl */`varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }`;

function additive( fs, uniforms ) {
	return new THREE.ShaderMaterial( {
		vertexShader: quadVS, fragmentShader: fs, uniforms, transparent: true, depthWrite: false,
		blending: THREE.AdditiveBlending, toneMapped: true,
	} );
}

export class Effects {
	constructor( stage, audio ) {
		this.stage = stage;
		this.audio = audio;
		this.scene = stage.scene;
		this.timeline = [];
		this.t = 0;

		// particles
		const g = new THREE.BufferGeometry();
		this.pPos = new Float32Array( MAX_P * 3 );
		this.pCol = new Float32Array( MAX_P * 3 );
		this.pSize = new Float32Array( MAX_P );
		this.pAlpha = new Float32Array( MAX_P );
		this.pShape = new Float32Array( MAX_P );
		this.pSpin = new Float32Array( MAX_P );
		g.setAttribute( 'position', new THREE.BufferAttribute( this.pPos, 3 ).setUsage( THREE.DynamicDrawUsage ) );
		g.setAttribute( 'color', new THREE.BufferAttribute( this.pCol, 3 ).setUsage( THREE.DynamicDrawUsage ) );
		g.setAttribute( 'size', new THREE.BufferAttribute( this.pSize, 1 ).setUsage( THREE.DynamicDrawUsage ) );
		g.setAttribute( 'alpha', new THREE.BufferAttribute( this.pAlpha, 1 ).setUsage( THREE.DynamicDrawUsage ) );
		g.setAttribute( 'shape', new THREE.BufferAttribute( this.pShape, 1 ).setUsage( THREE.DynamicDrawUsage ) );
		g.setAttribute( 'spin', new THREE.BufferAttribute( this.pSpin, 1 ).setUsage( THREE.DynamicDrawUsage ) );
		this.particles = [];
		this.points = new THREE.Points( g, new THREE.ShaderMaterial( {
			vertexShader: particleVS, fragmentShader: particleFS, transparent: true, depthWrite: false,
			blending: THREE.AdditiveBlending, uniforms: { pixelRatio: { value: stage.renderer.getPixelRatio() } },
		} ) );
		this.points.frustumCulled = false;
		this.points.renderOrder = 10;
		this.scene.add( this.points );

		// light rays behind a revealed card
		this.rays = new THREE.Mesh( new THREE.PlaneGeometry( 1, 1 ), additive( raysFS, {
			time: { value: 0 }, opacity: { value: 0 }, color: { value: new THREE.Color() }, rainbow: { value: 0 }, count: { value: 9 }, softness: { value: 1 },
		} ) );
		this.rays.scale.setScalar( 46 );
		this.rays.visible = false;
		this.rays.renderOrder = 5;
		this.scene.add( this.rays );

		this.ring = new THREE.Mesh( new THREE.PlaneGeometry( 1, 1 ), additive( ringFS, {
			progress: { value: 0 }, color: { value: new THREE.Color() }, opacity: { value: 0 },
		} ) );
		this.ring.visible = false;
		this.scene.add( this.ring );

		// glow behind the card stack (anticipation)
		this.glow = new THREE.Mesh( new THREE.PlaneGeometry( 1, 1 ), additive( glowFS, {
			color: { value: new THREE.Color() }, opacity: { value: 0 }, time: { value: 0 }, rainbow: { value: 0 },
		} ) );
		this.glow.scale.set( 14, 17, 1 );
		this.glow.visible = false;
		this.scene.add( this.glow );
		this.glowTarget = 0;

		this.flash = 0;
		this.raysLife = 0;
		this.raysDur = 0;
		this.ringLife = 0;
		this.lightPulses = [];
	}

	emit( n, o ) {
		for ( let i = 0; i < n && this.particles.length < MAX_P; i ++ ) {
			const p = {
				x: o.pos.x, y: o.pos.y, z: o.pos.z, vx: 0, vy: 0, vz: 0,
				life: 0, max: o.life * ( 0.6 + Math.random() * 0.8 ), size: o.size * ( 0.5 + Math.random() ),
				shape: typeof o.shape === 'function' ? o.shape() : o.shape, spin: Math.random() * 6.28, spinV: ( Math.random() - 0.5 ) * 14,
				g: o.gravity ?? 0, drag: o.drag ?? 1.2, bounce: o.bounce ?? false, swirl: o.swirl ?? 0,
				cx: o.pos.x, cz: o.pos.z, delay: ( o.delay ?? 0 ) * Math.random(),
			};
			const col = typeof o.color === 'function' ? o.color( i ) : o.color;
			p.r = col.r * o.intensity; p.gc = col.g * o.intensity; p.b = col.b * o.intensity;
			const dir = new THREE.Vector3( Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5 ).normalize();
			if ( o.planar ) dir.addScaledVector( o.planar, - dir.dot( o.planar ) * 0.85 ).normalize();
			const sp = o.speed * ( 0.3 + Math.random() * 0.9 );
			p.vx = dir.x * sp + ( o.up ?? 0 ) * 0; p.vy = dir.y * sp + ( o.up ?? 0 ); p.vz = dir.z * sp;
			if ( o.spread ) { p.x += ( Math.random() - 0.5 ) * o.spread.x; p.y += ( Math.random() - 0.5 ) * o.spread.y; p.z += ( Math.random() - 0.5 ) * o.spread.z; }
			this.particles.push( p );
		}
	}

	pulseLight( pos, color, intensity, dur, rise = 0.05 ) {
		const l = this.stage.fxLights.find( l => ! l.userData.busy ) || this.stage.fxLights[ 0 ];
		l.userData.busy = true;
		l.position.copy( pos );
		l.color.copy( color );
		this.lightPulses.push( { l, intensity, dur, rise, t: 0 } );
	}

	at( delay, fn ) { this.timeline.push( { t: this.t + delay, fn } ); }

	// anticipation glow before a hit is revealed
	anticipate( pos, quat, color, level, rainbow ) {
		this.glow.position.copy( pos );
		this.glow.quaternion.copy( quat );
		this.glow.material.uniforms.color.value.copy( color ).multiplyScalar( 2.2 );
		this.glow.material.uniforms.rainbow.value = rainbow ? 1 : 0;
		this.glowTarget = level;
		this.glow.visible = true;
	}
	clearAnticipation() { this.glowTarget = 0; }

	// the main event: tier-dependent reveal
	reveal( card, pos, quat, camera ) {
		const tier = card.info.tier;
		const col = new THREE.Color( card.effectColor || '#ffffff' );
		const up = new THREE.Vector3( 0, 1, 0 ).applyQuaternion( quat );
		const normal = new THREE.Vector3( 0, 0, 1 ).applyQuaternion( quat );
		const behind = pos.clone().addScaledVector( normal, -0.6 );
		const front = pos.clone().addScaledVector( normal, 1.2 );
		const lampPos = pos.clone().addScaledVector( normal, 9 ).addScaledVector( up, 3 );
		const rainbow = tier === 5 || card.data.rarity === 'Rare Rainbow';
		const gold = tier === 6;
		const soft = card.info.soft;
		const a = this.audio;
		const hue = () => new THREE.Color().setHSL( Math.random(), 0.85, 0.6 );
		const goldC = () => new THREE.Color().setHSL( 0.11 + Math.random() * 0.03, 0.9, 0.45 + Math.random() * 0.3 );

		if ( tier <= 0 ) { a?.cardFlip(); return; }
		if ( tier === 1 ) {
			a?.shimmer( 0.4 );
			this.sweep( card, 0.9 );
			this.emit( 40, { pos: front, color: new THREE.Color( 0.9, 0.95, 1 ), intensity: 3, size: 0.25, speed: 9, life: 0.9, shape: 1, spread: new THREE.Vector3( 6, 8, 0.4 ), drag: 3 } );
			return;
		}
		if ( tier === 2 ) {
			a?.chime( 0 );
			this.sweep( card, 0.8 );
			this.pulseLight( lampPos, new THREE.Color( 1, 0.97, 0.9 ), 900, 0.7 );
			this.emit( 160, { pos: front, color: () => Math.random() < 0.5 ? new THREE.Color( 1, 1, 1 ) : hue(), intensity: 4, size: 0.3, speed: 22, life: 1.2, shape: 1, planar: normal, drag: 2.2 } );
			this.flash = 0.12;
			return;
		}
		if ( tier === 3 ) {
			a?.chime( 1 );
			this.sweep( card, 0.7 );
			this.pulseLight( lampPos, col, 2600, 1.1 );
			this.shockwave( pos, quat, col, 1.0 );
			this.emit( 320, { pos: front, color: () => Math.random() < 0.4 ? new THREE.Color( 1, 1, 1 ) : col, intensity: 5, size: 0.32, speed: 34, life: 1.5, shape: () => Math.random() < 0.6 ? 1 : 0, planar: normal, drag: 2 } );
			this.flash = 0.25;
			this.stage.shake = 0.35;
			return;
		}
		// tier 4+: a staged sequence
		const rayCol = gold ? new THREE.Color( 1, 0.72, 0.25 ) : soft ? new THREE.Color( 1, 0.85, 0.95 ) : new THREE.Color( 1, 0.95, 0.85 );
		this.startRays( behind, quat, rayCol, rainbow ? 1 : 0, tier >= 5 ? 4.5 : 3.2, soft ? 0.5 : 1, tier >= 5 ? 12 : 9 );
		this.stage.push = 0;
		this.pushTo = tier >= 5 ? 5 : 3;
		this.flash = tier >= 5 ? 0.6 : 0.35;
		this.flashColor = gold ? new THREE.Color( 1, 0.8, 0.4 ) : rainbow ? new THREE.Color( 1, 0.9, 1 ) : new THREE.Color( 1, 1, 1 );
		this.sweep( card, tier >= 5 ? 1.4 : 1.0 );
		if ( tier >= 5 ) { this.stage.shake = 1.0; this.slowmo = 1.2; }
		else this.stage.shake = 0.45;
		a?.fanfare( tier, { gold, rainbow, soft } );
		this.pulseLight( lampPos, gold ? new THREE.Color( 1, 0.75, 0.35 ) : rainbow ? new THREE.Color( 1, 0.8, 1 ) : rayCol, tier >= 5 ? 6000 : 3800, 2.4, 0.08 );
		this.shockwave( pos, quat, gold ? new THREE.Color( 1, 0.8, 0.3 ) : rainbow ? hue() : col, 1.3 );

		if ( soft ) {
			// illustration rare: drifting bokeh petals
			this.emit( 260, { pos: pos.clone(), color: () => new THREE.Color().setHSL( 0.85 + Math.random() * 0.2, 0.6, 0.75 ), intensity: 2.2, size: 0.7, speed: 6, life: 3.5, shape: 0, spread: new THREE.Vector3( 16, 14, 4 ), drag: 0.6, gravity: -2 } );
			this.emit( 120, { pos: front, color: new THREE.Color( 1, 1, 1 ), intensity: 4, size: 0.3, speed: 14, life: 2, shape: 1, planar: normal, drag: 1.5 } );
		} else if ( gold ) {
			// gold rush: flakes burst out, fall and bounce on the table
			this.emit( 700, { pos: front, color: goldC, intensity: 3.2, size: 0.42, speed: 60, life: 4.5, shape: 2, drag: 0.9, gravity: -180, bounce: true } );
			this.emit( 260, { pos: front, color: new THREE.Color( 1, 0.85, 0.5 ), intensity: 6, size: 0.35, speed: 30, life: 1.6, shape: 1, planar: normal, drag: 1.6 } );
			this.at( 0.35, () => this.emit( 400, { pos: front, color: goldC, intensity: 3, size: 0.38, speed: 45, life: 4, shape: 2, drag: 0.9, gravity: -180, bounce: true } ) );
		} else if ( rainbow ) {
			this.emit( 900, { pos: front, color: hue, intensity: 4.2, size: 0.38, speed: 55, life: 3.2, shape: () => Math.random() < 0.5 ? 2 : 1, drag: 1.1, gravity: -60, bounce: true } );
			this.at( 0.5, () => this.emit( 500, { pos: pos.clone(), color: hue, intensity: 3, size: 0.3, speed: 10, life: 2.6, shape: 1, spread: new THREE.Vector3( 14, 18, 3 ), drag: 0.5, swirl: 3 } ) );
		} else {
			this.emit( 520, { pos: front, color: () => Math.random() < 0.5 ? new THREE.Color( 1, 1, 1 ) : col, intensity: 4.5, size: 0.34, speed: 40, life: 2.4, shape: () => Math.random() < 0.7 ? 1 : 0, drag: 1.4, swirl: 2.5 } );
		}
	}

	sweep( card, dur ) { card.sweepT = 0; card.sweepDur = dur; }

	startRays( pos, quat, color, rainbow, dur, softness, count ) {
		this.rays.position.copy( pos );
		this.rays.quaternion.copy( quat );
		const u = this.rays.material.uniforms;
		u.color.value.copy( color ).multiplyScalar( 1.6 );
		u.rainbow.value = rainbow;
		u.softness.value = softness;
		u.count.value = count;
		this.rays.visible = true;
		this.raysLife = 0;
		this.raysDur = dur;
	}

	shockwave( pos, quat, color, scale ) {
		this.ring.position.copy( pos );
		this.ring.quaternion.copy( quat );
		this.ring.material.uniforms.color.value.copy( color ).multiplyScalar( 3 );
		this.ring.visible = true;
		this.ringLife = 0;
		this.ringScale = 34 * scale;
	}

	update( dt, cards ) {
		this.t += dt;
		const t = this.t;
		for ( let i = this.timeline.length - 1; i >= 0; i -- ) {
			if ( this.timeline[ i ].t <= t ) { const e = this.timeline[ i ]; this.timeline.splice( i, 1 ); e.fn(); }
		}

		// particles
		const ps = this.particles;
		let n = 0;
		for ( let i = 0; i < ps.length; i ++ ) {
			const p = ps[ i ];
			if ( p.delay > 0 ) { p.delay -= dt; }
			else {
				p.life += dt;
				const dr = Math.exp( - p.drag * dt );
				p.vx *= dr; p.vy *= dr; p.vz *= dr;
				p.vy += p.g * dt;
				if ( p.swirl ) { const dx = p.x - p.cx, dz = p.z - p.cz; p.vx += -dz * p.swirl * dt; p.vz += dx * p.swirl * dt; }
				p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
				if ( p.bounce && p.y < 0.05 ) { p.y = 0.05; p.vy = Math.abs( p.vy ) * 0.35; p.vx *= 0.6; p.vz *= 0.6; p.spinV *= 0.7; }
				p.spin += p.spinV * dt;
			}
			if ( p.life >= p.max ) continue;
			ps[ n ++ ] = p;
		}
		ps.length = n;
		for ( let i = 0; i < n; i ++ ) {
			const p = ps[ i ];
			const k = i * 3;
			this.pPos[ k ] = p.x; this.pPos[ k + 1 ] = p.y; this.pPos[ k + 2 ] = p.z;
			this.pCol[ k ] = p.r; this.pCol[ k + 1 ] = p.gc; this.pCol[ k + 2 ] = p.b;
			const lf = p.life / p.max;
			this.pAlpha[ i ] = p.delay > 0 ? 0 : Math.min( 1, p.life * 12 ) * ( 1 - lf * lf );
			this.pSize[ i ] = p.size;
			this.pShape[ i ] = p.shape;
			this.pSpin[ i ] = p.spin;
		}
		const g = this.points.geometry;
		g.setDrawRange( 0, n );
		for ( const k of [ 'position', 'color', 'size', 'alpha', 'shape', 'spin' ] ) g.attributes[ k ].needsUpdate = true;
		this.points.material.uniforms.pixelRatio.value = this.stage.renderer.getPixelRatio();

		// rays
		if ( this.rays.visible ) {
			this.raysLife += dt;
			const u = this.rays.material.uniforms;
			const k = this.raysLife / this.raysDur;
			u.time.value = t;
			u.opacity.value = 0.42 * Math.min( 1, this.raysLife * 4 ) * Math.max( 0, 1 - Math.pow( k, 2 ) );
			const s = 24 + 14 * Math.min( 1, this.raysLife * 2 );
			this.rays.scale.setScalar( s );
			if ( k >= 1 ) this.rays.visible = false;
		}
		if ( this.ring.visible ) {
			this.ringLife += dt / 0.9;
			const u = this.ring.material.uniforms;
			u.progress.value = Math.min( 1, this.ringLife );
			u.opacity.value = 1;
			this.ring.scale.setScalar( this.ringScale );
			if ( this.ringLife >= 1 ) this.ring.visible = false;
		}
		// anticipation glow
		const gu = this.glow.material.uniforms;
		gu.opacity.value += ( this.glowTarget * ( 0.75 + 0.25 * Math.sin( t * 7 ) ) - gu.opacity.value ) * Math.min( 1, dt * 6 );
		gu.time.value = t;
		if ( this.glowTarget === 0 && gu.opacity.value < 0.01 ) this.glow.visible = false;

		// lights
		for ( let i = this.lightPulses.length - 1; i >= 0; i -- ) {
			const lp = this.lightPulses[ i ];
			lp.t += dt;
			const k = lp.t < lp.rise ? lp.t / lp.rise : Math.max( 0, 1 - ( lp.t - lp.rise ) / lp.dur );
			lp.l.intensity = lp.intensity * k * k;
			if ( lp.t > lp.rise + lp.dur ) { lp.l.intensity = 0; lp.l.userData.busy = false; this.lightPulses.splice( i, 1 ); }
		}

		// screen flash + camera push
		const lens = this.stage.lens.uniforms;
		this.flash = Math.max( 0, this.flash - dt * 1.6 );
		lens.flash.value = this.flash * this.flash;
		if ( this.flashColor ) lens.flashColor.value.copy( this.flashColor );
		this.pushTo = Math.max( 0, ( this.pushTo || 0 ) - dt * 1.2 );
		this.stage.push += ( this.pushTo - this.stage.push ) * Math.min( 1, dt * 3 );
		if ( this.slowmo ) this.slowmo = Math.max( 0, this.slowmo - dt );

		// card sweeps
		for ( const c of cards ) {
			if ( c.sweepDur ) {
				c.sweepT += dt;
				c.uniforms.sweep.value = c.sweepT / c.sweepDur;
				if ( c.sweepT >= c.sweepDur ) { c.sweepDur = 0; c.uniforms.sweep.value = 0; }
			}
		}
	}

	get timeScale() { return this.slowmo ? 0.35 + 0.65 * ( 1 - Math.min( 1, this.slowmo ) ) : 1; }
}
