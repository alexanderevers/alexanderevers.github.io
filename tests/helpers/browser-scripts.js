/**
 * Loads the site's plain browser scripts (utils.js, api.js, ...) into a Node sandbox, the way a page loads
 * them: one shared global scope, in order. The scripts are not modules, so this is how tests reach them.
 *
 *   const app = loadBrowserScripts(['utils.js', 'stats.js']);
 *   app.sandbox.analyzeSpeedLaps(...)      // function declarations are properties of the sandbox
 *   app.get('MIN_SKATING_KPH')              // top-level const/let are not; read them by name
 */
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

function loadBrowserScripts(files, extraGlobals = {}) {
    const sandbox = {
        console,
        setTimeout,
        clearTimeout,
        URL,
        URLSearchParams,
        document: { cookie: '' },
        ...extraGlobals
    };
    sandbox.window = sandbox;
    const context = vm.createContext(sandbox);
    for (const file of files) {
        vm.runInContext(fs.readFileSync(path.join(PROJECT_ROOT, file), 'utf8'), context, { filename: file });
    }
    return {
        sandbox,
        context,
        get: name => vm.runInContext(name, context),
        run: code => vm.runInContext(code, context)
    };
}

/**
 * Copies a value that came out of the sandbox into plain host objects. Arrays and objects created by the
 * scripts belong to another JavaScript realm, so assert.deepEqual would call them different from the same
 * data created in the test. Use hostCopy(result) before deepEqual on arrays or objects.
 */
function hostCopy(value) {
    return JSON.parse(JSON.stringify(value));
}

module.exports = { loadBrowserScripts, hostCopy, PROJECT_ROOT };
