// Extra axe-core rules covering checks that IBM Equal Access reports but axe
// either skips or only partially covers. Evaluated after axe.min.js and
// before axe.run().
(function () {
  if (typeof axe === 'undefined' || axe.__linkCheckerExtras) return;
  axe.__linkCheckerExtras = true;

  var IDREF_ATTRS = [
    'aria-labelledby',
    'aria-describedby',
    'aria-controls',
    'aria-owns',
    'aria-activedescendant',
    'aria-flowto',
    'aria-details',
    'aria-errormessage',
  ];

  function firstRole(el) {
    return ((el.getAttribute('role') || '').trim().split(/\s+/)[0] || '').toLowerCase();
  }

  function idCount(root, id) {
    try {
      return root.querySelectorAll('[id="' + CSS.escape(id) + '"]').length;
    } catch (e) {
      return 0;
    }
  }

  function textOfIds(root, ids) {
    return ids
      .map(function (id) {
        var el = root.getElementById ? root.getElementById(id) : document.getElementById(id);
        return el ? (el.textContent || '').trim() : '';
      })
      .join(' ')
      .trim();
  }

  axe.configure({
    checks: [
      {
        id: 'svg-has-accessible-name',
        evaluate: function (node) {
          var label = (node.getAttribute('aria-label') || '').trim();
          if (label) return true;
          var by = (node.getAttribute('aria-labelledby') || '').trim();
          if (by && textOfIds(node.getRootNode(), by.split(/\s+/))) return true;
          for (var i = 0; i < node.children.length; i++) {
            var child = node.children[i];
            if (child.localName === 'title' && (child.textContent || '').trim()) return true;
          }
          if ((node.getAttribute('title') || '').trim()) return true;
          return false;
        },
        metadata: {
          impact: 'serious',
          messages: {
            pass: 'SVG has an accessible name',
            fail: 'SVG has no accessible name (aria-label, aria-labelledby or <title>) and is not hidden with aria-hidden="true" or role="presentation"',
          },
        },
      },
      {
        id: 'aria-idref-exists-unique',
        evaluate: function (node) {
          var root = node.getRootNode();
          var problems = [];
          IDREF_ATTRS.forEach(function (attr) {
            if (!node.hasAttribute(attr)) return;
            var value = (node.getAttribute(attr) || '').trim();
            if (!value) {
              problems.push(attr + ' is empty');
              return;
            }
            value.split(/\s+/).forEach(function (id) {
              var n = idCount(root, id);
              if (n === 0) problems.push(attr + ' references missing id "' + id + '"');
              else if (n > 1) problems.push(attr + ' references duplicate id "' + id + '"');
            });
          });
          if (problems.length) {
            this.data(problems.join('; '));
            return false;
          }
          return true;
        },
        metadata: {
          impact: 'serious',
          messages: {
            pass: 'ARIA ID references are valid',
            fail: 'ARIA ID reference problems: ${data}',
          },
        },
      },
    ],
    rules: [
      {
        id: 'svg-accessible-name',
        selector: 'svg',
        matches: function (node) {
          // Only the outermost <svg>; nested ones are part of the same graphic.
          if (node.parentElement && node.parentElement.closest('svg')) return false;
          // role=img / graphics-* SVGs are covered by axe's own svg-img-alt.
          var role = firstRole(node);
          if (['none', 'presentation', 'img', 'graphics-document', 'graphics-symbol'].indexOf(role) !== -1)
            return false;
          if (node.closest('[aria-hidden="true" i]')) return false;
          return true;
        },
        tags: ['cat.text-alternatives', 'wcag2a', 'wcag111', 'section508', 'section508.22.a', 'EN-301-549', 'EN-9.1.1.1'],
        metadata: {
          description: 'Ensures non-decorative <svg> elements have an accessible name',
          help: 'A non-decorative SVG element must have an accessible name',
          helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html',
        },
        any: ['svg-has-accessible-name'],
      },
      {
        id: 'aria-idref-valid',
        selector: IDREF_ATTRS.map(function (a) {
          return '[' + a + ']';
        }).join(','),
        tags: ['cat.aria', 'wcag2a', 'wcag412', 'EN-301-549', 'EN-9.4.1.2'],
        metadata: {
          description: 'Ensures ARIA ID-reference attributes reference a non-empty, unique id of an existing element',
          help: 'The ARIA property must reference a non-empty unique id of an existing element',
          helpUrl: 'https://www.w3.org/WAI/WCAG22/Understanding/name-role-value.html',
        },
        all: ['aria-idref-exists-unique'],
      },
    ],
  });
})();
