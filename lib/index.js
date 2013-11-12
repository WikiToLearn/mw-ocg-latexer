if (typeof define !== 'function') { var define = require('amdefine')(module); }
define(['../package.json'], function(json) {
	function convert(dom) {
		var string = [
			//"\\usepackage[utf8]{inputenc}",
			"\\documentclass{article}",
			"\\begin{document}",
			"This is a test!",
			"\\end{document}"
		];
		return string.join('\n');
	}

	return {
		version: json.version,
		convert: convert
	};
});
