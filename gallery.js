/**
 * IMDb Film Gallery - progressive enhancement.
 *
 * The gallery is complete without JavaScript: every tile is a real <a href>
 * and the tooltip is a native title= attribute. This only smooths three
 * things a native tooltip cannot do.
 *
 * 1. A styled bubble with a max-width. A native title= bubble is drawn by
 *    the browser, so it cannot be given a width, padding or a background -
 *    which is the whole reason this file exists. The same text is already in
 *    the markup as data-imdb-tip, and title= is removed only once a bubble is
 *    actually attached, so the two can never appear together.
 * 2. Keyboard and touch users never get a title= bubble, so the same text is
 *    put in an aria-describedby region that is revealed on focus.
 * 3. A click on a tile that is still mid-navigation is ignored, so a stray
 *    second click does not reopen the same IMDb page in a new tab.
 */
(function () {
  'use strict';

  var NL = '\n';
  var TIP_ID = 'imdb-gallery-tip';

  /* Gap between the tile and the bubble when it is anchored to a tile. */
  var GAP = 10;

  /*
   * Offset from the pointer, matching how a native title= bubble opens: a
   * little down and to the right of the cursor, not centred on the element.
   * The right offset also keeps the bubble from covering the tile the pointer
   * is travelling across.
   */
  var POINTER_X = 12;
  var POINTER_Y = 16;

  /* Smallest margin kept between the bubble and the viewport edge. */
  var EDGE = 8;

  function buildLiveRegion() {
    var live = document.createElement('div');
    live.id = 'imdb-live-region';
    live.setAttribute('role', 'tooltip');
    live.setAttribute('aria-hidden', 'true');
    live.style.cssText = [
      'position:absolute', 'width:1px', 'height:1px', 'margin:-1px',
      'padding:0', 'overflow:hidden', 'clip:rect(0 0 0 0)',
      'white-space:nowrap', 'border:0'
    ].join(';');
    document.body.appendChild(live);
    return live;
  }

  /**
   * Turn the tooltip text into blocks, so the stylesheet can style the title
   * and the synopsis differently. The blank lines the renderer puts between
   * them become empty blocks: they are the paragraph spacing.
   */
  function fillBubble(bubble, text) {
    var frag = document.createDocumentFragment();

    String(text).split(NL).forEach(function (line) {
      var span = document.createElement('span');
      span.className = 'imdb-gallery-tip__line';
      span.textContent = line;
      frag.appendChild(span);
    });

    bubble.textContent = '';
    bubble.appendChild(frag);
  }

  function buildBubble() {
    var bubble = document.createElement('div');
    bubble.id = TIP_ID;
    bubble.className = 'imdb-gallery-tip';
    bubble.setAttribute('role', 'tooltip');
    document.body.appendChild(bubble);
    return bubble;
  }

  /**
   * Place the bubble relative to a point, the way a native tooltip does.
   *
   * Anchored to the pointer when there is one, so it opens just down-right of
   * the cursor and follows it across the tile - which is the behaviour the
   * browser's own tooltip has, and the reason it does not feel glued to the
   * middle of a poster. Falls back to the tile for keyboard focus, where there
   * is no cursor to follow.
   *
   * It slides back to the pointer's left when the right edge would overflow,
   * and above when the bottom would, then clamps to the viewport either way.
   * The bubble is position:fixed, so these are viewport coordinates.
   *
   * @param {Element} bubble  The bubble.
   * @param {Object}  rect    Tile rect, used for the vertical anchor.
   * @param {Object}  pointer Viewport {x, y}, or null for keyboard focus.
   */
  function position(bubble, rect, pointer) {
    var vw = document.documentElement.clientWidth;
    var vh = document.documentElement.clientHeight;
    var width = bubble.offsetWidth;
    var height = bubble.offsetHeight;

    var left;
    var top;

    if (pointer) {
      left = pointer.x + POINTER_X;
      top = pointer.y + POINTER_Y;

      // Near the right edge, open to the left of the cursor instead, so the
      // bubble always sits beside the pointer rather than off-screen.
      if (left + width > vw - EDGE) {
        left = Math.max(EDGE, pointer.x - POINTER_X - width);
      }
      // Near the bottom, open upwards.
      if (top + height > vh - EDGE) {
        top = Math.max(EDGE, pointer.y - POINTER_Y - height);
      }
    } else {
      // Keyboard: below the tile, nudged right so it is not centred on the
      // poster, which keeps the bubble clear of the tile's own right edge.
      left = rect.left + POINTER_X;
      top = rect.bottom + GAP;
      if (top + height > vh - EDGE) {
        top = Math.max(EDGE, rect.top - GAP - height);
      }
    }

    left = Math.max(EDGE, Math.min(left, vw - width - EDGE));
    top = Math.max(EDGE, Math.min(top, vh - height - EDGE));

    bubble.style.left = Math.round(left) + 'px';
    bubble.style.top = Math.round(top) + 'px';
  }

  function show(bubble, tile, pointer) {
    var text = tile.getAttribute('data-imdb-tip');
    if (!text) {
      return;
    }
    fillBubble(bubble, text);
    // Reveal at the final size before placing, so the bubble does not visibly
    // jump from wherever it was left.
    bubble.classList.add('is-visible');
    position(bubble, tile.getBoundingClientRect(), pointer);
  }

  function hide(bubble) {
    bubble.classList.remove('is-visible');
  }

  function init() {
    var tiles = document.querySelectorAll('.gallery_films__link');
    if (!tiles.length) {
      return;
    }

    var live = buildLiveRegion();
    var bubble = buildBubble();
    var active = null;

    // Viewport position of the last pointer event, so the bubble can open next
    // to the cursor and follow it across the tile.
    var pointer = null;

    function pointFrom(event) {
      return { x: event.clientX, y: event.clientY };
    }

    function open(tile, at) {
      pointer = at || null;
      if (active === tile && at === null) {
        return;
      }
      active = tile;
      show(bubble, tile, pointer);
    }

    function close() {
      active = null;
      pointer = null;
      hide(bubble);
    }

    Array.prototype.forEach.call(tiles, function (tile) {
      var tip = tile.getAttribute('data-imdb-tip') || tile.getAttribute('title');
      if (!tip) {
        return;
      }

      // Reference the same text from the accessible tree. The visible bubble
      // is decoration for the pointer; this region is what gets announced.
      tile.setAttribute('aria-describedby', 'imdb-live-region');

      // Only now that a bubble is attached can the native one be dropped.
      // The other order would leave no tooltip at all if the bubble failed.
      tile.removeAttribute('title');

      tile.addEventListener('mouseenter', function (event) {
        open(tile, pointFrom(event));
      });

      // Follow the cursor across the tile, the way a native tooltip does.
      // The bubble has pointer-events: none, so this never fires from the
      // bubble itself and cannot fight the pointer for the hover.
      tile.addEventListener('mousemove', function (event) {
        if (active !== tile) {
          return;
        }
        pointer = pointFrom(event);
        position(bubble, tile.getBoundingClientRect(), pointer);
      });

      tile.addEventListener('mouseleave', close);

      tile.addEventListener('focus', function () {
        live.textContent = tip.split(NL).join(' ');
        live.setAttribute('aria-hidden', 'false');
        // No cursor on keyboard focus, so this falls back to the tile anchor.
        open(tile, null);
      });

      tile.addEventListener('blur', function () {
        live.setAttribute('aria-hidden', 'true');
        close();
      });

      // Suppress a double activation while the first navigation is in flight.
      var busy = false;
      tile.addEventListener('click', function (event) {
        close();
        if (busy) {
          event.preventDefault();
          return;
        }
        busy = true;
        window.setTimeout(function () {
          busy = false;
        }, 800);
      });
    });

    // The bubble is fixed to the viewport, so scrolling leaves it stranded
    // over unrelated tiles. Native tooltips go away on scroll too, and
    // repositioning from a now-stale pointer would be worse than useless.
    window.addEventListener('scroll', function () {
      if (active) {
        close();
      }
    }, { passive: true });

    // A cached measurement is wrong after a resize, so drop the bubble.
    window.addEventListener('resize', function () {
      close();
    });

    // Escape dismisses, matching the ARIA tooltip pattern.
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' || event.keyCode === 27) {
        close();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
