// Helpers for promises.
"use strict";
require('es6-shim');
require('prfun');

var spawn = require('child_process').spawn;

var P = module.exports = {};

// My own version of when's nodefn.call with an explicit 'this',
// used for methods
P.call = function(fn, self) {
	var args = Array.prototype.slice.call(arguments, 2);
	var pfn = Promise.promisify(fn, false, self);
	return pfn.apply(self, args);
};

// Returns a promise for completion after spawning `program`
P.spawn = function(program, args, options) {
	return new Promise(function(resolve, reject) {
		spawn(program, args || [], options || {}).
			on('exit', function(exitCode) {
				if (exitCode === 0) {
					resolve();
				} else {
					reject(new Error(
						program+' '+args.join(' ')+' exited with code '+exitCode
					));
				}
			}).on('error', function(err) {
				reject(err);
			});
	});
};

// Returns a promise for completion after iterating through the given
// array in parallel.  The function should return a promise for each element.
// This is like map but we throw away the results.
// If the optional `p` parameter is provided, wait for that to resolve
// before starting to process the array contents.
P.forEachPar = function(a, f, p) {
	return (p || Promise.resolve()).then(function() {
		return a;
	}).then(function(aResolved) {
		return Promise.all(aResolved.map(f));
	});
};

// Returns a promise for completion after iterating through the given
// array in sequence.  The function should return a promise for each element.
// If the optional `p` parameter is provided, wait for that to resolve
// before starting to process the array contents.
P.forEachSeq = function(a, f, p) {
	// The initial value must not be undefined.  Arbitrarily choose `true`.
	p = p ? p.return(true) : Promise.resolve(true);
	return Promise.reduce(a, function(curResult, value, index, total) {
		/* jshint unused: vars */
		return f.call(null, value, index, null);
	}, p);
};

// Limit the amount of parallelism.
// Implementation borrowed from:
// https://github.com/cujojs/when/blob/master/guard.js
// Authors: Brian Cavalier, John Hann, Sakari Jokinen
// docs at: https://github.com/cujojs/when/blob/master/docs/api.md#whenguard

/**
 * Creates a guarded version of f that can only be entered when the supplied
 * condition allows.
 * @param {function} condition represents a critical section that may only
 *  be entered when allowed by the condition
 * @param {function} f function to guard
 * @returns {function} guarded version of f
 */
P.guard = function(condition, f) {
	return function() {
		var self, args;

		self = this;
		args = arguments;

		return Promise.resolve(condition()).then(function(exit) {
			return Promise.resolve(f.apply(self, args)).finally(exit);
		});
	};
};

/**
 * Creates a condition that allows only n simultaneous executions
 * of a guarded function
 * @param {number} allowed number of allowed simultaneous executions
 * @returns {function} condition function which returns a promise that
 *  fulfills when the critical section may be entered.  The fulfillment
 *  value is a function ("notifyExit") that must be called when the critical
 *  section has been exited.
 */
P.guard.n = function (allowed) {
	var count, waiting;

	count = 0;
	waiting = [];

	var exit = function() {
		if (count > 0) {
			count--;
		}
		if(waiting.length) {
			waiting.shift()(exit);
		}
	};

	return function enter() {
		return new Promise(function(resolve) {
			if(count < allowed) {
				resolve(exit);
			} else {
				waiting.push(resolve);
			}
			count += 1;

		});
	};
};
