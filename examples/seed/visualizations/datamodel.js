// Visualizations of the data model: the views of a datamodel instance that only this metamodel knows how to draw.
// The file is the body of a function that returns them; `kit` is what bango gives to draw with (a canvas, SVG helpers, tree edits).
//
// Class diagram: entities as UML classes (attributes inside, relationships as lines with their multiplicities), enumerations,
// and inheritance. Drag a node to move it; drag from the dot at the side of an entity onto another to relate them (hold Shift to make
// it extend the other); select a node to edit it in the panel at the side; Delete removes the selected node.
//
// What modules offer to the data model (entities and enumerations of a read-only instance) is drawn too, dashed and locked, with the
// module that offers it: they can be related to and extended, never edited. The "Offered" button hides or shows them.

const ENTITY = '#3b82f6';
const ENUM = '#f59e0b';
const OFFERED = '#8b5cf6';
const LINE_HEIGHT = 16;
const CHAR = 6.6;

/** multiplicity of the far end of a relationship field: how many targets per owner */
const multiplicity = field => (field.props.multiple ? (field.props.required ? '1..*' : '0..*') : field.props.required ? '1' : '0..1');

/** `name: Type` and the flags that matter in a class diagram */
const attribute = field => {
  const p = field.props;
  const flags = [p.pk && 'pk', p.autoinc && 'auto', p.unique && 'unique'].filter(Boolean);
  const type = p.class ?? field.refs.enumType?.text;
  return `${p.required ? '*' : ' '} ${field.name}: ${type}${flags.length ? `  {${flags.join(', ')}}` : ''}`;
};

const widthOf = lines => Math.max(150, ...lines.map(line => line.length * CHAR + 24));

/** a name that no entity or enumeration has yet: Base, Base2, Base3, ... */
const freshName = (taken, base) => {
  for (let i = 1; ; i++) {
    const name = i === 1 ? base : `${base}${i}`;
    if (!taken.has(name)) return name;
  }
};

const lower = name => name.charAt(0).toLowerCase() + name.slice(1);

const visualizations = [
  {
    id: 'class-diagram',
    label: 'Class diagram',
    description: 'Entities as UML classes, with enumerations, inheritance and relationships',
    create(ctx, kit) {
      const { h, svg } = kit;
      let state;
      let model = { entities: [], enums: [] };
      let showOffered = true;
      let inspected;
      let selectWhenDrawn;
      let lastPaths = new Map();
      let messageTimer;

      const message = h('div', { class: 'bango-cmessage' });
      message.style.display = 'none';
      const say = text => {
        message.textContent = text;
        message.style.display = text ? '' : 'none';
        clearTimeout(messageTimer);
        if (text) messageTimer = setTimeout(() => say(''), 6000);
      };
      const edits = kit.editor(ctx.engine, ctx.metamodel, say);

      const button = (label, title, onclick) => h('button', { title, onclick }, label);
      const canvas = new kit.Canvas({
        onSelect: id => {
          const picked = id === null ? undefined : nodeById(id);
          // what is offered is not edited: it has no form
          const editable = picked && !picked.origin ? picked : undefined;
          inspected = editable && JSON.stringify(editable.path);
          ctx.inspect(editable ? editable.path : null);
          if (picked?.origin) say(`${picked.name} is offered by ${picked.origin}: it is read-only.`);
        },
        onOpen: id => {
          const picked = nodeById(id);
          if (picked && !picked.origin && picked.node.range) ctx.reveal(ctx.metamodel, picked.node.range);
        },
        onDelete: async id => {
          const picked = nodeById(id);
          if (picked?.origin) return say(`${picked.name} is offered by ${picked.origin}: it cannot be removed here.`);
          if (picked && (await edits.remove(picked.path))) ctx.inspect(null);
        },
        onMove: positions => ctx.layout.set(positions),
        onConnect: (from, to, { shift }) => void connect(from, to, shift)
      });
      const offeredButton = button('Offered', 'Show or hide what modules offer to the data model (read-only)', () => {
        showOffered = !showOffered;
        redraw();
      });
      offeredButton.style.display = 'none';
      canvas.toolbar.append(
        button('+ Entity', 'Add an entity', () => void addEntity()),
        button('+ Enum', 'Add an enumeration', () => void addEnum()),
        h('span', { class: 'bango-spacer' }),
        offeredButton,
        button('Auto layout', 'Place the nodes again', () => canvas.autoLayout(layoutOptions())),
        button('Fit', 'Show everything', () => canvas.fit()),
        button('−', 'Zoom out', () => canvas.zoom(1 / 1.25)),
        button('+', 'Zoom in', () => canvas.zoom(1.25))
      );

      const nodes = () => [...model.entities, ...model.enums];
      const nodeById = id => nodes().find(n => n.id === id);
      const names = () => new Set([...nodes().map(n => n.name), ...hiddenNames]);
      const layoutOptions = () => ({
        hierarchy: model.entities.flatMap(e => {
          const parent = e.superclass && model.entities.find(o => o.name === e.superclass);
          return parent ? [[parent.id, e.id]] : [];
        })
      });

      async function addEntity() {
        const name = freshName(names(), 'NewEntity');
        if (await edits.addNamed([], 'entities', 'Entity', name)) selectWhenDrawn = name;
      }

      async function addEnum() {
        const name = freshName(names(), 'NewEnum');
        if (await edits.addNamed([], 'enums', 'EnumDef', name)) selectWhenDrawn = name;
      }

      /** drag from one entity to another: a relationship (many `from` to one `to`, `from` owning it), or inheritance with Shift */
      async function connect(from, to, extend) {
        const a = model.entities.find(e => e.id === from);
        const b = model.entities.find(e => e.id === to);
        if (!a || !b) return say('Only entities can be related.');
        if (a.origin) return say(`${a.name} is offered by ${a.origin}: it cannot be changed here.`);
        if (extend) {
          if (a === b) return say('An entity cannot extend itself.');
          await edits.set(a.path, 'superclass', b.name);
          return;
        }
        const taken = entity => new Set(entity.node.children.fields ? kit.asArray(entity.node.children.fields).map(f => f.name) : []);
        const toward = freshName(taken(a), lower(b.name));
        const back = freshName(new Set([...taken(b), toward]), `${lower(a.name)}s`);
        const first = await edits.addNamed(a.path, 'fields', 'RelationshipField', toward);
        if (!first) return;
        await edits.set(first, 'target', b.name);
        // the other end of a relationship to something that is offered is not ours to write: the arrow goes one way
        if (!b.origin) await edits.set(first, 'bidirectional', back);
        await edits.set(first, 'owner', true);
        if (b.origin) return;
        const second = await edits.addNamed(b.path, 'fields', 'RelationshipField', back);
        if (!second) return;
        await edits.set(second, 'target', a.name);
        await edits.set(second, 'bidirectional', toward);
        await edits.set(second, 'multiple', true);
      }

      /** the entities and enumerations of an instance, with where they are in it; `origin` is who offers them when it is not the project */
      function read(ast, origin, out = { entities: [], enums: [] }) {
        kit.asArray(ast.children.entities).forEach((node, i) => {
          const fields = kit.asArray(node.children.fields);
          out.entities.push({
            node,
            name: node.name,
            id: origin ? `${origin}:${node.name}` : node.name,
            origin,
            path: [{ feature: 'entities', index: i }],
            abstract: !!node.props.abstract,
            traceable: !!node.props.traceable,
            superclass: kit.asArray(node.refs.superclass)[0]?.targetName ?? kit.asArray(node.refs.superclass)[0]?.text,
            properties: fields.filter(f => f.type === 'PropertyField'),
            relations: fields.filter(f => f.type === 'RelationshipField')
          });
        });
        kit.asArray(ast.children.enums).forEach((node, i) => {
          out.enums.push({ node, name: node.name, id: origin ? `${origin}:${node.name}` : node.name, origin, path: [{ feature: 'enums', index: i }], values: kit.asArray(node.props.values) });
        });
        return out;
      }

      /** how a node is outlined: what is offered is dashed and purple */
      const outline = (e, color) => (e.origin ? `stroke:${OFFERED};stroke-width:1.5;stroke-dasharray:6 3` : `stroke:${color};stroke-width:1.5`);
      const offeredBy = e => `🔒 ${e.origin}`;

      function entityNode(e) {
        const stereotype = [e.origin && offeredBy(e), e.abstract && '«abstract»', e.traceable && '«traceable»'].filter(Boolean).join(' ');
        const lines = e.properties.map(attribute);
        const width = widthOf([e.name, stereotype, ...lines]);
        const head = stereotype ? 40 : 26;
        const body = Math.max(1, lines.length) * LINE_HEIGHT + 10;
        const color = e.origin ? OFFERED : ENTITY;
        const el = svg('g', {},
          svg('rect', { width, height: head + body, rx: 4, style: `fill:var(--bango-panel,#252526);${outline(e, ENTITY)}` }),
          svg('rect', { width, height: head, rx: 4, style: `fill:${color};fill-opacity:.22;${outline(e, ENTITY)}` }),
          stereotype && svg('text', { x: width / 2, y: 14, 'text-anchor': 'middle', opacity: 0.7 }, stereotype),
          svg('text', { x: width / 2, y: stereotype ? 31 : 17, 'text-anchor': 'middle', 'font-weight': 700, 'font-size': 13, ...(e.abstract ? { 'font-style': 'italic' } : {}) }, e.name),
          ...lines.map((line, i) => svg('text', { x: 10, y: head + 16 + i * LINE_HEIGHT, 'font-family': 'ui-monospace, monospace' }, line))
        );
        // what is offered cannot start a relationship
        return { id: e.id, el, width, height: head + body, handle: !e.origin };
      }

      function enumNode(e) {
        const lines = e.values.map(String);
        const stereotype = e.origin ? `${offeredBy(e)} «enum»` : '«enum»';
        const width = widthOf([e.name, stereotype, ...lines]);
        const head = 40;
        const body = Math.max(1, lines.length) * LINE_HEIGHT + 10;
        const color = e.origin ? OFFERED : ENUM;
        const el = svg('g', {},
          svg('rect', { width, height: head + body, rx: 4, style: `fill:var(--bango-panel,#252526);${outline(e, ENUM)}` }),
          svg('rect', { width, height: head, rx: 4, style: `fill:${color};fill-opacity:.25;${outline(e, ENUM)}` }),
          svg('text', { x: width / 2, y: 14, 'text-anchor': 'middle', opacity: 0.7 }, stereotype),
          svg('text', { x: width / 2, y: 31, 'text-anchor': 'middle', 'font-weight': 700, 'font-size': 13 }, e.name),
          ...lines.map((line, i) => svg('text', { x: 10, y: head + 16 + i * LINE_HEIGHT, 'font-family': 'ui-monospace, monospace' }, line))
        );
        return { id: e.id, el, width, height: head + body };
      }

      function edgesOf() {
        const edges = [];
        const entities = new Map(model.entities.map(e => [e.name, e]));
        const enums = new Map(model.enums.map(e => [e.name, e]));

        for (const e of model.entities) {
          if (e.superclass && entities.has(e.superclass)) edges.push({ id: `extends:${e.id}`, from: e.id, to: entities.get(e.superclass).id, end: 'triangle' });
        }

        // a relationship and its inverse are one line; one without an inverse is an arrow
        const done = new Set();
        for (const e of model.entities) {
          for (const f of e.relations) {
            const key = `${e.id}.${f.name}`;
            if (done.has(key)) continue;
            done.add(key);
            const target = kit.asArray(f.refs.target)[0]?.text;
            if (!target || !entities.has(target)) continue;
            const inverseName = f.props.bidirectional;
            const inverse = inverseName && entities.get(target).relations.find(r => r.name === inverseName && kit.asArray(r.refs.target)[0]?.text === e.name);
            if (inverse) done.add(`${entities.get(target).id}.${inverse.name}`);
            edges.push({
              id: `rel:${key}`,
              from: e.id,
              to: entities.get(target).id,
              end: inverse ? 'none' : 'arrow',
              toLabel: `${f.name} ${multiplicity(f)}`,
              fromLabel: inverse ? `${inverse.name} ${multiplicity(inverse)}` : undefined
            });
          }
        }

        // an attribute of an enumeration's type: a dotted line to it
        for (const e of model.entities) {
          const used = new Map();
          for (const p of e.properties) {
            const type = kit.asArray(p.refs.enumType)[0]?.text;
            if (type && enums.has(type)) used.set(type, [...(used.get(type) ?? []), p.name]);
          }
          for (const [name, fields] of used) edges.push({ id: `uses:${e.id}>${enums.get(name).id}`, from: e.id, to: enums.get(name).id, dashed: true, end: 'arrow', color: ENUM, label: fields.join(', ') });
        }
        return edges;
      }

      /** the model of the instance and of what is offered for it; names of what is hidden still count when a new one is named */
      let hiddenNames = new Set();
      function read_() {
        hiddenNames = new Set();
        if (!state.ast) {
          model = { entities: [], enums: [] };
          return;
        }
        model = read(state.ast);
        const offers = (state.offered ?? []).filter(o => o.metamodel === ctx.metamodel && o.ast);
        offeredButton.style.display = offers.length ? '' : 'none';
        offeredButton.textContent = `Offered (${offers.reduce((n, o) => n + kit.asArray(o.ast.children.entities).length + kit.asArray(o.ast.children.enums).length, 0)})`;
        for (const o of offers) {
          if (showOffered) read(o.ast, o.origin, model);
          else for (const n of [...kit.asArray(o.ast.children.entities), ...kit.asArray(o.ast.children.enums)]) hiddenNames.add(n.name);
        }
      }

      function redraw() {
        read_();
        draw();
      }

      function draw() {
        offeredButton.classList.toggle('bango-on', showOffered);
        if (!state.ast) {
          canvas.render([], []);
          say(state.problems[0]?.message ?? 'There is no data model to draw.');
          return;
        }

        // a node that was renamed keeps where it was
        const saved = { ...ctx.layout.get(), ...canvas.positions() };
        const current = names();
        const paths = new Map();
        let carried = false;
        for (const n of nodes().filter(n => !n.origin)) {
          const key = JSON.stringify(n.path);
          paths.set(key, n.name);
          const before = lastPaths.get(key);
          if (before && before !== n.name && !current.has(before) && saved[before] && !saved[n.name]) {
            saved[n.name] = saved[before];
            delete saved[before];
            carried = true;
          }
        }
        lastPaths = paths;

        canvas.render([...model.entities.map(entityNode), ...model.enums.map(enumNode)], edgesOf(), saved, layoutOptions());
        if (carried) ctx.layout.set(canvas.positions());

        // a node that was just added is the one to edit; the inspector stays on a node that was renamed
        if (selectWhenDrawn && current.has(selectWhenDrawn)) {
          canvas.select(selectWhenDrawn);
          selectWhenDrawn = undefined;
        } else if (inspected) {
          const same = nodes().find(n => !n.origin && JSON.stringify(n.path) === inspected);
          if (same && canvas.selected !== same.id) canvas.select(same.id);
        }
      }

      return {
        mount(el) {
          canvas.mount(el);
          canvas.el.appendChild(message);
        },

        update(next) {
          state = next;
          read_();
          draw();
        },

        reveal(range) {
          ctx.reveal(ctx.metamodel, range);
        },

        dispose() {
          clearTimeout(messageTimer);
          canvas.dispose();
        }
      };
    }
  }
];

return visualizations;
