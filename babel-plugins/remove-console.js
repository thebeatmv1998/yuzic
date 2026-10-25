/**
 * Remove `console.*` calls from production bundles.
 *
 * Server URLs in this app can carry Subsonic/Jellyfin/Plex credentials in their
 * query strings, and several providers log caught errors. Debug builds keep the
 * calls; a release build must not be able to write those URLs into logcat or a
 * diagnostics archive. `void 0` keeps the expression valid where a console call
 * was used as one.
 */
module.exports = function removeConsole({ types: t }) {
  const METHODS = new Set(['log', 'warn', 'error', 'info', 'debug', 'trace']);

  return {
    name: 'remove-console',
    visitor: {
      CallExpression(path) {
        const callee = path.get('callee');
        if (!callee.isMemberExpression()) return;
        const object = callee.get('object');
        const property = callee.get('property');
        if (!object.isIdentifier({ name: 'console' })) return;
        if (!property.isIdentifier()) return;
        if (!METHODS.has(property.node.name)) return;
        path.replaceWith(t.unaryExpression('void', t.numericLiteral(0)));
      },
    },
  };
};
