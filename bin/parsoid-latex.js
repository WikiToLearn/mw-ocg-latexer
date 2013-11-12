#!/usr/bin/env node

var program = require('commander');
var parsoidlatex = require('../');

program
	.version(parsoidlatex.version)
	.usage('[options] <title>')
	.option('-o, --output <filename>',
			'Save PDF to the given <filename>', null)
	.option('-p, --prefix <prefix>',
			'Which wiki prefix to use to resolve the title', 'en')
	.option('-a, --api <url>',
			'Parsoid API root', 'http://parsoid.wmflabs.org');

program.parse(process.argv);

if (program.args.length === 0) {
	console.error('A page title is required.');
	return 1;
}
if (program.args.length > 1) {
	console.error('Too many arguments.');
	return 1;
}
var title = program.args[0];
console.log(title);
