(function(){
'use strict';
var cfg  = window.WPX_EXPORT || {};
var feed = document.getElementById('wpx-feed');
if(!feed) return;

/* How many posts become visible per scroll step, regardless of how
   many posts each JSON chunk carries. */
var PAGE_SIZE = 10;

var state = {
	manifest   : null,
	chunks     : [],      /* [{file, month, label}] newest month first */
	startIdx   : 0,       /* chunk index to start from (URL hash #YYYY-MM) */
	next       : 0,       /* next chunk index to fetch */
	queue      : [],      /* fetched but not yet displayed */
	shown      : 0,
	total      : 0,
	loading    : false,
	sentinel   : null,
	lastMonth  : null     /* month key of the last inserted header */
};

var monthLabels = {};    /* month key => human label, from the manifest */

function escHtml(s){
	return String(s==null?'':s)
		.replace(/&/g,'&amp;').replace(/</g,'&lt;')
		.replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function insertHtml(html){
	var w=document.createElement('div');
	w.innerHTML=html;
	while(w.firstChild) feed.insertBefore(w.firstChild,state.sentinel);
}

function monthHeader(month,label){
	var d=document.createElement('div');
	d.className='month-header';
	d.setAttribute('data-month',month);
	d.innerHTML='<h2 class="month-title">'+escHtml(label||month)+'</h2>';
	return d;
}

/* The archives widget links months as /2026/08/ -> month.html#2026-08.
   A hash names the month the visitor clicked; keep everything NEWER than
   it out of the feed so scrolling keeps loading backwards (older). */
function resolveStart(){
	var h=(window.location.hash||'').replace(/^#/,'');
	if(!h) return 0;
	for(var i=0;i<state.chunks.length;i++){
		if(state.chunks[i]&&state.chunks[i].month===h) return i;
	}
	return 0;
}

function updateHeading(){
	var h=(window.location.hash||'').replace(/^#/,'');
	var headEl=document.getElementById('wpx-arc-heading');
	if(!headEl||!h) return;
	for(var i=0;i<state.chunks.length;i++){
		var c=state.chunks[i];
		if(c&&c.month===h&&c.label){
			headEl.textContent=c.label;
			if(cfg.siteTitle) document.title=c.label+' – '+cfg.siteTitle;
			break;
		}
	}
}

/* Rebuilds the feed from scratch — used on hashchange so clicking a new
   month in the sidebar while on the archive page jumps straight to it,
   with the infinite scroll continuing backwards from that new point. */
function restart(){
	if(!state.sentinel) return;
	while(feed.firstChild&&feed.firstChild!==state.sentinel){
		feed.removeChild(feed.firstChild);
	}
	state.queue=[]; state.shown=0; state.next=0;
	state.lastMonth=null; state.loading=false;
	state.startIdx=resolveStart();
	state.next=state.startIdx;
	updateHeading();
	pump();
}

function ensureSentinel(){
	if(state.sentinel) return;
	var s=document.createElement('div');
	s.id='wpx-sentinel';
	s.style.cssText='height:1px;visibility:hidden;';
	feed.appendChild(s);
	state.sentinel=s;
}

function loadJson(url){
	return fetch(url,{credentials:'same-origin'}).then(function(r){
		if(!r.ok) throw new Error('Failed: '+url);
		return r.json();
	});
}

function hasMore(){
	return state.queue.length>0 || state.next<state.chunks.length;
}

/*
 * Fetches the next JSON chunk and pushes its posts into the display
 * queue. A chunk is consumed even when it holds far more posts than
 * one page - the remainder simply waits in state.queue.
 */
function fetchChunk(){
	if(state.next>=state.chunks.length) return Promise.resolve(false);
	var idx=state.next++;
	var meta=state.chunks[idx]||{};
	var p=(idx===0&&window.WPX_FIRST_CHUNK)
		? Promise.resolve(window.WPX_FIRST_CHUNK)
		: loadJson(meta.file);
	return p.then(function(json){
		var posts=(json&&json.posts)||[];
		for(var i=0;i<posts.length;i++) state.queue.push(posts[i]);
		return posts.length>0;
	}).catch(function(e){
		state.next=idx; /* allow a retry on next scroll */
		throw e;
	});
}

/*
 * Reveals up to PAGE_SIZE more posts per call, transparently fetching
 * further chunks when the queue runs dry. This keeps "posts loaded"
 * (JSON chunks) decoupled from "posts shown" (batches of 10).
 */
function pump(){
	if(state.loading||!hasMore()) return Promise.resolve();
	state.loading=true;
	var target=state.shown+PAGE_SIZE;

	function step(){
		if(state.shown>=target) return;
		if(state.queue.length){
			var p=state.queue.shift();
			var mk=String(p.dateYmd||p.date||'').slice(0,7);
			if(mk&&mk!==state.lastMonth){
				/* Month boundary: announce it before the first post. */
				feed.insertBefore(monthHeader(mk,monthLabels[mk]||mk),state.sentinel);
				state.lastMonth=mk;
			}
			insertHtml(p.html);
			state.shown++;
			return step();
		}
		return fetchChunk().then(function(gotAny){
			if(gotAny) return step();
		});
	}

	return Promise.resolve()
		.then(step)
		.catch(function(e){ console.warn(e); })
		.then(function(){
			state.loading=false;
			
		});
}

/* One page per scroll approach toward the bottom. The loading guard
   collapses rapid wheel bursts into a single batch at a time; once a
   batch lands, further scrolling reveals the next one. */
function nearBottom(){
	if(!state.sentinel) return false;
	return state.sentinel.getBoundingClientRect().top < window.innerHeight+300;
}

function onScroll(){
	if(state.loading||!hasMore()) return;
	if(nearBottom()) pump();
}

function boot(){
	var u=new URLSearchParams(window.location.search);var q=u.get('s')||u.get('q')||'';
	if(q){
		window.location.href=(cfg.searchPage||'search.html')+'?s='+encodeURIComponent(q);
		return;
	}
	loadJson(cfg.manifest||'manifest.json').then(function(m){
		state.manifest=m;
		/* Normalise chunk entries: new manifests carry {file,month,label}
		   objects; a cached older one may only have plain file names. */
		state.chunks=(m.chunks||[]).map(function(c){
			return (typeof c==='string')
				? {file:c, month:'', label:''}
				: {file:c&&c.file||'', month:c&&c.month||'', label:c&&(c.label||c.month)||''};
		});
		state.total=m.totalPosts||0;
		var i;
		for(i=0;i<state.chunks.length;i++){
			var c=state.chunks[i];
			if(c&&c.month) monthLabels[c.month]=c.label||c.month;
		}
		ensureSentinel();
		state.startIdx=resolveStart();   /* clicked month (#YYYY-MM) */
		state.next=state.startIdx;       /* newer months stay unloaded */
		updateHeading();
		pump(); /* first batch of PAGE_SIZE posts */
		window.addEventListener('scroll',onScroll,{passive:true});
		window.addEventListener('resize',onScroll,{passive:true});
		window.addEventListener('hashchange',function(){
			if(state.manifest) restart(); /* jump to another clicked month */
		});
	}).catch(function(e){
		console.warn(e);
		/* Elegant error card: wraps the message in the same
		   <article class="post"> + <div class="entry-content"> structure
		   real posts use, so it inherits the theme's post margin/padding.
		   Deliberately no .type-post class — the theme CSS hides
		   ".type-post .entry-content" in the <=400px compact list view.
		   Inline styling mirrors reader.html's .reader-status convention. */
		feed.innerHTML='<article class="post hentry">'
			+'<div class="entry-content">'
			+'<p style="margin:0;padding:30px 0;color:#888;font-style:italic;">'
			+'Unable to load content. '
			+'<a href="./" onclick="location.reload();return false;">Try again.</a>'
			+'</p>'
			+'</div></article>';
	});
}

boot();
})();