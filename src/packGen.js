// Booster pack composition, modelled on published pull-rate data for each era.

const setCache = new Map();

export async function loadSet( id ) {
	if ( setCache.has( id ) ) return setCache.get( id );
	const res = await fetch( `./data/${id}.json` );
	const data = await res.json();
	const byRarity = {};
	for ( const c of data.cards ) ( byRarity[ c.r ] ||= [] ).push( c );
	data.byRarity = byRarity;
	setCache.set( id, data );
	return data;
}

const pick = ( arr, rnd ) => arr[ Math.floor( rnd() * arr.length ) ];

function pickDistinct( arr, n, rnd, taken ) {
	const out = [];
	let guard = 0;
	while ( out.length < n && guard ++ < 200 ) {
		const c = pick( arr, rnd );
		if ( taken.has( c.id ) ) continue;
		taken.add( c.id );
		out.push( c );
	}
	return out;
}

// roll a slot from a weighted table: [[rarity, probability], ...]; first hit wins
function roll( table, set, rnd ) {
	for ( const [ rarity, p ] of table ) {
		if ( set.byRarity[ rarity ]?.length && rnd() < p ) return rarity;
	}
	return null;
}

export function generatePack( set, meta, rnd = Math.random, force = null ) {
	const taken = new Set();
	const b = set.byRarity;
	const cards = [];
	const add = ( c, extra = {} ) => cards.push( { ...c, rarity: c.r, ...extra } );
	const commons = b[ 'Common' ] || [];
	const uncommons = b[ 'Uncommon' ] || [];

	if ( meta.era === 'swsh' ) {
		pickDistinct( commons, 5, rnd, taken ).forEach( c => add( c ) );
		pickDistinct( uncommons, 3, rnd, taken ).forEach( c => add( c ) );
		const revPool = [ ...commons, ...uncommons, ...( b[ 'Rare' ] || [] ), ...( b[ 'Rare Holo' ] || [] ) ];
		add( pick( revPool, rnd ), { reverse: 'holo' } );
		const r = force || roll( [
			[ 'Rare Secret', 1 / 72 ], [ 'Rare Rainbow', 1 / 44 ], [ 'Rare Ultra', 1 / 16 ],
			[ 'Rare Holo VMAX', 1 / 14 ], [ 'Rare Holo V', 1 / 7 ], [ 'Rare Holo', 1 / 3 ],
		], set, rnd ) || 'Rare';
		add( pick( b[ r ] || b[ 'Rare' ], rnd ) );
		return cards;
	}

	// Scarlet & Violet / Mega Evolution structure
	pickDistinct( commons, 4, rnd, taken ).forEach( c => add( c ) );
	pickDistinct( uncommons, 3, rnd, taken ).forEach( c => add( c ) );
	const revPool = [ ...commons, ...uncommons, ...( b[ 'Rare' ] || [] ) ];
	const reverseKind = () => {
		if ( ! meta.specialBalls ) return 'holo';
		const x = rnd();
		return x < 0.04 ? 'masterball' : x < 0.33 ? 'pokeball' : 'holo';
	};

	// slot 8: reverse holo or ACE SPEC
	if ( meta.aceSpec && b[ 'ACE SPEC Rare' ] && rnd() < 1 / 20 ) add( pick( b[ 'ACE SPEC Rare' ], rnd ) );
	else add( pick( revPool, rnd ), { reverse: reverseKind() } );

	// slot 9: reverse holo or an illustration-class hit
	const illus = force && [ 'Illustration Rare', 'Special Illustration Rare', 'Hyper Rare', 'Mega Hyper Rare' ].includes( force )
		? force
		: roll( meta.noIR
			? [ [ 'Hyper Rare', 1 / 180 ], [ 'Special Illustration Rare', 1 / 45 ] ]
			: [ [ 'Mega Hyper Rare', 1 / 250 ], [ 'Hyper Rare', 1 / 55 ], [ 'Special Illustration Rare', 1 / 32 ], [ 'Illustration Rare', 1 / 12 ] ], set, rnd );
	if ( illus && b[ illus ] ) add( pick( b[ illus ], rnd ) );
	else add( pick( revPool, rnd ), { reverse: reverseKind() } );

	// slot 10: rare slot
	const rare = force && [ 'Ultra Rare', 'Double Rare', 'Rare', 'Shiny Rare' ].includes( force )
		? force
		: roll( [ [ 'Ultra Rare', 1 / 15 ], [ 'Double Rare', 1 / 6 ] ], set, rnd ) || 'Rare';
	add( pick( b[ rare ] || b[ 'Rare' ], rnd ) );
	if ( force === 'ACE SPEC Rare' && b[ force ] ) cards[ 7 ] = { ...pick( b[ force ], rnd ), rarity: force };
	return cards;
}
