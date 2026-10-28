import { SETS, RARITY } from './config.js';

const $ = id => document.getElementById( id );

export class UI {
	constructor() {
		this.el = {};
		for ( const id of [ 'loading', 'menu', 'setList', 'openBtn', 'collectionBtn', 'clearBtn', 'hint', 'banner', 'tearBtn', 'autoBtn', 'dropBtn',
			'settingsBtn', 'settings', 'envSel', 'followLight', 'tempSlider', 'tempVal', 'intSlider', 'qualitySel', 'bloomChk', 'soundChk', 'gyroChk',
			'forceSel', 'closeSettings', 'summary', 'summaryList', 'againBtn', 'backBtn', 'collection', 'colSet', 'closeCollection', 'colProgress',
			'colGrid', 'toast', 'stats' ] ) this.el[ id ] = $( id );
		this.el.settingsBtn.onclick = () => this.el.settings.classList.toggle( 'hidden' );
		this.el.closeSettings.onclick = () => this.el.settings.classList.add( 'hidden' );
		this.el.closeCollection.onclick = () => this.el.collection.classList.add( 'hidden' );
		this.bannerTimer = 0;
	}

	doneLoading() { this.el.loading.classList.add( 'done' ); setTimeout( () => this.el.loading.remove(), 800 ); }
	loadingText( t ) { const n = this.el.loading.querySelector( '.loading-text' ); if ( n ) n.textContent = t; }

	show( id, on = true ) { this.el[ id ].classList.toggle( 'hidden', ! on ); }

	hint( text ) { if ( this.el.hint.textContent !== text ) this.el.hint.textContent = text || ''; }

	toast( msg, ms = 4200 ) {
		const t = this.el.toast;
		t.textContent = msg;
		t.classList.add( 'show' );
		clearTimeout( this.toastTimer );
		this.toastTimer = setTimeout( () => t.classList.remove( 'show' ), ms );
	}

	buildSetList( setDatas, current, onSelect ) {
		const list = this.el.setList;
		list.innerHTML = '';
		for ( const meta of SETS ) {
			const d = setDatas[ meta.id ];
			const b = document.createElement( 'button' );
			b.className = 'set-item' + ( meta.id === current ? ' active' : '' );
			b.dataset.id = meta.id;
			b.innerHTML = `<span class="swatch" style="background:linear-gradient(160deg,${meta.color2},${meta.color} 55%,${meta.color2})"></span>
				<span><div class="name">${meta.zh}</div><div class="en">${d ? d.name + ' · ' + d.total + '张' : ''}</div></span>`;
			if ( d?.logo ) {
				const img = new Image();
				img.src = d.logo; img.alt = '';
				img.onerror = () => img.remove();
				b.appendChild( img );
			}
			b.onclick = () => {
				list.querySelectorAll( '.set-item' ).forEach( x => x.classList.toggle( 'active', x === b ) );
				onSelect( meta.id );
			};
			list.appendChild( b );
		}
	}

	banner( card ) {
		const b = this.el.banner;
		const t = card.info.tier;
		if ( t < 2 && ! card.info.reverse ) { b.classList.remove( 'show' ); return; }
		b.className = `banner tier-${t}${card.info.soft ? ' soft' : ''}`;
		b.innerHTML = `<div class="code">${card.info.code}</div><div class="zh">${card.info.zh}</div><div class="cname">${card.data.n} · ${card.data.no}</div>`;
		requestAnimationFrame( () => b.classList.add( 'show' ) );
		clearTimeout( this.bannerTimer );
		this.bannerTimer = setTimeout( () => b.classList.remove( 'show' ), t >= 4 ? 4200 : 2600 );
	}
	hideBanner() { this.el.banner.classList.remove( 'show' ); }

	summary( cards ) {
		const l = this.el.summaryList;
		l.innerHTML = '';
		for ( const c of cards ) {
			const d = document.createElement( 'div' );
			d.className = 'sum-item' + ( c.info.tier >= 3 ? ' hit' : '' );
			const src = c.thumb || c.thumbData || '';
			d.innerHTML = `${src ? `<img src="${src}" alt="">` : '<img alt="">'}<div><div class="r badge-t${c.info.tier}">${c.info.code}${c.info.reverse ? ' ◆' : ''}</div><div class="n" title="${c.data.n}">${c.data.n}</div></div>`;
			l.appendChild( d );
		}
		this.show( 'summary' );
	}

	stats( s ) {
		this.el.stats.textContent = `已开 ${s.packs} 包 · 收集 ${s.unique} 种 · 大奖 ${s.hits} 张`;
	}

	openCollection( setDatas, collection, current ) {
		const sel = this.el.colSet;
		if ( ! sel.options.length ) {
			for ( const m of SETS ) { const o = document.createElement( 'option' ); o.value = m.id; o.textContent = m.zh; sel.appendChild( o ); }
			sel.onchange = () => this.renderCollection( setDatas, collection, sel.value );
		}
		sel.value = current;
		this.renderCollection( setDatas, collection, current );
		this.show( 'collection' );
	}

	renderCollection( setDatas, collection, id ) {
		const d = setDatas[ id ];
		const grid = this.el.colGrid;
		grid.innerHTML = '';
		if ( ! d ) { this.el.colProgress.textContent = '加载中…'; return; }
		let owned = 0;
		for ( const c of d.cards ) {
			const n = collection[ c.id ] || 0;
			if ( n ) owned ++;
			const r = RARITY[ c.r ] || { code: '?' };
			const e = document.createElement( 'div' );
			e.className = 'col-card' + ( n ? '' : ' missing' );
			e.innerHTML = `<span>${c.no}<br>${c.n}</span>${n ? `<img src="${c.img.replace( '_hires', '' )}" alt="" loading="lazy" onerror="this.remove()">` : ''}<span class="rr">${r.code}</span>${n ? `<span class="cnt">×${n}</span>` : ''}`;
			grid.appendChild( e );
		}
		this.el.colProgress.textContent = `${d.name}：已收集 ${owned} / ${d.cards.length}（${( owned / d.cards.length * 100 ).toFixed( 1 )}%）`;
	}
}
