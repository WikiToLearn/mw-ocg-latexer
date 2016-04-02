* proper logging
    * don't use console.log (except for debugging purpose)
    * https://github.com/winstonjs/winston

* use Bluebird for promises
    * no reason to use a custom built promise engine
    * http://bluebirdjs.com/docs/getting-started.html

* use a templating engine for latex generation
    * writing the latex inside JS is very bad practice
    * we can move a lot of the document logic outside the js
    * more customization, ready for the future 
    * https://mozilla.github.io/nunjucks/

