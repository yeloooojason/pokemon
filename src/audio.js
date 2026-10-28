// All sounds are synthesised with WebAudio – no sample files.

export class Audio {
	constructor() {
		this.ctx = null;
		this.enabled = true;
		this.volume = 0.8;
	}

	unlock() {
		if ( this.ctx ) { if ( this.ctx.state === 'suspended' ) this.ctx.resume(); return; }
		const AC = window.AudioContext || window.webkitAudioContext;
		if ( ! AC ) return;
		const ctx = this.ctx = new AC();
		this.master = ctx.createGain();
		this.master.gain.value = this.enabled ? this.volume : 0;
		const comp = ctx.createDynamicsCompressor();
		comp.threshold.value = -14; comp.ratio.value = 4;
		this.master.connect( comp ).connect( ctx.destination );
		// small room reverb
		this.reverb = ctx.createConvolver();
		const len = ctx.sampleRate * 2.2;
		const ir = ctx.createBuffer( 2, len, ctx.sampleRate );
		for ( let c = 0; c < 2; c ++ ) {
			const d = ir.getChannelData( c );
			for ( let i = 0; i < len; i ++ ) d[ i ] = ( Math.random() * 2 - 1 ) * Math.pow( 1 - i / len, 3.2 );
		}
		this.reverb.buffer = ir;
		this.wet = ctx.createGain(); this.wet.gain.value = 0.28;
		this.reverb.connect( this.wet ).connect( this.master );
		this.noise = ctx.createBuffer( 1, ctx.sampleRate * 2, ctx.sampleRate );
		const nd = this.noise.getChannelData( 0 );
		for ( let i = 0; i < nd.length; i ++ ) nd[ i ] = Math.random() * 2 - 1;
	}

	setEnabled( on ) {
		this.enabled = on;
		if ( this.master ) this.master.gain.setTargetAtTime( on ? this.volume : 0, this.ctx.currentTime, 0.05 );
	}

	get ok() { return this.ctx && this.enabled; }

	out( wet = 0.3 ) {
		const g = this.ctx.createGain();
		g.connect( this.master );
		if ( wet > 0 ) { const s = this.ctx.createGain(); s.gain.value = wet; g.connect( s ).connect( this.reverb ); }
		return g;
	}

	noiseSrc( t, dur ) {
		const s = this.ctx.createBufferSource();
		s.buffer = this.noise;
		s.start( t, Math.random() * 1.5, dur + 0.05 );
		return s;
	}

	env( g, t, a, peak, d ) {
		g.gain.setValueAtTime( 0.0001, t );
		g.gain.exponentialRampToValueAtTime( peak, t + a );
		g.gain.exponentialRampToValueAtTime( 0.0001, t + a + d );
	}

	// foil film tearing: dense crackle grains, louder and brighter with speed
	tear( speed ) {
		if ( ! this.ok ) return;
		const ctx = this.ctx, t0 = ctx.currentTime;
		const grains = Math.min( 10, 1 + Math.floor( speed * 0.25 ) );
		for ( let i = 0; i < grains; i ++ ) {
			const t = t0 + Math.random() * 0.03;
			const src = this.noiseSrc( t, 0.03 );
			const bp = ctx.createBiquadFilter();
			bp.type = 'bandpass'; bp.frequency.value = 1800 + Math.random() * 4500; bp.Q.value = 1.2 + Math.random() * 3;
			const g = ctx.createGain();
			this.env( g, t, 0.001, 0.08 + Math.min( 0.35, speed * 0.012 ) * Math.random(), 0.012 + Math.random() * 0.02 );
			src.connect( bp ).connect( g ).connect( this.out( 0.15 ) );
		}
	}

	crinkle( amount = 1 ) {
		if ( ! this.ok ) return;
		const ctx = this.ctx, t0 = ctx.currentTime;
		for ( let i = 0; i < 6 * amount; i ++ ) {
			const t = t0 + Math.random() * 0.25;
			const src = this.noiseSrc( t, 0.02 );
			const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000 + Math.random() * 4000;
			const g = ctx.createGain();
			this.env( g, t, 0.001, 0.05 + Math.random() * 0.08, 0.01 + Math.random() * 0.03 );
			src.connect( hp ).connect( g ).connect( this.out( 0.1 ) );
		}
	}

	whoosh( speed = 1 ) {
		if ( ! this.ok ) return;
		const ctx = this.ctx, t = ctx.currentTime;
		const dur = 0.35;
		const src = this.noiseSrc( t, dur );
		const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
		bp.frequency.setValueAtTime( 400, t );
		bp.frequency.exponentialRampToValueAtTime( 1600 + speed * 600, t + dur * 0.4 );
		bp.frequency.exponentialRampToValueAtTime( 300, t + dur );
		const g = ctx.createGain();
		this.env( g, t, 0.06, Math.min( 0.5, 0.12 + speed * 0.08 ), dur );
		src.connect( bp ).connect( g ).connect( this.out( 0.2 ) );
	}

	cardFlip() {
		if ( ! this.ok ) return;
		const ctx = this.ctx, t = ctx.currentTime;
		const src = this.noiseSrc( t, 0.12 );
		const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.5;
		bp.frequency.setValueAtTime( 900, t ); bp.frequency.exponentialRampToValueAtTime( 3500, t + 0.09 );
		const g = ctx.createGain();
		this.env( g, t, 0.01, 0.22, 0.1 );
		src.connect( bp ).connect( g ).connect( this.out( 0.15 ) );
		this.click( t + 0.09, 0.18 );
	}

	click( t, v ) {
		const ctx = this.ctx;
		const src = this.noiseSrc( t, 0.02 );
		const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2600; bp.Q.value = 2;
		const g = ctx.createGain();
		this.env( g, t, 0.001, v, 0.018 );
		src.connect( bp ).connect( g ).connect( this.out( 0.1 ) );
	}

	// card landing on cloth / wood
	slap( force ) {
		if ( ! this.ok ) return;
		const ctx = this.ctx, t = ctx.currentTime;
		const v = Math.min( 0.6, 0.05 + Math.log10( 1 + force / 900 ) * 0.35 );
		const src = this.noiseSrc( t, 0.06 );
		const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400 + Math.random() * 1200;
		const g = ctx.createGain();
		this.env( g, t, 0.001, v, 0.045 );
		src.connect( lp ).connect( g ).connect( this.out( 0.12 ) );
		const o = ctx.createOscillator(); o.frequency.setValueAtTime( 190, t ); o.frequency.exponentialRampToValueAtTime( 70, t + 0.06 );
		const og = ctx.createGain();
		this.env( og, t, 0.001, v * 0.5, 0.06 );
		o.connect( og ).connect( this.out( 0 ) );
		o.start( t ); o.stop( t + 0.1 );
	}

	bell( t, freq, v, dur = 1.6, wet = 0.4 ) {
		const ctx = this.ctx;
		const out = this.out( wet );
		for ( const [ ratio, amp ] of [ [ 1, 1 ], [ 2.76, 0.42 ], [ 5.4, 0.2 ], [ 8.93, 0.08 ] ] ) {
			if ( freq * ratio > ctx.sampleRate * 0.45 ) continue;
			const o = ctx.createOscillator();
			o.type = 'sine';
			o.frequency.value = freq * ratio;
			const g = ctx.createGain();
			this.env( g, t, 0.004, v * amp, dur / ratio ** 0.5 );
			o.connect( g ).connect( out );
			o.start( t ); o.stop( t + dur + 0.1 );
		}
	}

	shimmer( v = 0.5 ) {
		if ( ! this.ok ) return;
		const t = this.ctx.currentTime;
		const notes = [ 2093, 2637, 3136, 3520, 4186 ];
		for ( let i = 0; i < 5; i ++ ) this.bell( t + i * 0.045, notes[ ( Math.random() * notes.length ) | 0 ], 0.05 * v, 0.6 );
	}

	chime( level ) {
		if ( ! this.ok ) return;
		const t = this.ctx.currentTime;
		const seq = level ? [ 784, 988, 1175, 1568 ] : [ 880, 1319 ];
		seq.forEach( ( f, i ) => this.bell( t + i * 0.07, f, 0.12, 1.4 ) );
		if ( level ) this.whoosh( 2 );
	}

	pad( t, freqs, dur, v, bright = 1800 ) {
		const ctx = this.ctx;
		const out = this.out( 0.6 );
		const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
		lp.frequency.setValueAtTime( 300, t ); lp.frequency.exponentialRampToValueAtTime( bright, t + dur * 0.4 );
		const g = ctx.createGain();
		g.gain.setValueAtTime( 0.0001, t );
		g.gain.exponentialRampToValueAtTime( v, t + dur * 0.3 );
		g.gain.exponentialRampToValueAtTime( 0.0001, t + dur );
		lp.connect( g ).connect( out );
		for ( const f of freqs ) for ( const det of [ -7, 0, 7 ] ) {
			const o = ctx.createOscillator();
			o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
			o.connect( lp ); o.start( t ); o.stop( t + dur + 0.1 );
		}
	}

	boom( t, v = 0.8 ) {
		const ctx = this.ctx;
		const o = ctx.createOscillator();
		o.frequency.setValueAtTime( 120, t ); o.frequency.exponentialRampToValueAtTime( 32, t + 0.9 );
		const g = ctx.createGain();
		this.env( g, t, 0.005, v, 1.2 );
		o.connect( g ).connect( this.out( 0.3 ) );
		o.start( t ); o.stop( t + 1.4 );
		const src = this.noiseSrc( t, 0.5 );
		const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
		const ng = ctx.createGain();
		this.env( ng, t, 0.003, v * 0.5, 0.45 );
		src.connect( lp ).connect( ng ).connect( this.out( 0.5 ) );
	}

	fanfare( tier, { gold, rainbow, soft } ) {
		if ( ! this.ok ) return;
		const t = this.ctx.currentTime;
		if ( soft ) {
			// harp-like arpeggio
			const notes = [ 523, 659, 784, 988, 1175, 1319, 1568, 1976 ];
			notes.forEach( ( f, i ) => this.bell( t + i * 0.09, f, 0.09, 2.2, 0.6 ) );
			this.pad( t, [ 262, 330, 392, 494 ], 3.2, 0.05, 1400 );
			return;
		}
		if ( tier >= 5 ) this.boom( t, gold ? 0.9 : 0.75 );
		const chord = gold ? [ 196, 247, 294, 370, 440 ] : rainbow ? [ 220, 277, 330, 415, 494 ] : [ 233, 294, 349, 440 ];
		this.pad( t + 0.05, chord, tier >= 5 ? 4 : 2.8, tier >= 5 ? 0.07 : 0.05, tier >= 5 ? 3200 : 2200 );
		const arp = gold ? [ 784, 988, 1175, 1480, 1760, 2349 ] : [ 880, 1109, 1319, 1661, 1760, 2217 ];
		arp.forEach( ( f, i ) => this.bell( t + 0.15 + i * 0.075, f, 0.11, 1.8, 0.5 ) );
		if ( gold ) for ( let i = 0; i < 16; i ++ ) this.bell( t + 0.3 + Math.random() * 1.6, 2500 + Math.random() * 2500, 0.03, 0.5, 0.2 );
		this.whoosh( 3 );
	}

	// rising tension while hovering over a glowing card
	charge( level ) {
		if ( ! this.ok ) return () => {};
		const ctx = this.ctx, t = ctx.currentTime;
		const o = ctx.createOscillator(); o.type = 'triangle';
		o.frequency.setValueAtTime( 110, t ); o.frequency.exponentialRampToValueAtTime( 220 + level * 80, t + 2.5 );
		const o2 = ctx.createOscillator(); o2.type = 'sine';
		o2.frequency.setValueAtTime( 165, t ); o2.frequency.exponentialRampToValueAtTime( 330 + level * 120, t + 2.5 );
		const g = ctx.createGain();
		g.gain.setValueAtTime( 0.0001, t );
		g.gain.exponentialRampToValueAtTime( 0.03 + level * 0.012, t + 1.2 );
		const out = this.out( 0.5 );
		o.connect( g ); o2.connect( g ); g.connect( out );
		o.start( t ); o2.start( t );
		return () => {
			const n = ctx.currentTime;
			g.gain.cancelScheduledValues( n );
			g.gain.setTargetAtTime( 0.0001, n, 0.05 );
			o.stop( n + 0.3 ); o2.stop( n + 0.3 );
		};
	}
}
