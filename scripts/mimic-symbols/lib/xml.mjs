/**
 * `F3.32f` / ADR 0086 decision 9 (plan D4) — a minimal walker for well-formed XML: the QET
 * `.elmt` files, the draw.io stencil sets and the Commons SVG files. It reads elements,
 * attributes (single or double quotes), nesting and text; it skips comments and the XML
 * declaration and other processing instructions. It refuses a document type, an entity
 * declaration and CDATA outright — the generator never needs them, and refusing them keeps entity
 * expansion out — and it refuses an unbalanced or mismatched tag. Pure: no dependency, no I/O.
 *
 * Returns the root element as `{ name, attrs, children, text }`: `attrs` a plain object,
 * `children` the child elements in order, `text` the element's own character data joined.
 */

const NAME = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;
const ATTR = /\s+([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/y;
const ENTITY = /&(?:#x([0-9a-fA-F]+)|#(\d+)|(lt|gt|amp|quot|apos));/g;
const NAMED = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** The five predefined entities and numeric character references; any other `&` is refused. */
function decode(text, at) {
  const out = text.replace(ENTITY, (_, hex, dec, name) =>
    hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : NAMED[name],
  );
  if (text.replace(ENTITY, "").includes("&")) throw new Error(`xml: an undefined entity near ${at}`);
  return out;
}

export function parseXml(source) {
  const text = String(source);
  let i = 0;
  const stack = [];
  let root = null;

  const fail = (message) => {
    throw new Error(`xml: ${message} at ${i}`);
  };

  while (i < text.length) {
    const lt = text.indexOf("<", i);
    const chunk = lt < 0 ? text.slice(i) : text.slice(i, lt);
    if (chunk !== "") {
      if (stack.length > 0) stack[stack.length - 1].text += decode(chunk, i);
      else if (chunk.trim() !== "") fail("text outside the root element");
    }
    if (lt < 0) break;
    i = lt;
    if (text.startsWith("<!--", i)) {
      const end = text.indexOf("-->", i + 4);
      if (end < 0) fail("an unterminated comment");
      i = end + 3;
      continue;
    }
    if (text.startsWith("<!DOCTYPE", i) || text.startsWith("<!doctype", i)) fail("a document type is refused");
    if (text.startsWith("<!ENTITY", i)) fail("an entity declaration is refused");
    if (text.startsWith("<![CDATA[", i)) fail("CDATA is refused");
    if (text.startsWith("<!", i)) fail("a markup declaration is refused");
    if (text.startsWith("<?", i)) {
      const end = text.indexOf("?>", i + 2);
      if (end < 0) fail("an unterminated processing instruction");
      i = end + 2;
      continue;
    }
    if (text.startsWith("</", i)) {
      NAME.lastIndex = i + 2;
      const m = NAME.exec(text);
      if (!m) fail("a close tag without a name");
      const close = /\s*>/y;
      close.lastIndex = NAME.lastIndex;
      if (!close.exec(text)) fail(`a malformed close tag </${m[0]}`);
      const open = stack.pop();
      if (!open) fail(`a close tag </${m[0]}> with nothing open`);
      if (open.name !== m[0]) fail(`</${m[0]}> closes <${open.name}>`);
      i = close.lastIndex;
      continue;
    }
    NAME.lastIndex = i + 1;
    const m = NAME.exec(text);
    if (!m) fail("a tag without a name");
    const element = { name: m[0], attrs: {}, children: [], text: "" };
    let at = NAME.lastIndex;
    for (;;) {
      ATTR.lastIndex = at;
      const a = ATTR.exec(text);
      if (!a) break;
      if (Object.prototype.hasOwnProperty.call(element.attrs, a[1])) fail(`<${element.name}> repeats ${a[1]}`);
      element.attrs[a[1]] = decode(a[2] ?? a[3] ?? "", at);
      at = ATTR.lastIndex;
    }
    const end = /\s*(\/?)>/y;
    end.lastIndex = at;
    const e = end.exec(text);
    if (!e) fail(`a malformed tag <${element.name}`);
    i = end.lastIndex;
    if (stack.length > 0) stack[stack.length - 1].children.push(element);
    else if (root) fail("a second root element");
    else root = element;
    if (e[1] !== "/") stack.push(element);
  }
  if (stack.length > 0) throw new Error(`xml: <${stack[stack.length - 1].name}> is never closed`);
  if (!root) throw new Error("xml: no root element");
  return root;
}

/** Every descendant element of `node` (depth first, document order), itself excluded. */
export function descendants(node) {
  const out = [];
  const walk = (n) => {
    for (const child of n.children) {
      out.push(child);
      walk(child);
    }
  };
  walk(node);
  return out;
}
