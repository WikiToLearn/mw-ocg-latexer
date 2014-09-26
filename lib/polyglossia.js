/** Language and option mappings for the XeLaTeX polyglossia package. */
"use strict";

var gloss_info = {
	amharic: { script: 'Ethiopic' },
	arabic: { dir: 'rtl', script: 'Arabic', env: 'Arabic' },
	armenian: { script: 'Armenian' },
	bengali: { script: 'Bengali' },
	bulgarian: { script: 'Cyrillic' },
	hans: { script: 'CJK' },
	hant: { script: 'CJK' },
	hanp: { script: 'Latin' },
	coptic: { script: 'Coptic' },
	divehi: { dir: 'rtl', script: 'Thaana' },
	farsi: { dir: 'rtl', script: 'Arabic' },
	greek: { script: 'Greek' },
	gujarati: { script: 'Gujarati' },
	hebrew: { dir: 'rtl', script: 'Hebrew' },
	hindi: { script: 'Devanagari' },
	japanese: { script: 'Kana' },
	kannada: { script: 'Kannada' },
	korean: { script: 'Hangul' },
	lao: { script: 'Lao' },
	malayalam: { script: 'Malayalam' },
	marathi: { script: 'Devanagari' },
	nko: { dir: 'rtl', script: "N'ko" },
	oriya: { script: 'Oriya' },
	punjabi: { script: 'Gurmukhi' },
	russian: { script: 'Cyrillic' },
	sanskrit: { script: 'Devanagari' },
	serbian: { script: 'Cyrillic' },
	syriac: { dir: 'rtl', script: 'Syriac' },
	tamil: { script: 'Tamil' },
	telugu: { script: 'Telugu' },
	thai: { script: 'Thai' },
	tibetan: { script: 'Tibetan' },
	ukrainian: { script: 'Cyrillic' },
	urdu: { dir: 'rtl', script: 'Arabic' }
};
var table = {
	sq: { lang: 'albanian' },
	am: { lang: 'amharic' },
	ar: { lang: 'arabic' },
	'und-Arab': { lang: 'arabic' },
	hy: { lang: 'armenian' },
	ast: { lang: 'asturian' },
	id: { lang: 'bahasai' },
	ms: { lang: 'bahasam' },
	eu: { lang: 'basque' },
	bn: { lang: 'bengali' },
	'pt-BR': { lang: 'brazil' },
	br: { lang: 'breton' },
	bg: { lang: 'bulgarian' },
	ca: { lang: 'catalan' },
	cop: { lang: 'coptic' },
	hr: { lang: 'croatian' },
	cs: { lang: 'czech' },
	da: { lang: 'danish' },
	dv: { lang: 'divehi' },
	nl: { lang: 'dutch' },
	en: { lang: 'english' },
	eo: { lang: 'esperanto' },
	et: { lang: 'estonian' },
	fa: { lang: 'farsi' },
	fi: { lang: 'finnish' },
	fr: { lang: 'french' },
	fur: { lang: 'friulan' },
	gl: { lang: 'galician' },
	de: { lang: 'german' },
	el: { lang: 'greek' },
	'el-latn': { lang: 'greek', options: 'numerals=arabic' },
	grc: { lang: 'greek', options: 'variant=ancient' },
	gu: { lang: 'gujarati' },
	he: { lang: 'hebrew' },
	hi: { lang: 'hindi' },
	is: { lang: 'icelandic' },
	ie: { lang: 'interlingua' },
	ga: { lang: 'irish' },
	it: { lang: 'italian' },
	kn: { lang: 'kannada' },
	lo: { lang: 'lao' },
	la: { lang: 'latin' },
	Latn: { lang: 'latin' }, // non-standard? used in arwiki sample.
	lv: { lang: 'latvian' },
	lt: { lang: 'lithuanian' },
	dsb: { lang: 'lsorbian' },
	hu: { lang: 'magyar' },
	ml: { lang: 'malayalam' },
	mr: { lang: 'marathi' },
	nqo: { lang: 'nko' },
	no: { lang: 'norsk' },
	nn: { lang: 'nynorsk' },
	oc: { lang: 'occitan' },
	or: { lang: 'oriya' },
	pa: { lang: 'punjabi' },
	pmsq: { lang: 'piedmontese' },
	pl: { lang: 'polish' },
	pt: { lang: 'portuges' },
	ro: { lang: 'romanian' },
	rm: { lang: 'romansh' },
	ru: { lang: 'russian' },
	sme: { lang: 'samin' },
	sa: { lang: 'sanskrit' },
	'sa-Latn': { lang: 'sanskrit' },
	gd: { lang: 'scottish' },
	sr: { lang: 'serbian' },
	sk: { lang: 'slovak' },
	sl: { lang: 'slovenian' },
	es: { lang: 'spanish' },
	sv: { lang: 'swedish' },
	syc: { lang: 'syriac' },
	ta: { lang: 'tamil' },
	te: { lang: 'telugu' },
	th: { lang: 'thai' },
	bo: { lang: 'tibetan' },
	tr: { lang: 'turkish' },
	tk: { lang: 'turkmen' },
	uk: { lang: 'ukrainian' },
	ur: { lang: 'urdu' },
	hsb: { lang: 'usorbian' },
	vi: { lang: 'vietnamese' },
	cy: { lang: 'welsh' },
	// extra polyglossia definitions included in tex/ directory
	ja: { lang: 'japanese' },
	// ja-Hani = japanese written in Kanji
	'zh-Hans': { lang: 'hans' },
	'zh-Hant': { lang: 'hant' },
	'zh-Latn-pinyin': { lang: 'hanp' }, // made up thing
	ko: { lang: 'korean' }
};

var WARNED = new Set();

var lookup = function(langcode) {
	// langcode is an RFC1766 language code.  That is, an ISO639 code,
	// possibly followed by a dash and a variant specifier.
	if (!table.hasOwnProperty(langcode)) {
		if (!WARNED.has(langcode)) {
			console.warn('Language support not found for', langcode);
			WARNED.add(langcode);
		}
		// try stripping the suffix.  otherwise, fall back to 'en'
		var stripped = langcode.replace(/-[\s\S]*$/, '');
		langcode = table.hasOwnProperty(stripped) ? stripped : 'en';
	}
	var r = table[langcode];
	var g = gloss_info[r.lang] || {};
	if (!r.env) { r.env = g.env || r.lang; }
	if (!r.dir) { r.dir = g.dir || 'ltr'; }
	if (!r.script) { r.script = g.script || 'Latin'; }
	if (!r.options) { r.options = ''; }
	return r;
};

module.exports = {
	lookup: lookup
};
