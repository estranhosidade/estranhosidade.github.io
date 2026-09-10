/**
 * GitHub Front-End Comments — frontend renderer.
 *
 * Builds a native-looking comment section (list, threading, replies,
 * pagination, loading/empty/error states) on top of the plugin's REST proxy.
 * All user data is escaped before insertion except comment content, which is
 * already sanitized server-side with the WordPress comment kses allowlist.
 */
(function () {
	'use strict';

	function boot() {
	var root = document.getElementById('ghc-comments');
	if (!root || root.getAttribute('data-ghc-ready') === '1') {
		return;
	}
	root.setAttribute('data-ghc-ready', '1');

	var mode = root.getAttribute('data-api-mode') || 'wordpress';
	var baseUrl = root.getAttribute('data-api-url') || root.getAttribute('data-rest-url') || '/wp-json/ghc/v1/';
	var CFG = {
		postId: root.getAttribute('data-post-id') || '0',
		key: root.getAttribute('data-post-key') || root.getAttribute('data-post-id') || '0',
		mode: mode,
		baseUrl: baseUrl.replace(/\/$/, ''),
		nonce: root.getAttribute('data-rest-nonce') || '',
		perPage: parseInt(root.getAttribute('data-per-page'), 10) || 20
	};

	var I18N = {};
	try {
		I18N = JSON.parse(root.getAttribute('data-i18n') || '{}');
	} catch (e) {
		I18N = {};
	}

	function t(key, fallback) {
		return I18N[key] || fallback;
	}

	var state = {
		comments: [],
		total: 0,
		page: 1,
		totalPages: 1,
		replyTo: null,
		replyAuthor: '',
		loading: false
	};

	/* --- Helpers ----------------------------------------------------------- */

	function esc(value) {
		var d = document.createElement('div');
		d.textContent = value === null || value === undefined ? '' : String(value);
		return d.innerHTML;
	}

	function el(tag, className, html) {
		var node = document.createElement(tag);
		if (className) {
			node.className = className;
		}
		if (html !== undefined) {
			node.innerHTML = html;
		}
		return node;
	}

	function initial(author) {
		return author ? String(author).trim().charAt(0) : '?';
	}

	function findComment(id) {
		for (var i = 0; i < state.comments.length; i++) {
			var c = state.comments[i];
			if (String(c.id) === String(id) || (c.wp_id && String(c.wp_id) === String(id))) {
				return c;
			}
		}
		return null;
	}

	/* --- Data -------------------------------------------------------------- */

	function apiUrl(path) {
		return CFG.baseUrl + '/' + path.replace(/^\//, '');
	}

	function fetchComments(page, append) {
		if (state.loading) {
			return;
		}
		state.loading = true;

		var url = apiUrl('comments') +
			'?key=' + encodeURIComponent(CFG.key) +
			'&page=' + encodeURIComponent(page) +
			'&per_page=' + encodeURIComponent(CFG.perPage);

		var options = { headers: { Accept: 'application/json' } };
		if (CFG.mode === 'wordpress') {
			options.credentials = 'same-origin';
		}
		fetch(url, options)
			.then(function (res) {
				if (!res.ok) {
					throw new Error('HTTP ' + res.status);
				}
				return res.json();
			})
			.then(function (data) {
				state.loading = false;
				state.page = data.page || page;
				state.totalPages = data.total_pages || 1;
				state.total = data.total || 0;
				state.comments = append
					? state.comments.concat(data.comments || [])
					: (data.comments || []);
				render();
			})
			.catch(function () {
				state.loading = false;
				renderError();
			});
	}

	function submitComment(payload) {
		var headers = {
			'Content-Type': 'application/json',
			Accept: 'application/json'
		};
		if (CFG.mode === 'wordpress' && CFG.nonce) {
			headers['X-WP-Nonce'] = CFG.nonce;
		}
		var options = {
			method: 'POST',
			headers: headers,
			body: JSON.stringify(payload)
		};
		if (CFG.mode === 'wordpress') {
			options.credentials = 'same-origin';
		}
		return fetch(apiUrl('comments'), options).then(function (res) {
			return res.json().then(function (data) {
				if (!res.ok || !data || data.code) {
					throw new Error(data && data.message ? data.message : t('submit_error'));
				}
				return data;
			});
		});
	}
	/* --- Rendering ---------------------------------------------------------- */

	function buildTree() {
		var byId = {};
		var nodes = state.comments.map(function (c) {
			var node = {
				id: String(c.id),
				wpId: c.wp_id ? String(c.wp_id) : '',
				parent: c.parent ? String(c.parent) : '',
				author: c.author || '',
				authorUrl: c.author_url || '',
				date: c.date_display || c.date || '',
				content: c.content || '',
				children: []
			};
			byId[node.id] = node;
			if (node.wpId) {
				byId[node.wpId] = node;
			}
			return node;
		});

		var tops = [];
		nodes.forEach(function (node) {
			var parent = node.parent ? byId[node.parent] : null;
			if (parent && parent !== node) {
				parent.children.push(node);
			} else {
				tops.push(node);
			}
		});

		return { tops: tops, count: nodes.length };
	}

	function renderComment(node) {
		var header = el('header', 'ghc-comment-header');
		header.appendChild(el('span', 'ghc-avatar', esc(initial(node.author))));

		var meta = el('div', 'ghc-comment-meta');
		var authorHtml = node.authorUrl
			? '<a href="' + esc(node.authorUrl) + '" rel="nofollow ugc">' + esc(node.author) + '</a>'
			: esc(node.author);
		meta.appendChild(el('div', 'ghc-author', authorHtml));
		if (node.date) {
			meta.appendChild(el('div', 'ghc-date', esc(node.date)));
		}
		header.appendChild(meta);

		var article = el('article', 'ghc-comment-body');
		article.innerHTML = node.content; // Sanitized server-side (kses allowlist).

		var footer = el('footer', 'ghc-comment-actions');
		var reply = el('button', 'ghc-reply-btn', esc(t('reply', 'Reply')));
		reply.type = 'button';
		reply.setAttribute('data-ghc-comment-id', node.id);
		reply.setAttribute('data-ghc-author', node.author);
		reply.setAttribute('aria-label', t('reply', 'Reply') + ' — ' + (node.author || ''));
		footer.appendChild(reply);

		var item = el('li', 'ghc-comment');
		item.id = 'ghc-comment-' + node.id;
		item.appendChild(header);
		item.appendChild(article);
		item.appendChild(footer);

		if (node.children.length) {
			var children = el('ul', 'children');
			node.children.forEach(function (child) {
				children.appendChild(renderComment(child));
			});
			item.appendChild(children);
		}

		return item;
	}

	function renderList() {
		var tree = buildTree();
		var wrap = el('div', 'ghc-comments-inner');

		wrap.appendChild(
			el('h2', 'ghc-title',
				esc(t('title', 'Comments')) +
				(tree.count ? ' (' + tree.count + ')' : '')
			)
		);

		if (tree.tops.length) {
			var list = el('ul', 'ghc-comment-list');
			tree.tops.forEach(function (node) {
				list.appendChild(renderComment(node));
			});
			wrap.appendChild(list);
		}

		// Always load all comments — no "load more" button.

		wrap.appendChild(buildForm());
		return wrap;
	}

	function render() {
		root.innerHTML = '';
		root.appendChild(renderList());
		bindFormEvents();
	}

	function renderError() {
		root.innerHTML = '';
		var box = el('div', 'ghc-error', esc(t('error', 'Comments could not be loaded.')));
		var retry = el('button', 'ghc-btn', esc(t('retry', 'Retry')));
		retry.type = 'button';
		retry.addEventListener('click', function () {
			retry.disabled = true;
			fetchComments(1, false);
		});
		box.appendChild(retry);
		root.appendChild(box);
	}
	/* --- Form ---------------------------------------------------------------- */

	function buildForm() {
		var formWrap = el('div', 'ghc-comment-form-wrap');

		var status = el('div', 'ghc-reply-status ghc-hidden');
		status.setAttribute('data-ghc-reply-status', '');
		status.innerHTML = '<span data-ghc-reply-text></span>';
		var cancel = el('button', 'ghc-cancel-reply', esc(t('cancel_reply', 'Cancel reply')));
		cancel.type = 'button';
		status.appendChild(cancel);
		formWrap.appendChild(status);

		var form = el('form', 'ghc-form');
		form.setAttribute('novalidate', 'novalidate');

		form.innerHTML =
			'<div class="ghc-field">' +
				'<label for="ghc-author">' + esc(t('name_label', 'Name')) + ' <span aria-hidden="true">*</span></label>' +
				'<input type="text" id="ghc-author" name="ghc-author" maxlength="100" autocomplete="name" required>' +
			'</div>' +
			'<div class="ghc-field">' +
				'<label for="ghc-content">' + esc(t('comment_label', 'Comment')) + ' <span aria-hidden="true">*</span></label>' +
				'<textarea id="ghc-content" name="ghc-content" maxlength="5000" required></textarea>' +
			'</div>' +
			'<p class="ghc-field ghc-hp" aria-hidden="true">' +
				'<label>Leave this field empty' +
					'<input type="text" name="ghc_hp" tabindex="-1" autocomplete="off">' +
				'</label>' +
			'</p>' +
			'<p class="ghc-submit-row"><button type="submit" class="ghc-submit">' + esc(t('submit', 'Post Comment')) + '</button></p>';

		formWrap.appendChild(form);

		var message = el('div', 'ghc-form-message ghc-hidden');
		message.setAttribute('data-ghc-message', '');
		formWrap.appendChild(message);

		return formWrap;
	}

	function setMessage(text, ok) {
		var box = root.querySelector('[data-ghc-message]');
		if (!box) {
			return;
		}
		box.className = 'ghc-form-message ' + (ok ? 'ghc-ok' : 'ghc-bad');
		box.innerHTML = esc(text);
		box.classList.remove('ghc-hidden');
	}

	function setReply(id, author) {
		state.replyTo = id;
		state.replyAuthor = author || '';

		var status = root.querySelector('[data-ghc-reply-status]');
		var text = root.querySelector('[data-ghc-reply-text]');

		if (status && text) {
			if (id) {
				text.innerHTML = esc(t('replying_to', 'Replying to').replace('%s', state.replyAuthor));
				status.classList.remove('ghc-hidden');
			} else {
				text.innerHTML = '';
				status.classList.add('ghc-hidden');
			}
		}

		var textarea = root.querySelector('#ghc-content');
		if (id && textarea) {
			textarea.focus();
		}
	}

	function bindFormEvents() {
		var list = root.querySelector('.ghc-comment-list');
		if (list) {
			list.addEventListener('click', function (event) {
				var btn = event.target.closest ? event.target.closest('.ghc-reply-btn') : null;
				if (btn) {
					setReply(btn.getAttribute('data-ghc-comment-id'), btn.getAttribute('data-ghc-author'));
				}
			});
		}

		var cancel = root.querySelector('.ghc-cancel-reply');
		if (cancel) {
			cancel.addEventListener('click', function () {
				setReply(null, '');
			});
		}

		var form = root.querySelector('.ghc-form');
		if (!form) {
			return;
		}

		form.addEventListener('submit', function (event) {
			event.preventDefault();

			var authorInput = form.querySelector('#ghc-author');
			var contentInput = form.querySelector('#ghc-content');
			var hpInput = form.querySelector('input[name="ghc_hp"]');
			var submit = form.querySelector('.ghc-submit');

			var author = authorInput ? authorInput.value.trim() : '';
			var content = contentInput ? contentInput.value.trim() : '';

			if (!author) {
				setMessage(t('name_required', 'Please enter your name.'), false);
				if (authorInput) { authorInput.focus(); }
				return;
			}
			if (!content) {
				setMessage(t('comment_required', 'Please enter a comment.'), false);
				if (contentInput) { contentInput.focus(); }
				return;
			}

			submit.disabled = true;
			submit.innerHTML = esc(t('submitting', 'Posting…'));

			var payload = {
				post_id: CFG.postId,
				key: CFG.key,
				author: author,
				content: content,
				parent: state.replyTo || 0
			};
			payload[CFG.mode === 'wordpress' ? 'ghc_hp' : 'hp'] = hpInput ? hpInput.value : '';
			submitComment(payload).then(function (data) {
				submit.disabled = false;
				submit.innerHTML = esc(t('submit', 'Post Comment'));
				var isPending = data.pending === true || data.status === 'pending' || (data.comment && data.comment.status === 'pending');
				setMessage(data.message || (isPending ? t('pending', 'Your comment is awaiting moderation.') : t('posted', 'Thank you!')), true);

				if (isPending) {
					form.reset();
					setReply(null, '');
					return;
				}

				// Refresh the list so the new comment appears immediately.
				form.reset();
				setReply(null, '');
				fetchComments(1, false);
			}).catch(function (err) {
				submit.disabled = false;
				submit.innerHTML = esc(t('submit', 'Post Comment'));
				setMessage(err && err.message ? err.message : t('submit_error', 'Your comment could not be posted.'), false);
			});
		});
	}

	/* --- Boot ---------------------------------------------------------------- */

	fetchComments(1, false);
	}

	// Reader-mode static exports add their post markup asynchronously. Exposing
	// boot lets that page initialise the widget after it creates the root node.
	window.GHCCommentsBoot = boot;
	boot();
})();
