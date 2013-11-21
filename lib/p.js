// Helpers for promises.
var nodefn = require('when/node/function');
var spawn = require('child_process').spawn;
var when = require('when');

var P = module.exports = {};

// My own version of nodefn.call with an explicit 'this', used for methods
P.call = function(fn, self) {
	var args = Array.prototype.slice.call(arguments, 2);
	return nodefn.apply(fn.bind(self), args);
};

// Returns a promise for completion after spawning `program`
P.spawn = function(program, args, options) {
	var deferred = when.defer();
	spawn(program, args || [], options || {}).
		on('exit', function(exitCode) {
			if (exitCode === 0) {
				deferred.resolve();
			} else {
				deferred.reject(new Error(
					program+' '+args.join(' ')+' exited with code '+exitCode
				));
			}
		}).on('error', function(err) {
			deferred.reject(err);
		});
	return deferred.promise;
};
