// Physical dimensions are in centimetres throughout the app (render + physics).
export const CARD_W = 6.3;
export const CARD_H = 8.8;
export const CARD_T = 0.032;
export const CARD_R = 0.32;

export const PACK_W = 7.4;
export const PACK_H = 13.4;

export const SETS = [
	{ id: 'sv3pt5', zh: '宝可梦卡牌 151', era: 'sv', mascot: [151, 6, 25], color: '#e8433a', color2: '#2a3e9b', specialBalls: true },
	{ id: 'sv8pt5', zh: '璀璨诡幻·伊布', era: 'sv', mascot: [133, 700, 197], color: '#c084fc', color2: '#1e1b4b', specialBalls: true, noIR: true },
	{ id: 'sv8', zh: '超电突围', era: 'sv', mascot: [25, 1009, 1010], color: '#facc15', color2: '#0f172a', aceSpec: true },
	{ id: 'sv10', zh: '火箭队的荣光', era: 'sv', mascot: [150, 52, 24], color: '#b91c1c', color2: '#111111' },
	{ id: 'me1', zh: '超级进化', era: 'me', mascot: [282, 448, 6], color: '#38bdf8', color2: '#0c1222' },
	{ id: 'swsh7', zh: '苍空烈潮', era: 'swsh', mascot: [384, 197, 196], color: '#16a34a', color2: '#052e2b' },
];

// rarity → display + effect tier
//   tier 0 common · 1 reverse/plain rare · 2 holo rare · 3 double rare · 4 ultra/illustration
//   5 special illustration / rainbow · 6 gold
export const RARITY = {
	'Common': { code: 'C', zh: '普通', tier: 0 },
	'Uncommon': { code: 'U', zh: '非普通', tier: 0 },
	'Rare': { code: 'R', zh: '稀有', tier: 2 },
	'Double Rare': { code: 'RR', zh: '双倍稀有', tier: 3 },
	'ACE SPEC Rare': { code: 'ACE', zh: 'ACE SPEC', tier: 3 },
	'Ultra Rare': { code: 'SR', zh: '超级稀有', tier: 4 },
	'Illustration Rare': { code: 'AR', zh: '插画稀有', tier: 4, soft: true },
	'Special Illustration Rare': { code: 'SAR', zh: '特别插画稀有', tier: 5 },
	'Hyper Rare': { code: 'UR', zh: '超稀有·金卡', tier: 6 },
	'Mega Hyper Rare': { code: 'MUR', zh: '超级进化·金卡', tier: 6 },
	'Shiny Rare': { code: 'S', zh: '异色稀有', tier: 3 },
	'Shiny Ultra Rare': { code: 'SSR', zh: '异色超级稀有', tier: 5 },
	'Rare Holo': { code: 'R', zh: '闪卡稀有', tier: 2 },
	'Rare Holo V': { code: 'RR', zh: 'V 稀有', tier: 3 },
	'Rare Holo VMAX': { code: 'RRR', zh: 'VMAX 稀有', tier: 3 },
	'Rare Ultra': { code: 'SR', zh: '超级稀有', tier: 4 },
	'Rare Rainbow': { code: 'HR', zh: '彩虹稀有', tier: 5 },
	'Rare Secret': { code: 'UR', zh: '金色秘密稀有', tier: 6 },
};

export function rarityInfo( rarity, era, reverse ) {
	const base = RARITY[ rarity ] || { code: '?', zh: rarity, tier: 0 };
	const info = { ...base };
	if ( era === 'swsh' && rarity === 'Rare' ) info.tier = 1;
	if ( reverse ) {
		info.reverse = true;
		info.tier = Math.max( info.tier, 1 );
		info.zh = info.zh + ' · 反闪';
	}
	return info;
}

export const TIER_COLORS = [
	'#9aa3ad', // 0
	'#c7d2fe', // 1
	'#e5e7eb', // 2
	'#60a5fa', // 3
	'#c084fc', // 4
	'#ff5fd2', // 5 (rainbow)
	'#fbbf24', // 6 gold
];

// Image-space art window (top-left origin, fractions of the card face)
export const ART_BOX = {
	sv: { pokemon: [ 0.078, 0.108, 0.922, 0.53 ], trainer: [ 0.12, 0.145, 0.88, 0.46 ] },
	me: { pokemon: [ 0.078, 0.108, 0.922, 0.53 ], trainer: [ 0.12, 0.145, 0.88, 0.46 ] },
	swsh: { pokemon: [ 0.085, 0.105, 0.915, 0.505 ], trainer: [ 0.12, 0.14, 0.88, 0.45 ] },
};

// Foil / finish presets, interpreted by the card shader
//   foilMode: 0 none · 1 art box · 2 reverse (everything but the art box) · 3 full card
//   pattern : 0 linear · 1 shattered · 2 cosmos · 3 sparkle · 4 poké ball · 5 master ball
//             6 etched full art · 7 illustration sheen · 8 gold metal
export function finishFor( card, era ) {
	const r = card.rarity;
	const f = { foilMode: 0, pattern: 0, foilStrength: 0, emboss: 0, glitter: 0, diffractAmp: 0.55, tint: [ 1, 1, 1 ], coatRough: 0.1, gratingScale: 1 };
	if ( card.reverse ) {
		Object.assign( f, { foilMode: 2, pattern: era === 'swsh' ? 0 : 3, foilStrength: 0.85, glitter: era === 'swsh' ? 0 : 0.9, diffractAmp: 0.6 } );
		if ( card.reverse === 'pokeball' ) Object.assign( f, { pattern: 4, foilStrength: 0.95 } );
		if ( card.reverse === 'masterball' ) Object.assign( f, { pattern: 5, foilStrength: 1.0, tint: [ 1.0, 0.92, 1.0 ] } );
		return f;
	}
	switch ( r ) {
		case 'Common': case 'Uncommon': return f;
		case 'Rare':
			if ( era === 'swsh' ) return f;
			return Object.assign( f, { foilMode: 1, pattern: 1, foilStrength: 0.9, diffractAmp: 0.6 } );
		case 'Rare Holo':
			return Object.assign( f, { foilMode: 1, pattern: 2, foilStrength: 0.9, diffractAmp: 0.65 } );
		case 'Shiny Rare':
			return Object.assign( f, { foilMode: 3, pattern: 3, foilStrength: 0.45, glitter: 1.0, diffractAmp: 0.6 } );
		case 'Double Rare': case 'Rare Holo V': case 'Rare Holo VMAX': case 'ACE SPEC Rare':
			return Object.assign( f, { foilMode: 3, pattern: r === 'Rare Holo VMAX' ? 2 : 0, foilStrength: 0.45, emboss: 0.35, glitter: 0.3, diffractAmp: 0.6, coatRough: 0.15,
				tint: r === 'ACE SPEC Rare' ? [ 1.0, 0.85, 1.0 ] : [ 1, 1, 1 ] } );
		case 'Ultra Rare': case 'Rare Ultra':
			return Object.assign( f, { foilMode: 3, pattern: 6, foilStrength: 0.55, emboss: 1.0, glitter: 0.8, diffractAmp: 0.62, coatRough: 0.15 } );
		case 'Illustration Rare':
			return Object.assign( f, { foilMode: 3, pattern: 7, foilStrength: 0.32, emboss: 0.55, glitter: 0.9, diffractAmp: 0.5, coatRough: 0.15 } );
		case 'Special Illustration Rare': case 'Shiny Ultra Rare':
			return Object.assign( f, { foilMode: 3, pattern: 6, foilStrength: 0.42, emboss: 1.15, glitter: 1.0, diffractAmp: 0.7, coatRough: 0.15, gratingScale: 0.9 } );
		case 'Rare Rainbow':
			return Object.assign( f, { foilMode: 3, pattern: 6, foilStrength: 0.85, emboss: 1.0, glitter: 0.7, diffractAmp: 0.75, coatRough: 0.15 } );
		case 'Hyper Rare': case 'Mega Hyper Rare': case 'Rare Secret':
			return Object.assign( f, { foilMode: 3, pattern: 8, foilStrength: 0.95, emboss: 1.4, glitter: 0.9, diffractAmp: 0.22, coatRough: 0.15, tint: [ 1.0, 0.95, 0.85 ] } );
	}
	return f;
}

// Type colours used by the procedural card painter and effects
export const TYPE_COLORS = {
	Grass: [ '#7ac74c', '#3d7a1f' ], Fire: [ '#f08030', '#a32a12' ], Water: [ '#5aa9f0', '#1d4f9c' ],
	Lightning: [ '#f8d030', '#b58a00' ], Psychic: [ '#c06ee8', '#6a2c91' ], Fighting: [ '#c8774a', '#6e3714' ],
	Darkness: [ '#4a5a6a', '#141c24' ], Metal: [ '#b8bccc', '#5f6577' ], Dragon: [ '#c9a63a', '#5c4a12' ],
	Colorless: [ '#e6e2d6', '#9a958a' ], Fairy: [ '#f4a3c8', '#a34a78' ],
};
