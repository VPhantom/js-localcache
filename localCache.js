/*jslint node: false, browser: true, es5: false, white: true, nomen: true, plusplus: true */
/*global localCache: true */

/**
 * Two-level client-side cache
 *
 * Use as an intermediary to, say, fetch data via network.  Data will be
 * stored in memory for subsequent lookups and, if localStorage is available,
 * stored and retrieved efficiently in localStorage as well, optionally
 * limited by the validity of a supplied key.
 *
 * For example, if you want to declare pre-existing "fetch_color()" as your
 * actual data fetcher (which itself returns its result asynchronously via a
 * callback), your one-liner might look something like this:
 *
 * function get_color(id, callback) {
 *   return localCache._fetcher(
 *     'color',
 *     id,
 *     fetch_color,
 *     { id: id },
 *     callback
 *   );
 * };
 *
 * Your callback will be invoked as soon as the corresponding data is
 * available, be it from memory cache, localStorage or from actually
 * invoking fetch_color().
 *
 * CAUTION: Be sure to invoke _init() before _fetcher().
 *
 * @package   localCache
 * @author    Stéphane Lavergne <http://www.imars.com/>
 * @copyright 2012-2013 Stéphane Lavergne
 * @license   http://www.gnu.org/licenses/lgpl-3.0.txt  GNU LGPL version 3
 */

(function (window) {
	"use strict";

	window.localCache = {
		_dirties: {},
		_dirty:  function() { return; },
		_update: function() { return; },
		_thaw:   function() { return {}; },

		/**
		 * Cached wrapper for getter functions
		 *
		 * Takes extra care to fire up fetcher() exactly once, and only queue up
		 * subsequent requests for the same property class and ID combination
		 * thereafter.  All queued callbacks will be called when fetcher()
		 * eventually fires.
		 *
		 * @param string        prop    Name of cache property class (i.e. 'color')
		 * @param number|string id      Unique ID for an instance of this class
		 * @param function   fetcher Called to fetch data if cache misses it
		 * @param object     arg     Named arguments to pass fetcher()
		 * @param function   f       Callback with associated data as argument
		 *
		 * @return null
		 */
		_fetcher: function(prop, id, fetcher, arg, f) {
			if (!localCache.hasOwnProperty(prop)) {
				localCache[prop] = localCache._thaw(prop);
				localCache['_'+prop] = {};
			}
			if (localCache[prop].hasOwnProperty(id)) {
				// Cache hit: fire callback immediately
				if (typeof f === 'function') {
					f(localCache[prop][id]);
				}
			} else if (localCache['_'+prop].hasOwnProperty(id)) {
				// Cache miss, already requested: spool callback
				localCache['_'+prop][id].push(f);
			} else {
				// Cache miss, not already requested
				localCache['_'+prop][id] = [ f ];
				fetcher(arg, function(result) {
					localCache._dirty(prop);
					localCache[prop][id] = result;
					while (localCache['_'+prop][id].length > 0) {
						var cb = localCache['_'+prop][id].pop();
						if (typeof cb === 'function') {
							cb(result);
						}
					}
					delete localCache['_'+prop][id];
				});
			}
		},

		/**
		 * Initialize local cache
		 *
		 * If you specify a validator key, it will be compared to the one which was
		 * previously stored in long-term storage, which will be emptied in case of
		 * a mismatch.  Useful for example for limiting your long-term cache to a
		 * few days by matching a session ID.
		 *
		 * @param string|number|null validator Validation key (optional)
		 *
		 * @return null
		 */
		_init: function(validator) {

			/**
			 * Polyfill for Firefox 2.0 < 3.5 to simulate localStorage support.
			 *
			 * If localStorage is missing, but sessionStorage is supported, wrap one in
			 * the other.  While sessionStorage isn't available across tabs/windows and
			 * has tighter size restrictions, at least it still saves on a lot of server
			 * I/O compared to current-page only.
			 *
			 * @package localStorage
			 * @author    Stéphane Lavergne <http://www.imars.com/>
			 * @copyright 2012-2013 Stéphane Lavergne
			 * @license   http://www.gnu.org/licenses/lgpl-3.0.txt  GNU LGPL version 3
			 */
			if (
				typeof window.localStorage === 'undefined'
				&& typeof window.sessionStorage !== 'undefined'
				) {
				window.localStorage = window.sessionStorage;
			}

			/**
			 * Polyfill for MSIE 5-7 to offer a consistent localStorage API.
			 *
			 * If localStorage is still missing, try creating one by wrapping around
			 * userData behavior if it is supported.
			 *
			 * This works well for me, and was inspired by the links below.  Feel free to
			 * modify to your own taste.
			 *
			 * @package   localStorage
			 * @author    Stéphane Lavergne <http://www.imars.com/>
			 * @copyright 2012-2013 Stéphane Lavergne
			 * @license   http://www.gnu.org/licenses/lgpl-3.0.txt  GNU LGPL version 3
			 * @link      http://msdn.microsoft.com/en-us/library/ms531424(v=vs.85).aspx
			 * @link      http://amplifyjs.com/api/store/
			 * @link      https://gist.github.com/furf/2371698
			 */
			if (typeof window.localStorage === 'undefined') {

				// Try defining a userData behavior
				var div = document.createElement('div');
				div.style.display = 'none';
				document.body.appendChild(div);
				try {
					div.style.behavior = "url('#default#userdata')";
					div.load('localStorage');  // This fails if userData isn't supported.

					// Publish a compatible API
					//
					// Hide behind JSON stash to avoid key charset restrictions and simplify
					// clear() implementation.  We're not after ideal performance here, but
					// just a quick crutch for our unfortunate pre-MSIE8 users.
					window.localStorage = {
						div: div,
						stash: {},
						getItem: function(key) {
							return localStorage.stash[key];
						},
						setItem: function(key, val) {
							localStorage.stash[key] = val;
							localStorage._update();
						},
						removeItem: function(key) {
							delete localStorage.stash[key];
							localStorage._update();
						},
						clear: function() {
							localStorage.stash = {};
							localStorage._update();
						},
						length: function() {
							var key, i=0;
							for (key in localStorage.stash) {
								if (localStorage.stash.hasOwnProperty(key)) {
									i++;
								}
							}
							return i;
						},
						key: function(index) {
							var key, i=0;
							for (key in localStorage.stash) {
								if (localStorage.stash.hasOwnProperty(key)) {
									if (i === index) {
										return key;
									}
									i++;
								}
							}
							return null;
						},
						_update: function() {
							localStorage.div.setAttribute('stash', JSON.stringify(localStorage.stash));
							localStorage.div.save('localStorage');
						}
					};
					if (div.getAttribute('stash')) {
						localStorage.stash = JSON.parse(div.getAttribute('stash'));
					}

				} catch (e1) {
					div.parentNode.removeChild(div);  // Why bother?
				}

			}

			// Add additional HTML5 localStorage layer if it's available
			if (typeof localStorage !== 'undefined') {

				try {

					// Initialize
					if (validator !== null) {
						if (localStorage.getItem('_validator') !== validator) {
							localStorage.clear();
							localStorage.setItem('_validator', validator);
						}
					}

					// Activate our formerly dummy API methods
					localCache._thaw = function(prop) {
						if (localStorage.getItem(prop)) {
							return JSON.parse(localStorage.getItem(prop));
						}
						return {};
					};
					localCache._dirty = function(key) {
						localCache._dirties[key] = true;
					};
					localCache._update = function() {
						var dirty;
						for (dirty in localCache._dirties) {
							if (localCache._dirties.hasOwnProperty(dirty)) {
								localStorage.setItem(dirty, JSON.stringify(localCache[dirty]));
								delete localCache._dirties[dirty];
							}
						}
					};

				} catch (e2) {
					// Regardless of error (whether it is Safari's private browsing
					// causing DOMException.QUOTA_EXCEEDED_ERR or anything else),
					// don't take any chances and disable local cache entirely.
					localCache._dirty  = function() { return; };
					localCache._update = function() { return; };
					localCache._thaw   = function() { return {}; };
				}

			}
		}

	};

}(window));
