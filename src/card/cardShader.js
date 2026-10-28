// Physically based trading-card shader.
//
// Layer stack of the card front (top → bottom):
//   1. clear varnish / laminate  – dielectric, n = 1.5, GGX microfacet, optional embossed texture
//   2. printed ink               – acts as a colour filter (transmittance ≈ albedo of the print)
//   3. substrate                 – either white paper (rough, multi-scattering Oren–Nayar)
//                                  or a holographic metal foil (GGX zero order + diffraction grating
//                                  orders + metallic micro-flakes)
// Light travelling to the substrate is refracted by the varnish (Snell) and attenuated by the
// Fresnel transmission on the way in and out. The holographic foil is modelled as a reflection
// grating:  d · (sinθi + sinθo) = mλ, evaluated with the half-vector projection onto the grating
// vector. Analytic lights give a single wavelength per order; image based lighting integrates the
// spectrum by tracing the incoming direction that diffracts each wavelength into the eye.

export const cardVertexShader = /* glsl */`
#include <common>
#include <shadowmap_pars_vertex>

attribute float face;

uniform float uBend;

varying vec2 vUv;
varying vec2 vLocal;
varying float vFace;
varying vec3 vViewPosition;
varying vec3 vNormalV;
varying vec3 vTangentV;
varying vec3 vWorldPos;

void main() {
	vUv = uv;
	vFace = face;
	vLocal = position.xy;

	vec3 objectNormal = normal;
	vec3 objectTangent = vec3( 1.0, 0.0, 0.0 );
	vec3 transformed = position;

	// cylindrical bend around the card's vertical axis (flex while held / thrown)
	if ( abs( uBend ) > 1e-4 ) {
		float R = 1.0 / uBend;
		float th = position.x * uBend;
		float s = sin( th ), c = cos( th );
		transformed.x = ( R - position.z ) * s;
		transformed.z = R - ( R - position.z ) * c;
		objectNormal = vec3( normal.x * c - normal.z * s, normal.y, normal.x * s + normal.z * c );
		objectTangent = vec3( c, 0.0, s );
	}

	#include <defaultnormal_vertex>
	#include <project_vertex>

	vec4 worldPosition = modelMatrix * vec4( transformed, 1.0 );
	#include <shadowmap_vertex>

	vViewPosition = - mvPosition.xyz;
	vNormalV = normalize( transformedNormal );
	vTangentV = normalize( normalMatrix * objectTangent );
	vWorldPos = worldPosition.xyz;
}
`;

export const cardFragmentShader = /* glsl */`
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <cube_uv_reflection_fragment>

uniform sampler2D map;
uniform sampler2D backMap;
uniform sampler2D envMap;
uniform float envIntensity;
uniform float hasEnv;

uniform int foilMode;        // 0 none · 1 art-box holo · 2 reverse holo · 3 full card foil
uniform int pattern;         // see foilPattern()
uniform float foilStrength;
uniform float emboss;
uniform float glitter;
uniform float diffractAmp;
uniform float gratingScale;
uniform vec3 foilTint;
uniform vec4 artBox;         // x0, y0, x1, y1 in image space (top-left origin)
uniform float coatRough;
uniform float seed;
uniform float time;
uniform vec3 auraColor;
uniform float aura;
uniform float auraRainbow;
uniform float sweep;
uniform vec2 cardSize;
uniform float cornerR;
uniform int envSamples;
uniform int envOrders;
uniform float exposureBoost;

varying vec2 vUv;
varying vec2 vLocal;
varying float vFace;
varying vec3 vViewPosition;
varying vec3 vNormalV;
varying vec3 vTangentV;
varying vec3 vWorldPos;

// ------------------------------------------------------------------ helpers

float hash12( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.x + p3.y ) * p3.z );
}
vec2 hash22( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
	p3 += dot( p3, p3.yzx + 33.33 );
	return fract( ( p3.xx + p3.yz ) * p3.zy );
}
vec3 hash32( vec2 p ) {
	vec3 p3 = fract( vec3( p.xyx ) * vec3( 0.1031, 0.1030, 0.0973 ) );
	p3 += dot( p3, p3.yxz + 33.33 );
	return fract( ( p3.xxy + p3.yzz ) * p3.zyx );
}
float vnoise( vec2 p ) {
	vec2 i = floor( p ), f = fract( p );
	vec2 u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( hash12( i ), hash12( i + vec2( 1, 0 ) ), u.x ),
	            mix( hash12( i + vec2( 0, 1 ) ), hash12( i + vec2( 1, 1 ) ), u.x ), u.y );
}
float fbm( vec2 p ) {
	float a = 0.5, s = 0.0;
	for ( int i = 0; i < 4; i ++ ) { s += a * vnoise( p ); p = p * 2.03 + 17.1; a *= 0.5; }
	return s;
}
float luma( vec3 c ) { return dot( c, vec3( 0.2126, 0.7152, 0.0722 ) ); }

vec3 hsv2rgb( vec3 c ) {
	vec3 p = abs( fract( c.xxx + vec3( 0.0, 2.0 / 3.0, 1.0 / 3.0 ) ) * 6.0 - 3.0 );
	return c.z * mix( vec3( 1.0 ), clamp( p - 1.0, 0.0, 1.0 ), c.y );
}

// CIE 1931 colour matching functions (Wyman, Sloan & Shirley 2013 multi-lobe fit) → linear sRGB
float cieG( float x, float mu, float s1, float s2 ) { float t = ( x - mu ) / ( x < mu ? s1 : s2 ); return exp( -0.5 * t * t ); }
vec3 spectrumRGB( float l ) {
	float X = 1.056 * cieG( l, 599.8, 37.9, 31.0 ) + 0.362 * cieG( l, 442.0, 16.0, 26.7 ) - 0.065 * cieG( l, 501.1, 20.4, 26.2 );
	float Y = 0.821 * cieG( l, 568.8, 46.9, 40.5 ) + 0.286 * cieG( l, 530.9, 16.3, 31.1 );
	float Z = 1.217 * cieG( l, 437.0, 11.8, 36.0 ) + 0.681 * cieG( l, 459.0, 26.0, 13.8 );
	vec3 rgb = mat3( 3.2406, -0.9689, 0.0557, -1.5372, 1.8758, -0.2040, -0.4986, 0.0415, 1.0570 ) * vec3( X, Y, Z );
	return max( rgb, 0.0 );
}
// normalisation so that the average over the visible spectrum is white
const vec3 SPEC_NORM = vec3( 1.935, 2.956, 3.120 );

// ------------------------------------------------------------------ microfacet BRDF

float D_GGXc( float a, float NoH ) {
	float a2 = a * a;
	float d = NoH * NoH * ( a2 - 1.0 ) + 1.0;
	return a2 / ( PI * d * d );
}
float V_SmithGGXc( float a, float NoL, float NoV ) {
	float a2 = a * a;
	float gv = NoL * sqrt( NoV * NoV * ( 1.0 - a2 ) + a2 );
	float gl = NoV * sqrt( NoL * NoL * ( 1.0 - a2 ) + a2 );
	return 0.5 / max( gv + gl, 1e-5 );
}
float F_Schlick1( float f0, float c ) { float k = pow( 1.0 - c, 5.0 ); return f0 + ( 1.0 - f0 ) * k; }
vec3 F_Schlick3( vec3 f0, float c ) { float k = pow( 1.0 - c, 5.0 ); return f0 + ( 1.0 - f0 ) * k; }

vec2 envBRDFApprox( float NoV, float rough ) {
	const vec4 c0 = vec4( -1.0, -0.0275, -0.572, 0.022 );
	const vec4 c1 = vec4( 1.0, 0.0425, 1.04, -0.04 );
	vec4 r = rough * c0 + c1;
	float a004 = min( r.x * r.x, exp2( -9.28 * NoV ) ) * r.x + r.y;
	return vec2( -1.04, 1.04 ) * a004 + r.zw;
}

// direction (pointing away from the surface) after refraction into a slab of index 1.5
vec3 refractIn( vec3 w, vec3 n ) {
	const float eta = 1.0 / 1.5;
	float c = max( dot( w, n ), 0.0 );
	vec3 t = w - n * c;                // tangential part
	vec3 tr = t * eta;
	return normalize( tr + n * sqrt( max( 1.0 - dot( tr, tr ), 0.0 ) ) );
}

// Oren–Nayar diffuse (rough paper fibres scatter more back toward the light)
float orenNayar( vec3 L, vec3 V, vec3 N, float sigma ) {
	float NoL = dot( N, L ), NoV = dot( N, V );
	float s2 = sigma * sigma;
	float A = 1.0 - 0.5 * s2 / ( s2 + 0.33 );
	float B = 0.45 * s2 / ( s2 + 0.09 );
	float gamma = dot( V - N * NoV, L - N * NoL );
	float st = sqrt( max( ( 1.0 - NoL * NoL ) * ( 1.0 - NoV * NoV ), 0.0 ) ) / max( max( NoL, NoV ), 1e-3 );
	return A + B * max( gamma, 0.0 ) * st;
}

vec3 viewToWorld( vec3 v ) { return inverseTransformDirection( v, viewMatrix ); }
vec3 envRadiance( vec3 dirView, float rough ) {
	#ifdef ENVMAP_TYPE_CUBE_UV
		return textureCubeUV( envMap, viewToWorld( dirView ), rough ).rgb * envIntensity;
	#else
		return vec3( 0.0 );
	#endif
}

// ------------------------------------------------------------------ material

struct CardMat {
	vec3 albedo;     // print colour (linear)
	vec3 Nb;         // substrate normal
	vec3 Nc;         // varnish normal
	vec3 Nf;         // foil facet normal
	vec3 gk;         // grating vector (unit, in the foil plane)
	float gd;        // grating period (nm)
	float gAmp;      // fraction of foil energy going into diffraction orders
	float foil;      // foil coverage
	vec3 foilF0;     // foil reflectance filtered by the ink
	float foilRough;
	float coatRough;
	float paperSigma;
	float flake;     // micro-flake visibility at this pixel
	vec3 flakeN;     // flake normal
	vec3 flakeTint;
};

// first three grating orders for a single incoming / outgoing direction pair
vec3 diffractionDirect( vec3 L, vec3 V, CardMat m ) {
	vec3 g = normalize( cross( m.Nf, m.gk ) );
	vec3 s = L + V;
	float sk = abs( dot( s, m.gk ) );
	float sg = dot( s, g );
	float sigma = 0.035 + m.foilRough * 0.45;
	float w = exp( - sg * sg / ( 2.0 * sigma * sigma ) ) / ( sigma * 2.5066 );
	vec3 c = vec3( 0.0 );
	for ( int o = 1; o <= 3; o ++ ) {
		float lam = m.gd * sk / float( o );
		c += spectrumRGB( lam ) / float( o * o );
	}
	return c * SPEC_NORM * w * 0.3;
}

// image based diffraction: for each wavelength find the environment direction that the grating
// sends into the eye and integrate the spectrum
vec3 diffractionEnv( vec3 V, CardMat m ) {
	vec3 N = m.Nf, k = m.gk;
	vec3 g = normalize( cross( N, k ) );
	float vk = dot( V, k ), vg = dot( V, g );
	vec3 acc = vec3( 0.0 ), wsum = vec3( 1e-4 );
	float rough = 0.12 + m.foilRough * 0.6;
	for ( int j = 0; j < 8; j ++ ) {
		if ( j >= envSamples ) break;
		float lam = 405.0 + 280.0 * ( float( j ) + 0.5 ) / float( envSamples );
		vec3 c = spectrumRGB( lam );
		wsum += c;
		for ( int o = 1; o <= 2; o ++ ) {
			if ( o > envOrders ) break;
			for ( int sgn = -1; sgn <= 1; sgn += 2 ) {
				float lk = float( sgn * o ) * lam / m.gd - vk;
				float lg = - vg;
				float ln2 = 1.0 - lk * lk - lg * lg;
				if ( ln2 > 0.0 ) {
					vec3 Ld = lk * k + lg * g + sqrt( ln2 ) * N;
					acc += c * envRadiance( Ld, rough ) / float( o );
				}
			}
		}
	}
	return acc / wsum * 0.55;
}

#define LIGHT_SIZE 0.035
void RE_Direct_Card( const in IncidentLight dl, const in vec3 gp, const in vec3 gn, const in vec3 V, const in vec3 gcn, const in CardMat m, inout ReflectedLight rl ) {
	vec3 L = dl.direction;
	vec3 E = dl.color;
	float NoL = dot( m.Nc, L );
	float NoV = max( dot( m.Nc, V ), 1e-4 );
	if ( NoL <= 0.0 ) return;

	// 1 · varnish
	vec3 H = normalize( L + V );
	float NoH = max( dot( m.Nc, H ), 0.0 );
	float VoH = max( dot( V, H ), 0.0 );
	// lights are small spheres, not points: widen the lobe and keep the energy (Karis 2013)
	float ac = m.coatRough * m.coatRough;
	float acs = min( ac + LIGHT_SIZE, 1.0 );
	float Fc = F_Schlick1( 0.04, VoH );
	rl.directSpecular += E * NoL * Fc * D_GGXc( acs, NoH ) * V_SmithGGXc( acs, NoL, NoV );

	float Tin = ( 1.0 - F_Schlick1( 0.04, NoL ) ) * ( 1.0 - F_Schlick1( 0.04, NoV ) );

	// 2 · refraction into the print layer
	vec3 Lr = refractIn( L, m.Nb );
	vec3 Vr = refractIn( V, m.Nb );

	// 3a · paper
	float NoLb = max( dot( m.Nb, L ), 0.0 );
	float on = orenNayar( L, V, m.Nb, m.paperSigma );
	rl.directDiffuse += E * NoLb * Tin * ( 1.0 - m.foil ) * m.albedo * RECIPROCAL_PI * on;

	// 3b · holographic foil
	if ( m.foil > 0.001 ) {
		vec3 Hf = normalize( Lr + Vr );
		float af = min( m.foilRough * m.foilRough + LIGHT_SIZE, 1.0 );
		float NfL = max( dot( m.Nf, Lr ), 0.0 );
		float NfV = max( dot( m.Nf, Vr ), 1e-4 );
		float NfH = max( dot( m.Nf, Hf ), 0.0 );
		vec3 Ff = F_Schlick3( m.foilF0, max( dot( Vr, Hf ), 0.0 ) );
		vec3 zeroOrder = Ff * D_GGXc( af, NfH ) * V_SmithGGXc( af, NfL, NfV ) * NfL;
		vec3 orders = diffractionDirect( L, V, m ) * m.foilF0 * NoL;
		vec3 foilC = zeroOrder * ( 1.0 - m.gAmp ) + orders * m.gAmp;
		// a little light scatters off the white underlay below semi-transparent foil areas
		foilC += m.albedo * RECIPROCAL_PI * NoLb * 0.06;
		rl.directSpecular += E * Tin * m.foil * foilC;

		// metallic micro-flakes: tiny tilted mirrors → stochastic glints
		if ( m.flake > 0.0 ) {
			float fh = max( dot( m.flakeN, Hf ), 0.0 );
			float glint = pow( fh, 900.0 ) * 140.0;
			rl.directSpecular += E * Tin * m.flake * min( glint, 60.0 ) * m.flakeTint * NoL;
		}
	}
}
#define RE_Direct RE_Direct_Card

// ------------------------------------------------------------------ foil patterns

// voronoi returning (cell id, distance to border)
vec3 voronoi( vec2 x ) {
	vec2 n = floor( x ), f = fract( x );
	vec2 mg, mr;
	float md = 8.0;
	for ( int j = -1; j <= 1; j ++ ) for ( int i = -1; i <= 1; i ++ ) {
		vec2 g = vec2( float( i ), float( j ) );
		vec2 o = hash22( n + g );
		vec2 r = g + o - f;
		float d = dot( r, r );
		if ( d < md ) { md = d; mr = r; mg = g; }
	}
	md = 8.0;
	for ( int j = -2; j <= 2; j ++ ) for ( int i = -2; i <= 2; i ++ ) {
		vec2 g = mg + vec2( float( i ), float( j ) );
		vec2 o = hash22( n + g );
		vec2 r = g + o - f;
		if ( dot( mr - r, mr - r ) > 0.00001 ) md = min( md, dot( 0.5 * ( mr + r ), normalize( r - mr ) ) );
	}
	return vec3( n + mg, md );
}

float sdCircle( vec2 p, float r ) { return length( p ) - r; }

// Poké Ball silhouette, 1 inside the foil print, 0 outside
float ballMask( vec2 p, float r, bool master ) {
	float d = sdCircle( p, r );
	float band = abs( p.y ) - r * 0.09;
	float button = sdCircle( p, r * 0.3 );
	float m = 1.0 - smoothstep( -0.01, 0.01, d );
	m *= smoothstep( -0.01, 0.01, band ) + ( 1.0 - smoothstep( -0.01, 0.01, button ) );
	m = clamp( m, 0.0, 1.0 );
	m *= smoothstep( -0.01, 0.01, sdCircle( p, r * 0.2 ) ) + ( 1.0 - smoothstep( -0.01, 0.01, sdCircle( p, r * 0.12 ) ) );
	if ( master && p.y > 0.0 ) {
		// the "M" bumps on the upper half
		float bumps = min( sdCircle( p - vec2( -r * 0.45, r * 0.45 ), r * 0.16 ), sdCircle( p - vec2( r * 0.45, r * 0.45 ), r * 0.16 ) );
		m *= smoothstep( -0.01, 0.01, bumps );
	}
	return clamp( m, 0.0, 1.0 );
}

struct FoilSample {
	float mask;      // foil coverage multiplier
	float angle;     // grating direction (radians)
	float period;    // nm
	vec2 tilt;       // facet tilt
	float seam;      // dark seams between facets
	float flakes;    // flake density
	float rough;
};

FoilSample foilPattern( vec2 p ) {
	FoilSample s;
	s.mask = 1.0; s.angle = 0.6; s.period = 1300.0; s.tilt = vec2( 0.0 ); s.seam = 0.0; s.flakes = 0.0; s.rough = 0.22;
	vec2 q = p + seed * 13.0;

	if ( pattern == 0 ) {
		// classic linear holo with slow wobble and streaks
		float w = fbm( q * 0.18 );
		s.angle = 0.45 + 0.6 * ( w - 0.5 );
		s.period = 1050.0 + 900.0 * fbm( q * 0.11 + 3.0 );
		s.tilt = ( vec2( fbm( q * 0.35 ), fbm( q * 0.35 + 7.0 ) ) - 0.5 ) * 0.12;
		s.rough = 0.2;
	} else if ( pattern == 1 ) {
		// shattered glass mosaic (modern holo rare)
		vec3 v = voronoi( q * 2.0 );
		vec3 h = hash32( v.xy );
		s.angle = h.x * PI;
		s.period = 900.0 + 1100.0 * h.y;
		s.tilt = ( hash22( v.xy + 5.0 ) - 0.5 ) * 0.32;
		s.seam = 1.0 - smoothstep( 0.0, 0.035, v.z );
		s.rough = 0.16;
	} else if ( pattern == 2 ) {
		// cosmos: discs of different size floating on a linear holo
		s.angle = 0.3 + 0.3 * fbm( q * 0.2 );
		s.period = 1500.0;
		for ( int l = 0; l < 2; l ++ ) {
			float sc = l == 0 ? 1.2 : 3.4;
			vec2 c = floor( q * sc );
			vec2 f = fract( q * sc ) - 0.5;
			vec3 h = hash32( c + float( l ) * 31.0 );
			vec2 o = ( h.xy - 0.5 ) * 0.5;
			float r = 0.12 + 0.22 * h.z;
			if ( length( f - o ) < r ) {
				s.angle = h.x * 6.283; s.period = 800.0 + 1300.0 * h.y;
				s.tilt = ( h.yz - 0.5 ) * 0.3;
				s.seam = smoothstep( r - 0.03, r, length( f - o ) );
			}
		}
	} else if ( pattern == 3 || pattern == 4 || pattern == 5 ) {
		// sparkle reverse holo, optionally printed in Poké Ball / Master Ball shapes
		vec3 v = voronoi( q * 7.0 );
		vec3 h = hash32( v.xy );
		s.angle = h.x * PI;
		s.period = 850.0 + 1200.0 * h.y;
		s.tilt = ( hash22( v.xy + 3.0 ) - 0.5 ) * 0.45;
		s.flakes = 0.55;
		s.rough = 0.26;
		if ( pattern != 3 ) {
			float cell = 1.55;
			vec2 gp = p / cell;
			float row = floor( gp.y );
			gp.x += mod( row, 2.0 ) * 0.5;
			vec2 lp = ( fract( gp ) - 0.5 ) * cell;
			s.mask = ballMask( lp, cell * 0.36, pattern == 5 );
		}
	} else if ( pattern == 6 ) {
		// etched full art: smooth rainbow flow + fine texture + glitter
		float w = fbm( q * 0.25 );
		s.angle = 1.2 * w + 0.3 * sin( q.y * 0.5 );
		s.period = 1000.0 + 1100.0 * fbm( q * 0.16 + 9.0 );
		s.tilt = ( vec2( fbm( q * 1.3 ), fbm( q * 1.3 + 4.0 ) ) - 0.5 ) * 0.2;
		s.flakes = 0.45;
		s.rough = 0.24;
	} else if ( pattern == 7 ) {
		// soft illustration sheen: big flowing bands + dense fine glitter
		float w = fbm( q * 0.14 );
		s.angle = 2.0 * w;
		s.period = 1250.0 + 700.0 * w;
		s.tilt = ( vec2( fbm( q * 0.9 ), fbm( q * 0.9 + 2.0 ) ) - 0.5 ) * 0.14;
		s.flakes = 0.85;
		s.rough = 0.3;
	} else {
		// gold / metal: brushed metal with weak grating
		s.angle = 1.5708;
		s.period = 2200.0;
		s.tilt = ( vec2( fbm( q * 2.0 ), fbm( q * 2.0 + 1.0 ) ) - 0.5 ) * 0.16;
		s.flakes = 0.5;
		s.rough = 0.2;
	}
	s.period *= gratingScale;
	return s;
}

// embossed texture height field (used by textured full arts / gold cards)
float embossHeight( vec2 p, vec2 uv ) {
	float img = luma( texture2D( map, uv ).rgb );
	vec2 q = p + seed * 7.0;
	float warp = fbm( q * 0.6 ) * 3.0;
	float lines = 0.5 + 0.5 * sin( ( q.x * 0.7 + q.y * 0.7 ) * 26.0 + warp * 6.0 );
	float dots = smoothstep( 0.35, 0.0, length( fract( q * 9.0 ) - 0.5 ) );
	return img * 0.6 + lines * 0.35 + dots * 0.12;
}

// ------------------------------------------------------------------ main

void main() {
	vec2 hs = cardSize * 0.5;
	float isEdge = step( 1.5, vFace );
	float isBack = step( 0.5, vFace ) * ( 1.0 - isEdge );

	// rounded corners (die cut)
	float alpha = 1.0;
	if ( isEdge < 0.5 ) {
		vec2 q = abs( vLocal ) - hs + cornerR;
		float d = length( max( q, 0.0 ) ) + min( max( q.x, q.y ), 0.0 ) - cornerR;
		float fw = fwidth( d );
		alpha = 1.0 - smoothstep( -fw, fw * 0.5, d );
		if ( alpha <= 0.0 ) discard;
	}

	vec3 N = normalize( vNormalV );
	vec3 Tg = normalize( vTangentV - N * dot( vTangentV, N ) );
	vec3 Bt = cross( N, Tg );
	vec3 V = normalize( vViewPosition );

	CardMat material;
	material.Nb = N;
	material.Nc = N;
	material.Nf = N;
	material.gk = Tg;
	material.gd = 1300.0;
	material.gAmp = 0.0;
	material.foil = 0.0;
	material.foilF0 = vec3( 0.0 );
	material.foilRough = 0.25;
	material.coatRough = coatRough;
	material.paperSigma = 0.55;
	material.flake = 0.0;
	material.flakeN = N;
	material.flakeTint = vec3( 1.0 );

	vec3 emission = vec3( 0.0 );
	vec2 imgUV = vec2( vUv.x, 1.0 - vUv.y );

	if ( isEdge > 0.5 ) {
		// paper core with the black light-blocking layer in the middle
		float v = vUv.y;
		float core = smoothstep( 0.40, 0.46, v ) * ( 1.0 - smoothstep( 0.54, 0.60, v ) );
		material.albedo = mix( vec3( 0.80, 0.79, 0.76 ), vec3( 0.025 ), core );
		material.coatRough = 0.6;
		material.paperSigma = 0.9;
	} else if ( isBack > 0.5 ) {
		material.albedo = texture2D( backMap, vUv ).rgb;
		material.coatRough = coatRough * 1.25;
	} else {
		vec3 ink = texture2D( map, vUv ).rgb;
		material.albedo = ink;

		// foil coverage
		bool inArt = imgUV.x > artBox.x && imgUV.x < artBox.z && imgUV.y > artBox.y && imgUV.y < artBox.w;
		float f = 0.0;
		if ( foilMode == 1 ) f = inArt ? 1.0 : 0.0;
		else if ( foilMode == 2 ) f = inArt ? 0.0 : 1.0;
		else if ( foilMode == 3 ) f = 1.0;

		// textured varnish (emboss)
		if ( emboss > 0.0 ) {
			float e = 0.012;
			vec2 duv = vec2( e / cardSize.x, e / cardSize.y );
			float h0 = embossHeight( vLocal, vUv );
			float hx = embossHeight( vLocal + vec2( e, 0.0 ), vUv + vec2( duv.x, 0.0 ) );
			float hy = embossHeight( vLocal + vec2( 0.0, e ), vUv + vec2( 0.0, duv.y ) );
			vec2 grad = vec2( hx - h0, hy - h0 ) / e;
			vec3 nt = normalize( vec3( - grad * emboss * 0.012, 1.0 ) );
			material.Nc = normalize( Tg * nt.x + Bt * nt.y + N * nt.z );
			material.Nb = material.Nc;
		}

		if ( f > 0.0 ) {
			FoilSample fs = foilPattern( vLocal );
			f *= fs.mask;
			// ink density decides how much of the foil shines through: highlights in the print
			// let the foil through, deep shadows hide it (white underlay areas behave like paper)
			float through = foilMode == 3 ? mix( 0.25, 1.0, smoothstep( 0.04, 0.65, luma( ink ) ) )
			                              : mix( 0.55, 1.0, smoothstep( 0.02, 0.6, luma( ink ) ) );
			material.foil = clamp( f * foilStrength * through, 0.0, 1.0 );
			material.foilRough = fs.rough;
			material.foilF0 = clamp( ink * foilTint, 0.0, 1.0 );
			vec3 nf = normalize( material.Nc + Tg * fs.tilt.x + Bt * fs.tilt.y );
			material.Nf = nf;
			vec3 kd = Tg * cos( fs.angle ) + Bt * sin( fs.angle );
			material.gk = normalize( kd - nf * dot( kd, nf ) );
			material.gd = fs.period;
			material.gAmp = diffractAmp;
			material.albedo *= 1.0 - fs.seam * 0.35;
			material.foilF0 *= 1.0 - fs.seam * 0.6;

			// micro-flakes
			float fl = fs.flakes * glitter;
			if ( fl > 0.0 ) {
				float cs = 0.03;
				vec2 cell = floor( ( vLocal + seed * 3.0 ) / cs );
				vec3 h = hash32( cell );
				float px = fwidth( vLocal.x ) / cs;
				float present = step( h.z, fl * 0.075 ) * ( 1.0 - smoothstep( 0.6, 1.4, px ) );
				vec2 t2 = ( h.xy - 0.5 ) * 0.9;
				material.flakeN = normalize( N + Tg * t2.x + Bt * t2.y );
				material.flake = present * material.foil;
				material.flakeTint = mix( vec3( 1.0 ), spectrumRGB( 420.0 + 260.0 * hash12( cell + 9.1 ) ) * SPEC_NORM, 0.7 ) * clamp( foilTint, 0.0, 1.0 );
			}
		}

		// reveal shimmer sweeping over the face
		if ( sweep > 0.0 && sweep < 1.0 ) {
			float diag = ( imgUV.x + imgUV.y ) * 0.5;
			float band = exp( - pow( ( diag - ( sweep * 1.6 - 0.3 ) ) / 0.06, 2.0 ) );
			emission += band * ( 0.25 + material.foil * 1.2 ) * spectrumRGB( 420.0 + 260.0 * diag ) * SPEC_NORM * 0.6;
		}
	}

	// ---------------------------------------------------------------- direct lights
	ReflectedLight reflectedLight = ReflectedLight( vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ), vec3( 0.0 ) );
	vec3 normal = material.Nc;
	#include <lights_fragment_begin>

	// ---------------------------------------------------------------- image based lighting
	vec3 indirectDiffuse = vec3( 0.0 );
	vec3 indirectSpec = vec3( 0.0 );
	if ( hasEnv > 0.5 ) {
		float NoV = max( dot( material.Nc, V ), 1e-4 );
		float Tin = 1.0 - F_Schlick1( 0.04, NoV );
		vec3 irr = envRadiance( material.Nb, 1.0 );
		indirectDiffuse = irr * material.albedo * ( 1.0 - material.foil ) * Tin * Tin;

		vec3 Rc = reflect( - V, material.Nc );
		vec2 ab = envBRDFApprox( NoV, material.coatRough );
		indirectSpec += envRadiance( Rc, material.coatRough ) * ( 0.04 * ab.x + ab.y );

		if ( material.foil > 0.001 ) {
			vec3 Rf = reflect( - V, material.Nf );
			float NfV = max( dot( material.Nf, V ), 1e-4 );
			vec2 abf = envBRDFApprox( NfV, material.foilRough );
			vec3 zero = envRadiance( Rf, material.foilRough ) * ( material.foilF0 * abf.x + abf.y );
			vec3 orders = diffractionEnv( V, material ) * material.foilF0;
			vec3 foilI = zero * ( 1.0 - material.gAmp ) + orders * material.gAmp;
			foilI += irr * material.albedo * 0.06;
			indirectSpec += foilI * material.foil * Tin * Tin;
			if ( material.flake > 0.0 ) {
				vec3 Rk = reflect( - V, material.flakeN );
				indirectSpec += envRadiance( Rk, 0.03 ) * material.flake * material.flakeTint * 0.35 * Tin;
			}
		}
	}

	// ---------------------------------------------------------------- anticipation aura on the back
	if ( aura > 0.0 && isBack > 0.5 ) {
		vec2 q = abs( vLocal ) - hs;
		float edgeDist = - max( q.x, q.y );
		float rim = exp( - edgeDist / 0.55 );
		vec3 col = auraColor;
		if ( auraRainbow > 0.5 ) col = hsv2rgb( vec3( fract( time * 0.25 + ( vLocal.x + vLocal.y ) * 0.06 ), 0.75, 1.0 ) ) * 1.4;
		float pulse = 0.65 + 0.35 * sin( time * 6.0 );
		emission += col * rim * aura * pulse * 3.0;
	}

	vec3 outgoing = reflectedLight.directDiffuse + reflectedLight.directSpecular + indirectDiffuse + indirectSpec + emission;
	outgoing = min( outgoing * exposureBoost, vec3( 200.0 ) );

	gl_FragColor = vec4( outgoing, alpha );

	#include <tonemapping_fragment>
	#include <colorspace_fragment>
}
`;
